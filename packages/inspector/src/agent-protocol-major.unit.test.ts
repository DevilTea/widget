import type { InspectorResponseMessage } from './protocol'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { INSPECTOR_PROTOCOL_VERSION, isCompatibleProtocolVersion, parseInspectorResponseMessage } from './protocol'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

function createRawFixture() {
	const fixture = createInspectorTestFixture()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-x' })
	const responses: InspectorResponseMessage[] = []
	pair.client.subscribe((raw) => {
		const response = parseInspectorResponseMessage(raw)
		if (response !== null)
			responses.push(response)
	})
	const request = (requestId: string, protocol: unknown, method: string, params: unknown) => {
		pair.client.send({ protocol, kind: 'request', requestId, method, params })
		return responses.find(response => response.requestId === requestId)
	}
	return { pair, agent, request }
}

describe('protocol 1.0 and the 0.x major', () => {
	it('is the first minor of major 1, and no 0.x version is compatible with it', () => {
		expect(INSPECTOR_PROTOCOL_VERSION)
			.toEqual({ major: 1, minor: 0 })
		expect(isCompatibleProtocolVersion({ major: 0, minor: 5 }))
			.toBe(false)
		expect(isCompatibleProtocolVersion({ major: 1, minor: 0 }))
			.toBe(true)
	})

	it('answers a 0.5 peer unsupported-version to the handshake, at the Agent\'s own version', () => {
		const { agent, request } = createRawFixture()
		try {
			const old = { major: 0, minor: 5 }
			expect(request('hs', old, 'handshake', { protocol: old }))
				.toEqual({
					protocol: INSPECTOR_PROTOCOL_VERSION,
					kind: 'response',
					requestId: 'hs',
					ok: false,
					error: { code: 'unsupported-version', message: 'Unsupported Inspector protocol major 0.' },
				})
		}
		finally {
			agent.dispose()
		}
	})

	it('answers an older major unsupported-version even when the method is unknown or the params are invalid', () => {
		const { agent, request } = createRawFixture()
		try {
			const old = { major: 0, minor: 5 }
			// Rejected while the request is classified (no handler runs), so the major is checked before the method and params are.
			expect(request('old-unknown', old, 'runtime.noSuchMethod', {}))
				.toMatchObject({ ok: false, protocol: INSPECTOR_PROTOCOL_VERSION, error: { code: 'unsupported-version' } })
			expect(request('old-invalid', old, 'blueprint.getSnapshot', { runtimeId: 42 }))
				.toMatchObject({ ok: false, protocol: INSPECTOR_PROTOCOL_VERSION, error: { code: 'unsupported-version' } })
			expect(request('old-no-params', old, 'runtime.getWidgetSnapshot', null))
				.toMatchObject({ ok: false, error: { code: 'unsupported-version' } })

			// The same requests at the current major get their own errors, so the answers above are the major's doing.
			expect(request('new-unknown', INSPECTOR_PROTOCOL_VERSION, 'runtime.noSuchMethod', {}))
				.toMatchObject({ ok: false, error: { code: 'unknown-method' } })
			expect(request('new-invalid', INSPECTOR_PROTOCOL_VERSION, 'blueprint.getSnapshot', { runtimeId: 42 }))
				.toMatchObject({ ok: false, error: { code: 'invalid-params' } })
		}
		finally {
			agent.dispose()
		}
	})

	it('answers every request of an older major unsupported-version, not served, and leaves the session usable', () => {
		const { agent, request } = createRawFixture()
		try {
			const old = { major: 0, minor: 5 }
			const requests = [
				['runtime.list', {}],
				['blueprint.getSnapshot', { runtimeId: 'runtime-x' }],
				['runtime.getWidgetSnapshot', { ref: { runtimeId: 'runtime-x', nodeId: 0 } }],
				['runtime.subscribeMember', { ref: { runtimeId: 'runtime-x', nodeId: 0 }, member: { type: 'state', name: 'count' } }],
				['runtime.subscribeEvent', { ref: { runtimeId: 'runtime-x', nodeId: 0 }, event: 'x' }],
			] as const
			for (const [index, [method, params]] of requests.entries()) {
				expect(request(`old-${index}`, old, method, params))
					.toMatchObject({ ok: false, protocol: INSPECTOR_PROTOCOL_VERSION, error: { code: 'unsupported-version' } })
			}
			// A handshake whose envelope is current but whose params name the older major is refused as well,
			// and does not change what a current peer is then served.
			expect(request('mixed', INSPECTOR_PROTOCOL_VERSION, 'handshake', { protocol: old }))
				.toMatchObject({ ok: false, error: { code: 'unsupported-version' } })
			expect(request('current', INSPECTOR_PROTOCOL_VERSION, 'handshake', { protocol: INSPECTOR_PROTOCOL_VERSION }))
				.toMatchObject({ ok: true, result: { protocol: INSPECTOR_PROTOCOL_VERSION } })
		}
		finally {
			agent.dispose()
		}
	})
})
