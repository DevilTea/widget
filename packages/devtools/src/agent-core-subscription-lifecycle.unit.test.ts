import type { WidgetInterfaces } from '@deviltea/widget-core'
import type {
	RuntimeEventInspection,
	RuntimePropertyInspection,
	RuntimeStateInspection,
	RuntimeWidgetInspection,
} from '@deviltea/widget-core/inspection'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInProcessInspectorTransportPair } from './transport'

const unsubscribeSpies = vi.hoisted(() => ({
	member: vi.fn(),
	event: vi.fn(),
}))

vi.mock('@deviltea/widget-core/inspection', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@deviltea/widget-core/inspection')>()

	function observeUnsubscribe(unsubscribe: () => void, observed: () => void): () => void {
		return () => {
			observed()
			unsubscribe()
		}
	}

	function wrapState(state: RuntimeStateInspection<unknown>): RuntimeStateInspection<unknown> {
		return {
			getSnapshot: state.getSnapshot,
			subscribe(listener) {
				return observeUnsubscribe(state.subscribe(listener), unsubscribeSpies.member)
			},
		}
	}

	function wrapProperty(property: RuntimePropertyInspection<unknown>): RuntimePropertyInspection<unknown> {
		return {
			getSnapshot: property.getSnapshot,
			subscribe(listener) {
				return observeUnsubscribe(property.subscribe(listener), unsubscribeSpies.member)
			},
		}
	}

	function wrapEvent(event: RuntimeEventInspection): RuntimeEventInspection {
		return {
			subscribe(listener) {
				return observeUnsubscribe(event.subscribe(listener), unsubscribeSpies.event)
			},
		}
	}

	function wrapWidget(widget: RuntimeWidgetInspection): RuntimeWidgetInspection {
		return {
			nodeId: widget.nodeId,
			blueprintNode: widget.blueprintNode,
			getState(key) {
				const state = widget.getState(key)
				return state === null ? null : wrapState(state)
			},
			getProperty(name) {
				const property = widget.getProperty(name)
				return property === null ? null : wrapProperty(property)
			},
			getEvent(name) {
				const event = widget.getEvent(name)
				return event === null ? null : wrapEvent(event)
			},
		}
	}

	return {
		...actual,
		inspectRuntime(runtime: Parameters<typeof actual.inspectRuntime>[0]) {
			const inspection = actual.inspectRuntime(runtime)
			return {
				blueprint: inspection.blueprint,
				getWidget(nodeId: Parameters<typeof inspection.getWidget>[0]) {
					const widget = inspection.getWidget(nodeId)
					return widget === null ? null : wrapWidget(widget)
				},
			}
		},
	}
})

interface SubscriptionFixtureInterfaces extends WidgetInterfaces {
	state: {
		count: number
	}
	methods: {
		fire: (value: number) => void
	}
	events: {
		change: [value: number]
	}
}

const SubscriptionFixturePlugin = createWidgetPlugin('SubscriptionFixture')
	.description('Agent subscription lifecycle fixture')
	.interfaces<SubscriptionFixtureInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.methods(methods => methods.fire({
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: ({ args: [value], emit }) => {
			emit.change(value)
		},
	}))
	.events(events => events.change({ description: 'Changed' }))
	.done()

const SubscriptionFixtureSystem = createWidgetSystem({ plugins: [SubscriptionFixturePlugin] })

describe('inspector Agent Core subscription lifecycle', () => {
	beforeEach(() => {
		unsubscribeSpies.member.mockClear()
		unsubscribeSpies.event.mockClear()
	})

	it('dispose releases live member and event inspection subscriptions while leaving the Runtime alive', async () => {
		const blueprint = SubscriptionFixtureSystem.createBlueprint({ id: 'root', type: 'SubscriptionFixture' })
		if (blueprint.status !== 'valid')
			throw new Error('Expected subscription lifecycle fixture to compile.')
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null || widget.type !== 'SubscriptionFixture')
			throw new Error('Expected subscription lifecycle Runtime widget.')

		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({
			runtime,
			transport: pair.agent,
			runtimeId: 'runtime-subscription-lifecycle',
			closeTransportOnDispose: false,
		})
		const client = createInspectorClient(pair.client)

		try {
			const { runtimes } = await client.request('runtime.list', {})
			const ref = { runtimeId: agent.runtimeId, nodeId: runtimes[0]!.rootNodeId }

			await client.request('runtime.subscribeMember', {
				ref,
				member: { type: 'state', name: 'count' },
			})
			await client.request('runtime.subscribeEvent', {
				ref,
				event: 'change',
			})

			expect(unsubscribeSpies.member).not.toHaveBeenCalled()
			expect(unsubscribeSpies.event).not.toHaveBeenCalled()

			agent.dispose()

			expect(unsubscribeSpies.member)
				.toHaveBeenCalledTimes(1)
			expect(unsubscribeSpies.event)
				.toHaveBeenCalledTimes(1)
			expect(pair.agent.closed)
				.toBe(false)

			expect(widget.state.count.set(1))
				.toMatchObject({ ok: true, value: 1 })
			expect(widget.methods.fire(1))
				.toMatchObject({ ok: true })
		}
		finally {
			client.dispose()
			agent.dispose()
			pair.agent.close()
			runtime.dispose()
		}
	})
})
