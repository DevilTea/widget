import type { InspectorEventMessage } from './protocol'
import type { InspectorTransport } from './transport'
import { describe, expect, it } from 'vitest'
import { createInspectorClient } from './client'
import {
	INSPECTOR_PROTOCOL_VERSION,
	isInspectorRequestResult,
	parseInspectorEventMessage,
	parseInspectorRequestMessage,
} from './protocol'

const ref = { runtimeId: 'r', nodeId: 1 }
const failure = {
	code: 'invalid-method-result',
	message: 'Some answers have errors.',
	location: { type: 'method', widgetId: 'root', name: 'submit' },
	reason: 'answer-errors',
	result: { type: 'boolean', value: false },
}
const methodMember = { type: 'method', name: 'submit', diagnostics: [failure] }
const widgetSnapshot = (members: unknown[]) => ({ ref, widgetId: 'root', widgetType: 'Survey', members })

describe('method members on the wire (protocol 0.5)', () => {
	it('declares protocol 0.5', () => {
		expect(INSPECTOR_PROTOCOL_VERSION)
			.toEqual({ major: 0, minor: 5 })
	})

	it('accepts a Method member reference in subscribeMember params and still ignores extra fields', () => {
		const request = (member: unknown) => ({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'request',
			requestId: 'r1',
			method: 'runtime.subscribeMember',
			params: { ref, member, extra: true },
		})
		expect(parseInspectorRequestMessage(request({ type: 'method', name: 'submit', extra: 1 })))
			.not
			.toBeNull()
		expect(parseInspectorRequestMessage(request({ type: 'event', name: 'submit' })))
			.toBeNull()
		expect(parseInspectorRequestMessage(request({ type: 'method' })))
			.toBeNull()
	})

	it('accepts a Method member in results only from a 0.5 envelope', () => {
		for (const method of ['runtime.getWidgetSnapshot', 'runtime.subscribeMember'] as const) {
			const value = method === 'runtime.getWidgetSnapshot'
				? widgetSnapshot([{ type: 'state', name: 'count', value: { type: 'number', value: 1 } }, methodMember])
				: { subscriptionId: 's', member: methodMember }
			expect(isInspectorRequestResult(method, value, 5))
				.toBe(true)
			expect(isInspectorRequestResult(method, value))
				.toBe(true)
			expect(isInspectorRequestResult(method, value, 4))
				.toBe(false)
		}
	})

	it('rejects malformed Method members', () => {
		const malformed = [
			{ type: 'method', name: 'submit' },
			{ type: 'method', name: 'submit', diagnostics: 'none' },
			{ type: 'method', name: 'submit', diagnostics: [{ code: 'x' }] },
			{ type: 'method', name: 'submit', diagnostics: [failure, null] },
			{ type: 'method', diagnostics: [] },
			{ type: 'method', name: 'submit', diagnostics: [{ ...failure, location: { type: 'event', widgetId: 'root', name: 'submit' } }] },
			{ type: 'method', name: 'submit', diagnostics: [{ ...failure, result: { type: 'unknown-kind' } }] },
		]
		for (const member of malformed) {
			expect(isInspectorRequestResult('runtime.subscribeMember', { subscriptionId: 's', member }, 5))
				.toBe(false)
			expect(isInspectorRequestResult('runtime.getWidgetSnapshot', widgetSnapshot([member]), 5))
				.toBe(false)
		}
		const cyclic: Record<string, unknown> = { ...failure }
		cyclic.cause = cyclic
		expect(isInspectorRequestResult('runtime.subscribeMember', { subscriptionId: 's', member: { ...methodMember, diagnostics: [cyclic] } }, 5))
			.toBe(false)
		expect(isInspectorRequestResult('runtime.subscribeMember', { subscriptionId: 's', member: { ...methodMember, diagnostics: [{ ...failure, cause: failure }] } }, 5))
			.toBe(true)
	})

	it('accepts a Method memberChanged event only in a 0.5 envelope', () => {
		const event = (minor: number) => ({
			protocol: { major: 0, minor },
			kind: 'event',
			event: 'runtime.memberChanged',
			payload: { subscriptionId: 's', ref, member: methodMember },
		})
		expect(parseInspectorEventMessage(event(5)))
			.not
			.toBeNull()
		expect(parseInspectorEventMessage(event(4)))
			.toBeNull()
		expect(parseInspectorEventMessage({ ...event(4), payload: { subscriptionId: 's', ref, member: { type: 'state', name: 'count', value: { type: 'number', value: 1 } } } }))
			.not
			.toBeNull()
	})
})

/** The client side of a cross-realm session against a scripted peer that speaks a chosen minor. */
function createScriptedPeer() {
	const sent: Record<string, unknown>[] = []
	const listeners = new Set<(message: unknown) => void>()
	const transport: InspectorTransport = {
		closed: false,
		send: (message) => {
			sent.push(message as Record<string, unknown>)
		},
		subscribe: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		subscribeClose: () => () => {},
		close: () => {},
	}
	return {
		transport,
		sent,
		deliver: (message: unknown) => {
			for (const listener of [...listeners])
				listener(message)
		},
	}
}

describe('a 0.5 client against a 0.4 Agent', () => {
	it('negotiates 0.4, surfaces invalid-params for a Method subscription and rejects an injected Method member', async () => {
		const peer = createScriptedPeer()
		const client = createInspectorClient(peer.transport)
		const events: InspectorEventMessage[] = []
		client.subscribe(event => events.push(event))
		const v4 = { major: 0, minor: 4 }

		const handshake = client.handshake()
		expect(peer.sent[0])
			.toMatchObject({ protocol: INSPECTOR_PROTOCOL_VERSION, method: 'handshake' })
		peer.deliver({ protocol: v4, kind: 'response', requestId: peer.sent[0]!.requestId, ok: true, result: { protocol: v4, capabilities: { methods: [], events: ['runtime.memberChanged'] } } })
		expect((await handshake).protocol)
			.toEqual(v4)

		const subscribe = client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'submit' } })
		peer.deliver({ protocol: v4, kind: 'response', requestId: peer.sent[1]!.requestId, ok: false, error: { code: 'invalid-params', message: 'Invalid parameters for the requested Inspector method.' } })
		await expect(subscribe)
			.rejects
			.toMatchObject({ code: 'invalid-params' })

		const snapshot = client.request('runtime.getWidgetSnapshot', { ref })
		peer.deliver({ protocol: v4, kind: 'response', requestId: peer.sent[2]!.requestId, ok: true, result: widgetSnapshot([methodMember]) })
		await expect(snapshot)
			.rejects
			.toMatchObject({ code: 'invalid-message' })

		peer.deliver({ protocol: v4, kind: 'event', event: 'runtime.memberChanged', payload: { subscriptionId: 's', ref, member: methodMember } })
		expect(events)
			.toEqual([])

		// The same payloads are fine in a 0.5 envelope.
		const v5 = INSPECTOR_PROTOCOL_VERSION
		const accepted = client.request('runtime.getWidgetSnapshot', { ref })
		peer.deliver({ protocol: v5, kind: 'response', requestId: peer.sent[3]!.requestId, ok: true, result: widgetSnapshot([methodMember]) })
		await expect(accepted)
			.resolves
			.toMatchObject({ members: [methodMember] })
		peer.deliver({ protocol: v5, kind: 'event', event: 'runtime.memberChanged', payload: { subscriptionId: 's', ref, member: methodMember } })
		expect(events)
			.toHaveLength(1)
		client.close()
	})
})
