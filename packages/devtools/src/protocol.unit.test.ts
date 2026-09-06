import { describe, expect, it } from 'vitest'
import {
	INSPECTOR_PROTOCOL_VERSION,
	isCompatibleProtocolVersion,
	isInspectorRequestResult,
	parseInspectorRequestMessage,
	parseInspectorResponseMessage,
} from './protocol'

describe('inspector protocol validation', () => {
	it('accepts a valid typed request and rejects malformed parameters', () => {
		const valid = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'request',
			requestId: 'r1',
			method: 'runtime.getWidgetSnapshot',
			params: { ref: { runtimeId: 'runtime-a', nodeId: 2 } },
		}
		expect(parseInspectorRequestMessage(valid))
			.toEqual(valid)
		expect(parseInspectorRequestMessage({ ...valid, params: { ref: { runtimeId: 1, nodeId: '2' } } }))
			.toBeNull()
		expect(parseInspectorRequestMessage({ ...valid, method: 'method.invoke' }))
			.toBeNull()
	})

	it('validates response envelopes before request correlation', () => {
		const success = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: 'r1',
			ok: true,
			result: { anything: 'is method-validated by the client later' },
		}
		expect(parseInspectorResponseMessage(success))
			.toEqual(success)
		expect(parseInspectorResponseMessage({ ...success, ok: false, error: null }))
			.toBeNull()
	})

	it('uses major-version compatibility while allowing minor-version capability negotiation', () => {
		expect(isCompatibleProtocolVersion({ major: INSPECTOR_PROTOCOL_VERSION.major, minor: 999 }))
			.toBe(true)
		expect(isCompatibleProtocolVersion({ major: INSPECTOR_PROTOCOL_VERSION.major + 1, minor: 0 }))
			.toBe(false)
	})
})

describe('deep wire DTO validation', () => {
	it('rejects malformed nested Blueprint members, diagnostics, and cycles', () => {
		const base = {
			runtimeId: 'runtime-a',
			rootNodeId: 1,
			nodes: [{
				nodeId: 1,
				resolved: true,
				widgetId: 'root',
				widgetType: 'fixture',
				capabilities: { config: false, slots: false, state: false, properties: false, methods: false },
				sourceSlots: [],
				semanticSlots: [],
				state: [],
				properties: [],
				methods: [],
				diagnostics: [],
			}],
			invalidCycles: [],
		}
		expect(isInspectorRequestResult('blueprint.getSnapshot', base))
			.toBe(true)
		expect(isInspectorRequestResult('blueprint.getSnapshot', {
			...base,
			nodes: [{ ...base.nodes[0], properties: [{ type: 'property', name: 'x', dependencies: [{ status: 'resolved', path: [], reference: {}, target: {} }] }] }],
		}))
			.toBe(false)
		expect(isInspectorRequestResult('blueprint.getSnapshot', {
			...base,
			nodes: [{ ...base.nodes[0], diagnostics: [{ code: 'x', message: 'bad', location: { type: 'widget', nodeId: 'not-a-node-id' } }] }],
		}))
			.toBe(false)
		expect(isInspectorRequestResult('blueprint.getSnapshot', {
			...base,
			invalidCycles: [{ members: [{ nodeId: 1, member: { type: 'state', name: 'not-valid-in-cycle' } }] }],
		}))
			.toBe(false)
	})

	it('rejects unknown handshake events, unknown error codes, and malformed failed Runtime diagnostics', () => {
		expect(isInspectorRequestResult('handshake', {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			capabilities: { methods: ['runtime.list'], events: ['not-a-real-event'] },
		}))
			.toBe(false)
		expect(parseInspectorResponseMessage({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: 'r1',
			ok: false,
			error: { code: 'arbitrary-error', message: 'nope' },
		}))
			.toBeNull()
		expect(isInspectorRequestResult('runtime.getWidgetSnapshot', {
			ref: { runtimeId: 'runtime-a', nodeId: 1 },
			widgetId: 'root',
			widgetType: 'fixture',
			members: [{
				type: 'property',
				name: 'value',
				snapshot: { status: 'completed', result: { ok: false, diagnostics: [{ code: 'bad' }] } },
			}],
		}))
			.toBe(false)
	})
})
