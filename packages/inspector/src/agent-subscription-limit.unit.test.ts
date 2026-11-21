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
	.interfaces<LimitInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.events(['changed'])
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

	it('accepts the limit code in every 1.0 envelope and answers it to a peer that never handshook', () => {
		const code = { code: 'subscription-limit', message: 'x' }
		expect(parseInspectorResponseMessage({ protocol: INSPECTOR_PROTOCOL_VERSION, kind: 'response', requestId: 'r', ok: false, error: code }))
			.not
			.toBeNull()
		const { agent, pair, client } = createFixture({ maxSubscriptions: 1 })
		const responses: InspectorResponseMessage[] = []
		pair.client.subscribe((raw) => {
			const response = parseInspectorResponseMessage(raw)
			if (response !== null)
				responses.push(response)
		})
		try {
			pair.client.send({ protocol: INSPECTOR_PROTOCOL_VERSION, kind: 'request', requestId: 'snapshot', method: 'blueprint.getSnapshot', params: { runtimeId: 'runtime-limit' } })
			const rootNodeId = (responses.find(response => response.requestId === 'snapshot') as { result: { rootNodeId: number } }).result.rootNodeId
			const send = (requestId: string) => pair.client.send({
				protocol: INSPECTOR_PROTOCOL_VERSION,
				kind: 'request',
				requestId,
				method: 'runtime.subscribeMember',
				params: { ref: { runtimeId: 'runtime-limit', nodeId: rootNodeId }, member },
			})
			send('first')
			send('second')
			expect(responses.find(response => response.requestId === 'first')?.ok)
				.toBe(true)
			expect(responses.find(response => response.requestId === 'second'))
				.toMatchObject({ protocol: INSPECTOR_PROTOCOL_VERSION, ok: false, error: { code: 'subscription-limit' } })
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
