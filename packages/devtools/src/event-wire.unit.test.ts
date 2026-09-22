import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectRuntime } from '@deviltea/widget-core/inspection'
import { describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInProcessInspectorTransportPair } from './transport'

interface EventWireInterfaces extends WidgetInterfaces {
	methods: {
		fire: (value: number) => void
	}
	events: {
		change: [payload: { value: number, callback: () => void }]
	}
}

const EventWirePlugin = createWidgetPlugin('EventWireFixture')
	.description('Event wire fixture')
	.interfaces<EventWireInterfaces>()
	.methods(methods => methods.fire({
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: ({ args: [value], emit }) => {
			emit.change({ value, callback: () => {} })
		},
	}))
	.events(events => events.change({ description: 'Changed payload' }))
	.done()

function createFixture() {
	const system = createWidgetSystem({ plugins: [EventWirePlugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'EventWireFixture' })
	if (blueprint.status !== 'valid')
		throw new Error('Expected event wire fixture to compile.')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('Expected event wire Runtime widget.')
	const node = inspectRuntime(runtime).blueprint.nodes.find(candidate => candidate.resolved && candidate.node.id === 'root')
	if (node === undefined)
		throw new Error('Expected event wire inspection node.')
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-events' })
	const client = createInspectorClient(pair.client)
	return { runtime, widget, node, agent, client }
}

describe('serialized Runtime event inspection', () => {
	it('projects event inventory and bounded occurrence args through the readonly Inspector protocol', async () => {
		const { widget, node, agent, client } = createFixture()
		try {
			const blueprint = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-events' })
			const root = blueprint.nodes.find(candidate => candidate.nodeId === node.nodeId)
			expect(root?.capabilities?.events)
				.toBe(true)
			expect(root?.events)
				.toEqual([{ type: 'event', name: 'change', description: 'Changed payload' }])

			const ref = { runtimeId: 'runtime-events', nodeId: node.nodeId }
			const occurrences = vi.fn()
			client.on('runtime.eventOccurred', occurrences)
			const subscription = await client.request('runtime.subscribeEvent', { ref, event: 'change' })

			widget.methods.fire(7)
			expect(occurrences)
				.toHaveBeenCalledTimes(1)
			expect(occurrences.mock.calls[0]![0])
				.toEqual({
					subscriptionId: subscription.subscriptionId,
					ref,
					event: 'change',
					args: [{
						type: 'object',
						id: 1,
						entries: [
							{ key: 'callback', value: { type: 'opaque', kind: 'function' } },
							{ key: 'value', value: { type: 'number', value: 7 } },
						],
						truncated: false,
					}],
				})

			await client.request('runtime.unsubscribeEvent', { subscriptionId: subscription.subscriptionId })
			widget.methods.fire(8)
			expect(occurrences)
				.toHaveBeenCalledTimes(1)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('rejects subscribing to an undeclared event without exposing emit authority', async () => {
		const { node, agent, client } = createFixture()
		try {
			await expect(client.request('runtime.subscribeEvent', {
				ref: { runtimeId: 'runtime-events', nodeId: node.nodeId },
				event: 'missing',
			}))
				.rejects.toMatchObject({ code: 'event-not-found' })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})
