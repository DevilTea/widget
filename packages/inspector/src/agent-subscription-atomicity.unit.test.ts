import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InspectorEventMessage } from './protocol'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInProcessInspectorTransportPair } from './transport'

interface AtomicInterfaces extends WidgetInterfaces {
	state: { count: number }
	methods: { fire: (value: number) => void }
	events: { changed: [value: number] }
}

const AtomicPlugin = createWidgetPlugin('AtomicFixture')
	.description('Subscription atomicity fixture')
	.interfaces<AtomicInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.methods(methods => methods.fire({
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: ({ args: [value], emit }) => {
			emit.changed(value)
		},
	}))
	.events(events => events.changed({ description: 'Changed' }))
	.done()

afterEach(() => {
	vi.unstubAllGlobals()
})

async function setup() {
	// The Agent reports the swallowed cause out-of-band; keep it from crashing the test run.
	vi.stubGlobal('queueMicrotask', () => {})
	const system = createWidgetSystem({ plugins: [AtomicPlugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'AtomicFixture' })
	if (blueprint.status !== 'valid')
		throw new Error('Expected atomicity fixture to compile.')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')!
	const pair = createInProcessInspectorTransportPair()
	const responses: { requestId: string, ok: boolean, error?: { code: string } }[] = []
	const events: InspectorEventMessage[] = []
	pair.client.subscribe((message) => {
		const kind = (message as { kind?: string }).kind
		if (kind === 'event')
			events.push(message as InspectorEventMessage)
		else if (kind === 'response')
			responses.push(message as never)
	})
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-atomic', maxSubscriptions: 1 })
	const client = createInspectorClient(pair.client)
	const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-atomic' })
	const ref = { runtimeId: 'runtime-atomic', nodeId: snapshot.nodes.find(node => node.widgetId === 'root')!.nodeId }
	responses.length = 0

	// Make every successful response unsendable until `allowResponses()`.
	const originalSend = pair.agent.send.bind(pair.agent)
	let failSuccessResponses = true
	pair.agent.send = (message) => {
		const candidate = message as { kind?: string, ok?: boolean }
		if (failSuccessResponses && candidate.kind === 'response' && candidate.ok === true)
			throw new TypeError('not serializable')
		originalSend(message)
	}
	return {
		widget,
		pair,
		agent,
		client,
		ref,
		responses,
		events,
		allowResponses: () => {
			failSuccessResponses = false
		},
	}
}

describe('inspectorAgent subscription registration is atomic with its response', () => {
	it('rolls back a member subscription whose success response could not be sent', async () => {
		const { widget, pair, agent, client, ref, responses, events, allowResponses } = await setup()
		try {
			pair.client.send({
				protocol: { major: 0, minor: 4 },
				kind: 'request',
				requestId: 'a',
				method: 'runtime.subscribeMember',
				params: { ref, member: { type: 'state', name: 'count' } },
			})
			expect(responses)
				.toMatchObject([{ requestId: 'a', ok: false, error: { code: 'internal-error' } }])

			// No orphan: nothing is delivered under an id the peer never learned...
			widget.state.count.set(7)
			expect(events.filter(event => event.event === 'runtime.memberChanged'))
				.toEqual([])

			// ...and the failed registration no longer counts against the cap (maxSubscriptions is 1).
			allowResponses()
			await expect(client.request('runtime.subscribeMember', { ref, member: { type: 'state', name: 'count' } }))
				.resolves
				.toMatchObject({ subscriptionId: expect.any(String) })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('rolls back an event subscription whose success response could not be sent', async () => {
		const { widget, pair, agent, client, ref, responses, events, allowResponses } = await setup()
		try {
			pair.client.send({
				protocol: { major: 0, minor: 4 },
				kind: 'request',
				requestId: 'a',
				method: 'runtime.subscribeEvent',
				params: { ref, event: 'changed' },
			})
			expect(responses)
				.toMatchObject([{ requestId: 'a', ok: false, error: { code: 'internal-error' } }])

			widget.methods.fire(1)
			expect(events.filter(event => event.event === 'runtime.eventOccurred'))
				.toEqual([])

			allowResponses()
			await expect(client.request('runtime.subscribeEvent', { ref, event: 'changed' }))
				.resolves
				.toMatchObject({ subscriptionId: expect.any(String) })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})
