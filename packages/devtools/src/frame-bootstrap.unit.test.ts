import { describe, expect, it } from 'vitest'
import {
	acceptInspectorFrameBootstrap,
	createInspectorFrameBootstrapRequest,
	INSPECTOR_FRAME_BOOTSTRAP_TYPE,
	parseInspectorFrameBootstrapRequest,
} from './frame-bootstrap'

const EXPECTED_SOURCE = {} as MessageEventSource

function bootstrapEvent(options: {
	data?: unknown
	source?: MessageEventSource | null
	origin?: string
	ports?: MessagePort[]
} = {}): MessageEvent<unknown> {
	return {
		data: options.data ?? createInspectorFrameBootstrapRequest('session-a', 2),
		origin: options.origin ?? 'https://lab.test',
		source: options.source === undefined ? EXPECTED_SOURCE : options.source,
		ports: options.ports ?? [new MessageChannel().port1],
	} as unknown as MessageEvent<unknown>
}

const ACCEPT = {
	expectedSource: EXPECTED_SOURCE,
	expectedOrigin: 'https://lab.test',
	sessionId: 'session-a',
	expectedGeneration: 2,
} as const

describe('inspector frame bootstrap', () => {
	it('creates and parses the versioned JSON-safe bootstrap envelope', () => {
		const request = createInspectorFrameBootstrapRequest('session-a', 4)
		expect(request)
			.toEqual({
				type: INSPECTOR_FRAME_BOOTSTRAP_TYPE,
				version: 1,
				sessionId: 'session-a',
				generation: 4,
			})
		expect(parseInspectorFrameBootstrapRequest(JSON.parse(JSON.stringify(request))))
			.toEqual(request)
		expect(() => createInspectorFrameBootstrapRequest('', 0))
			.toThrow(TypeError)
		expect(() => createInspectorFrameBootstrapRequest('session-a', -1))
			.toThrow(TypeError)
	})

	it('accepts only the expected source/origin/session, a current generation, and exactly one port', () => {
		const channel = new MessageChannel()
		const accepted = acceptInspectorFrameBootstrap(bootstrapEvent({ ports: [channel.port1] }), ACCEPT)
		expect(accepted?.request.generation)
			.toBe(2)
		expect(accepted?.port)
			.toBe(channel.port1)
		channel.port1.close()
		channel.port2.close()

		expect(acceptInspectorFrameBootstrap(bootstrapEvent({ origin: 'https://evil.test' }), ACCEPT))
			.toBeNull()
		expect(acceptInspectorFrameBootstrap(bootstrapEvent({ source: null }), ACCEPT))
			.toBeNull()
		expect(acceptInspectorFrameBootstrap(bootstrapEvent({
			data: createInspectorFrameBootstrapRequest('other-session', 2),
		}), ACCEPT))
			.toBeNull()
		for (const generation of [1, 3]) {
			expect(acceptInspectorFrameBootstrap(bootstrapEvent({
				data: createInspectorFrameBootstrapRequest('session-a', generation),
			}), ACCEPT))
				.toBeNull()
		}
		expect(acceptInspectorFrameBootstrap(bootstrapEvent({ ports: [] }), ACCEPT))
			.toBeNull()
		expect(acceptInspectorFrameBootstrap(bootstrapEvent({
			ports: [new MessageChannel().port1, new MessageChannel().port1],
		}), ACCEPT))
			.toBeNull()
	})

	it('rejects malformed or unsupported bootstrap envelopes without throwing', () => {
		for (const data of [
			null,
			{},
			{ type: INSPECTOR_FRAME_BOOTSTRAP_TYPE, version: 99, sessionId: 'session-a', generation: 2 },
			{ type: INSPECTOR_FRAME_BOOTSTRAP_TYPE, version: 1, sessionId: '', generation: 2 },
			{ type: INSPECTOR_FRAME_BOOTSTRAP_TYPE, version: 1, sessionId: 'session-a', generation: 1.5 },
		]) {
			expect(parseInspectorFrameBootstrapRequest(data))
				.toBeNull()
		}
	})
})
