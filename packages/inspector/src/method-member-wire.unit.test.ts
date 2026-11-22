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

describe('method members on the wire', () => {
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

	it('accepts a Method member in results', () => {
		for (const method of ['runtime.getWidgetSnapshot', 'runtime.subscribeMember'] as const) {
			const value = method === 'runtime.getWidgetSnapshot'
				? widgetSnapshot([{ type: 'state', name: 'count', value: { type: 'number', value: 1 } }, methodMember])
				: { subscriptionId: 's', member: methodMember }
			expect(isInspectorRequestResult(method, value))
				.toBe(true)
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
			expect(isInspectorRequestResult('runtime.subscribeMember', { subscriptionId: 's', member }))
				.toBe(false)
			expect(isInspectorRequestResult('runtime.getWidgetSnapshot', widgetSnapshot([member])))
				.toBe(false)
		}
		const cyclic: Record<string, unknown> = { ...failure }
		cyclic.cause = cyclic
		expect(isInspectorRequestResult('runtime.subscribeMember', { subscriptionId: 's', member: { ...methodMember, diagnostics: [cyclic] } }))
			.toBe(false)
		expect(isInspectorRequestResult('runtime.subscribeMember', { subscriptionId: 's', member: { ...methodMember, diagnostics: [{ ...failure, cause: failure }] } }))
			.toBe(true)
	})

	it('accepts a Method memberChanged event', () => {
		const event = () => ({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'event',
			event: 'runtime.memberChanged',
			payload: { subscriptionId: 's', ref, member: methodMember },
		})
		expect(parseInspectorEventMessage(event()))
			.not
			.toBeNull()
		expect(parseInspectorEventMessage({ ...event(), payload: { subscriptionId: 's', ref, member: { type: 'state', name: 'count', value: { type: 'number', value: 1 } } } }))
			.not
			.toBeNull()
	})
})

/** The client side of a cross-realm session against a scripted peer that speaks a chosen version. */
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

describe('a 1.0 client against a 0.5 Agent', () => {
	it('rejects the older major\'s answers and ignores its events, whatever they carry', async () => {
		const peer = createScriptedPeer()
		const client = createInspectorClient(peer.transport)
		const events: InspectorEventMessage[] = []
		client.subscribe(event => events.push(event))
		const v05 = { major: 0, minor: 5 }

		const handshake = client.handshake()
		expect(peer.sent[0])
			.toMatchObject({ protocol: INSPECTOR_PROTOCOL_VERSION, method: 'handshake' })
		peer.deliver({ protocol: v05, kind: 'response', requestId: peer.sent[0]!.requestId, ok: true, result: { protocol: v05, capabilities: { methods: [], events: ['runtime.memberChanged'] } } })
		await expect(handshake)
			.rejects
			.toMatchObject({ code: 'unsupported-version' })

		const snapshot = client.request('runtime.getWidgetSnapshot', { ref })
		peer.deliver({ protocol: v05, kind: 'response', requestId: peer.sent[1]!.requestId, ok: true, result: widgetSnapshot([methodMember]) })
		await expect(snapshot)
			.rejects
			.toMatchObject({ code: 'unsupported-version' })

		peer.deliver({ protocol: v05, kind: 'event', event: 'runtime.memberChanged', payload: { subscriptionId: 's', ref, member: methodMember } })
		expect(events)
			.toEqual([])

		// The same payloads are fine in a 1.0 envelope.
		const accepted = client.request('runtime.getWidgetSnapshot', { ref })
		peer.deliver({ protocol: INSPECTOR_PROTOCOL_VERSION, kind: 'response', requestId: peer.sent[2]!.requestId, ok: true, result: widgetSnapshot([methodMember]) })
		await expect(accepted)
			.resolves
			.toMatchObject({ members: [methodMember] })
		peer.deliver({ protocol: INSPECTOR_PROTOCOL_VERSION, kind: 'event', event: 'runtime.memberChanged', payload: { subscriptionId: 's', ref, member: methodMember } })
		expect(events)
			.toHaveLength(1)
		client.close()
	})
})
