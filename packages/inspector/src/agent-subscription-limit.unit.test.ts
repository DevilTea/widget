import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { CreateInspectorAgentOptions } from './agent'
import type { InspectorResponseMessage } from './protocol'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { INSPECTOR_PROTOCOL_VERSION, parseInspectorResponseMessage } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'

interface LimitInterfaces extends WidgetInterfaces {
	state: { count: number }
	events: { changed: [payload: number] }
}

const LimitPlugin = createWidgetPlugin('LimitFixture')
	.description('Subscription limit fixture')
	.interfaces<LimitInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.events(events => events.changed({ description: 'Changed' }))
	.done()

function createFixture(agentOptions: Partial<CreateInspectorAgentOptions> = {}) {
	const system = createWidgetSystem({ plugins: [LimitPlugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'LimitFixture' })
	if (blueprint.status !== 'valid')
		throw new Error('Expected limit fixture to compile.')
	const runtime = blueprint.createRuntime()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-limit', ...agentOptions })
	const client = createInspectorClient(pair.client)
	return { runtime, pair, agent, client }
}

async function rootRef(client: ReturnType<typeof createFixture>['client']) {
	const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-limit' })
	return { runtimeId: 'runtime-limit', nodeId: snapshot.rootNodeId }
}

const member = { type: 'state', name: 'count' } as const

describe('inspectorAgent subscription limit', () => {
	it('is unlimited by default: many member and event subscriptions all succeed', async () => {
		const { agent, client } = createFixture()
		try {
			const ref = await rootRef(client)
			for (let index = 0; index < 200; index++) {
				const result = await client.request('runtime.subscribeMember', { ref, member })
				expect(result.subscriptionId)
					.toEqual(expect.any(String))
			}
			for (let index = 0; index < 200; index++) {
				const result = await client.request('runtime.subscribeEvent', { ref, event: 'changed' })
				expect(result.subscriptionId)
					.toEqual(expect.any(String))
			}
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('rejects with subscription-limit only once a configured cap is reached, counting members and events together', async () => {
		const { agent, client } = createFixture({ maxSubscriptions: 2 })
		try {
			const ref = await rootRef(client)
			const first = await client.request('runtime.subscribeMember', { ref, member })
			await client.request('runtime.subscribeEvent', { ref, event: 'changed' })

			await expect(client.request('runtime.subscribeMember', { ref, member }))
				.rejects
				.toMatchObject({ code: 'subscription-limit' })
			await expect(client.request('runtime.subscribeEvent', { ref, event: 'changed' }))
				.rejects
				.toMatchObject({ code: 'subscription-limit' })

			// Releasing a subscription frees a slot; the cap bounds live subscriptions, not lifetime ones.
			expect(await client.request('runtime.unsubscribeMember', { subscriptionId: first.subscriptionId }))
				.toEqual({ removed: true })
			const replacement = await client.request('runtime.subscribeEvent', { ref, event: 'changed' })
			expect(replacement.subscriptionId)
				.toEqual(expect.any(String))
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('does not spend the cap on requests that fail validation first', async () => {
		const { agent, client } = createFixture({ maxSubscriptions: 1 })
		try {
			const ref = await rootRef(client)
			await expect(client.request('runtime.subscribeMember', { ref, member: { type: 'state', name: 'missing' } }))
				.rejects
				.toMatchObject({ code: 'member-not-found' })
			await expect(client.request('runtime.subscribeEvent', { ref, event: 'missing' }))
				.rejects
				.toMatchObject({ code: 'event-not-found' })
			const result = await client.request('runtime.subscribeMember', { ref, member })
			expect(result.subscriptionId)
				.toEqual(expect.any(String))
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('advertises the limit code only at protocol 0.3', () => {
		expect(INSPECTOR_PROTOCOL_VERSION)
			.toEqual({ major: 0, minor: 3 })
		const code = { code: 'subscription-limit', message: 'x' }
		expect(parseInspectorResponseMessage({ protocol: { major: 0, minor: 3 }, kind: 'response', requestId: 'r', ok: false, error: code }))
			.not
			.toBeNull()
		expect(parseInspectorResponseMessage({ protocol: { major: 0, minor: 2 }, kind: 'response', requestId: 'r', ok: false, error: code }))
			.toBeNull()
	})

	it('answers a peer negotiated at 0.2 with the older internal-error code instead of the new one', () => {
		const { agent, pair, client } = createFixture({ maxSubscriptions: 1 })
		const responses: InspectorResponseMessage[] = []
		pair.client.subscribe((raw) => {
			const response = parseInspectorResponseMessage(raw)
			if (response !== null)
				responses.push(response)
		})
		try {
			const ref = { runtimeId: 'runtime-limit', nodeId: 1 }
			const send = (requestId: string) => pair.client.send({
				protocol: { major: 0, minor: 2 },
				kind: 'request',
				requestId,
				method: 'runtime.subscribeMember',
				params: { ref, member },
			})
			// The root is nodeId 0 in some projections; resolve through a real snapshot instead of guessing.
			pair.client.send({
				protocol: { major: 0, minor: 2 },
				kind: 'request',
				requestId: 'snapshot',
				method: 'blueprint.getSnapshot',
				params: { runtimeId: 'runtime-limit' },
			})
			const snapshot = responses.find(response => response.requestId === 'snapshot')
			expect(snapshot?.ok)
				.toBe(true)
			const rootNodeId = (snapshot as { result: { rootNodeId: number } }).result.rootNodeId
			ref.nodeId = rootNodeId

			send('first')
			send('second')
			const first = responses.find(response => response.requestId === 'first')
			const second = responses.find(response => response.requestId === 'second')
			expect(first?.ok)
				.toBe(true)
			expect(second)
				.toMatchObject({
					protocol: { major: 0, minor: 2 },
					ok: false,
					error: { code: 'internal-error' },
				})
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid cap configuration (%s) instead of silently ignoring it', (maxSubscriptions) => {
		expect(() => createFixture({ maxSubscriptions }))
			.toThrow(RangeError)
	})
})
