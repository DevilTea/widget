import type { InspectorRequestMethod } from './protocol'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { INSPECTOR_PROTOCOL_VERSION, parseInspectorRequestMessage } from './protocol'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

function createRawFixture() {
	const fixture = createInspectorTestFixture()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-x' })
	const received: Record<string, unknown>[] = []
	pair.client.subscribe(message => received.push(message as Record<string, unknown>))
	const send = (message: Record<string, unknown>) => pair.client.send(message)
	const request = (requestId: string, method: unknown, params: unknown, protocol: unknown = INSPECTOR_PROTOCOL_VERSION) =>
		send({ protocol, kind: 'request', requestId, method, params })
	const responseFor = (requestId: string) => received.find(message => message.requestId === requestId)
	return { ...fixture, pair, agent, received, send, request, responseFor }
}

describe('inspector error vocabulary', () => {
	it('answers an unknown method with unknown-method, not invalid-message', () => {
		const { agent, request, responseFor } = createRawFixture()
		request('1', 'does.not.exist', {})
		request('2', 'method.invoke', { anything: true })
		expect(responseFor('1'))
			.toMatchObject({ ok: false, error: { code: 'unknown-method' } })
		expect(responseFor('2'))
			.toMatchObject({ ok: false, error: { code: 'unknown-method' } })
		agent.dispose()
	})

	it('answers a well-formed envelope with invalid params with invalid-params', () => {
		const { agent, request, responseFor } = createRawFixture()
		request('bad-node-id', 'runtime.getWidgetSnapshot', { ref: { runtimeId: 'runtime-x', nodeId: 'a' } })
		request('missing-params', 'blueprint.getSnapshot', undefined)
		request('not-an-object', 'runtime.subscribeMember', 5)
		request('bad-point', 'inspect.hitTest', { coordinateSpace: 'preview-viewport', x: Number.NaN, y: 1 })
		for (const id of ['bad-node-id', 'missing-params', 'not-an-object', 'bad-point']) {
			expect(responseFor(id))
				.toMatchObject({ ok: false, error: { code: 'invalid-params' } })
		}
		agent.dispose()
	})

	it('keeps invalid-message for envelopes that are not well-formed requests', () => {
		const { agent, send, responseFor, received } = createRawFixture()
		send({ protocol: INSPECTOR_PROTOCOL_VERSION, kind: 'request', requestId: 'no-method', params: {} })
		send({ protocol: 'v0', kind: 'request', requestId: 'bad-protocol', method: 'runtime.list', params: {} })
		const before = received.length
		send({ protocol: INSPECTOR_PROTOCOL_VERSION, kind: 'request', method: 'runtime.list', params: {} })
		expect(responseFor('no-method'))
			.toMatchObject({ ok: false, error: { code: 'invalid-message' } })
		expect(responseFor('bad-protocol'))
			.toMatchObject({ ok: false, error: { code: 'invalid-message' } })
		// Without a request id there is nothing to correlate an answer with.
		expect(received)
			.toHaveLength(before)
		agent.dispose()
	})

	it('reports an incompatible protocol major before method or params problems', () => {
		const { agent, request, responseFor } = createRawFixture()
		request('unknown', 'does.not.exist', {}, { major: 99, minor: 0 })
		request('bad-params', 'runtime.getWidgetSnapshot', {}, { major: 99, minor: 0 })
		expect(responseFor('unknown'))
			.toMatchObject({ ok: false, error: { code: 'unsupported-version' } })
		expect(responseFor('bad-params'))
			.toMatchObject({ ok: false, error: { code: 'unsupported-version' } })
		agent.dispose()
	})

	it('lets every request params validator ignore unknown extra fields', () => {
		const valid: Record<InspectorRequestMethod, unknown> = {
			'handshake': { protocol: INSPECTOR_PROTOCOL_VERSION },
			'runtime.list': {},
			'blueprint.getSnapshot': { runtimeId: 'r' },
			'runtime.getWidgetSnapshot': { ref: { runtimeId: 'r', nodeId: 1 } },
			'runtime.subscribeMember': { ref: { runtimeId: 'r', nodeId: 1 }, member: { type: 'state', name: 'count' } },
			'runtime.unsubscribeMember': { subscriptionId: 's' },
			'runtime.subscribeEvent': { ref: { runtimeId: 'r', nodeId: 1 }, event: 'e' },
			'runtime.unsubscribeEvent': { subscriptionId: 's' },
			'inspect.hitTest': { coordinateSpace: 'preview-viewport', x: 1, y: 2 },
			'geometry.resolve': { ref: { runtimeId: 'r', nodeId: 1 } },
			'inspect.enable': {},
			'inspect.disable': {},
			'highlight.show': { ref: { runtimeId: 'r', nodeId: 1 } },
			'highlight.clear': {},
		}
		for (const [method, params] of Object.entries(valid)) {
			const message = { protocol: INSPECTOR_PROTOCOL_VERSION, kind: 'request', requestId: 'r', method }
			expect(parseInspectorRequestMessage({ ...message, params }), method)
				.not
				.toBeNull()
			expect(parseInspectorRequestMessage({ ...message, params: { ...params as object, futureField: true } }), method)
				.not
				.toBeNull()
		}
	})

	it('serves runtime.list with extra params through the Agent', () => {
		const { agent, request, responseFor } = createRawFixture()
		request('1', 'runtime.list', { future: true })
		expect(responseFor('1'))
			.toMatchObject({ ok: true, result: { runtimes: [{ runtimeId: 'runtime-x' }] } })
		agent.dispose()
	})

	it('lets only the handshake set the negotiated minor', async () => {
		const { agent, request, responseFor, received } = createRawFixture()
		// A stray older-minor request is answered at its own minor but does not lower the session.
		request('stray', 'runtime.list', {}, { major: 0, minor: 1 })
		expect(responseFor('stray'))
			.toMatchObject({ protocol: { major: 0, minor: 1 }, ok: true })
		request('later', 'runtime.subscribeEvent', { ref: { runtimeId: 'runtime-x', nodeId: 1 }, event: 'nope' })
		expect(responseFor('later'))
			.toMatchObject({ protocol: INSPECTOR_PROTOCOL_VERSION, ok: false, error: { code: expect.not.stringMatching(/^unknown-method$/) } })

		// A handshake does negotiate, and the negotiated minor survives later newer-minor requests.
		request('hs', 'handshake', { protocol: { major: 0, minor: 1 } })
		expect(responseFor('hs'))
			.toMatchObject({ ok: true, result: { protocol: { major: 0, minor: 1 } } })
		request('after', 'runtime.subscribeEvent', { ref: { runtimeId: 'runtime-x', nodeId: 1 }, event: 'nope' })
		expect(responseFor('after'))
			.toMatchObject({ protocol: { major: 0, minor: 1 }, ok: false, error: { code: 'unknown-method' } })
		expect(received.length)
			.toBeGreaterThan(0)
		agent.dispose()
	})

	it('surfaces the new codes through the client as InspectorClientError', async () => {
		const fixture = createInspectorTestFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-x' })
		const client = createInspectorClient(pair.client)
		try {
			await expect(client.request('runtime.getWidgetSnapshot', { ref: { runtimeId: 'runtime-x', nodeId: -1 } }))
				.rejects.toMatchObject({ code: 'invalid-params' })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})
