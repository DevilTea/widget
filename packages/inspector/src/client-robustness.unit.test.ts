import type { InspectorTransport } from './transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectorClient, InspectorClientError } from './client'
import { INSPECTOR_PROTOCOL_VERSION } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'

/** A transport that hands messages over by reference, so the test controls exactly what the client sees. */
function createScriptedTransport() {
	const sent: Record<string, unknown>[] = []
	const listeners = new Set<(message: unknown) => void>()
	const closeListeners = new Set<() => void>()
	let closed = false
	const transport: InspectorTransport = {
		get closed() {
			return closed
		},
		send(message) {
			sent.push(message as Record<string, unknown>)
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		subscribeClose(listener) {
			closeListeners.add(listener)
			return () => closeListeners.delete(listener)
		},
		close() {
			closed = true
			for (const listener of [...closeListeners])
				listener()
		},
	}
	return {
		transport,
		sent,
		deliver(message: unknown) {
			for (const listener of [...listeners])
				listener(message)
		},
	}
}

/** An InspectableValue of nested single-item arrays, `depth` levels deep. */
function deepValue(depth: number): Record<string, unknown> {
	const root: Record<string, unknown> = { type: 'array', id: 1, items: [], truncated: false }
	let current = root
	for (let index = 0; index < depth; index++) {
		const next: Record<string, unknown> = { type: 'array', id: index + 2, items: [], truncated: false }
		;(current.items as unknown[]).push(next)
		current = next
	}
	return root
}

/** A Blueprint snapshot whose one diagnostic carries `details`. */
function snapshotWithDetails(details: unknown) {
	return {
		runtimeId: 'r',
		rootNodeId: 0,
		invalidCycles: [],
		nodes: [{
			nodeId: 0,
			resolved: true,
			widgetId: 'a',
			widgetType: 't',
			sourceSlots: [],
			diagnostics: [{ code: 'invalid-widget-config', message: 'bad', location: { type: 'widget', nodeId: 0 }, reason: 'why', details }],
			capabilities: { config: true, slots: false, state: false, properties: false, methods: false, events: false },
			semanticSlots: [],
			state: [],
			properties: [],
			methods: [],
			events: [],
		}],
	}
}

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

describe('inspectorClient robustness', () => {
	it.each([5000, 100_000])('validates a response whose diagnostic details are nested %i levels deep without overflowing the stack', async (depth) => {
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport)
		const pending = client.request('blueprint.getSnapshot', { runtimeId: 'r' })
		deliver({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: true,
			result: snapshotWithDetails(deepValue(depth)),
		})
		await expect(pending)
			.resolves.toMatchObject({ runtimeId: 'r' })
		client.close()
	})

	it('still rejects cyclic diagnostic details without recursing on them', async () => {
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport)
		const pending = client.request('blueprint.getSnapshot', { runtimeId: 'r' })
		const cyclic = deepValue(1)
		;(cyclic.items as unknown[])[0] = cyclic
		deliver({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: true,
			result: snapshotWithDetails(cyclic),
		})
		await expect(pending)
			.rejects.toMatchObject({ code: 'invalid-message' })
		client.close()
	})

	it('rejects the matching request with an InspectorClientError when response validation throws', async () => {
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport)
		const pending = client.request('runtime.list', {})
		const hostile = {
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: true,
			get result(): never {
				throw new Error('hostile getter')
			},
		}
		expect(() => deliver(hostile))
			.not
			.toThrow()
		const error = await pending.catch((reason: unknown) => reason)
		expect(error)
			.toBeInstanceOf(InspectorClientError)
		expect(error)
			.toMatchObject({ code: 'invalid-message' })
		client.close()
	})

	it('rejects a pending request with a coded timeout error and ignores a late response', async () => {
		vi.useFakeTimers()
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport, { requestTimeoutMs: 50 })
		const pending = client.request('runtime.list', {})
		const outcome = pending.catch((reason: unknown) => reason)
		let settled = false
		void outcome.then(() => {
			settled = true
		})
		await vi.advanceTimersByTimeAsync(49)
		expect(settled)
			.toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		const error = await outcome
		expect(error)
			.toBeInstanceOf(InspectorClientError)
		expect(error)
			.toMatchObject({ code: 'timeout' })
		// A response that arrives after the timeout has no pending entry left and is dropped silently.
		expect(() => deliver({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: true,
			result: { runtimes: [] },
		}))
			.not
			.toThrow()
		client.close()
	})

	it('does not time out a request that settles in time and clears its timer', async () => {
		vi.useFakeTimers()
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport, { requestTimeoutMs: 50 })
		const pending = client.request('runtime.list', {})
		deliver({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: true,
			result: { runtimes: [] },
		})
		await expect(pending)
			.resolves.toEqual({ runtimes: [] })
		expect(vi.getTimerCount())
			.toBe(0)
		client.close()
	})

	it('has no request timeout unless one is configured', () => {
		vi.useFakeTimers()
		const { transport } = createScriptedTransport()
		const client = createInspectorClient(transport)
		void client.request('runtime.list', {})
			.catch(() => {})
		expect(vi.getTimerCount())
			.toBe(0)
		client.close()
	})

	it('maps an error code it does not know to a generic coded error that preserves the peer code and message', async () => {
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport)
		const pending = client.request('runtime.list', {})
		deliver({
			protocol: { major: 1, minor: 9 },
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: false,
			error: { code: 'quota-exceeded', message: 'Too many things.' },
		})
		const error = await pending.catch((reason: unknown) => reason)
		expect(error)
			.toBeInstanceOf(InspectorClientError)
		expect(error)
			.toMatchObject({ code: 'unknown-error', peerCode: 'quota-exceeded', message: 'Too many things.' })
		client.close()
	})

	it('maps the codes of an older major to unsupported-version rather than reading them', async () => {
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport)
		const pending = client.request('runtime.list', {})
		deliver({
			protocol: { major: 0, minor: 5 },
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: false,
			error: { code: 'subscription-limit', message: 'Cap.' },
		})
		await expect(pending)
			.rejects.toMatchObject({ code: 'unsupported-version' })
		client.close()
	})

	it('isolates throwing listeners from each other and reports the failure outside the dispatch', () => {
		const reported: (() => void)[] = []
		vi.stubGlobal('queueMicrotask', (callback: () => void) => reported.push(callback))
		const pair = createInProcessInspectorTransportPair()
		const client = createInspectorClient(pair.client)
		const seen: string[] = []
		client.subscribe(() => {
			seen.push('subscribe-1')
			throw new Error('subscribe boom')
		})
		client.subscribe(() => seen.push('subscribe-2'))
		client.on('agent.status', () => {
			seen.push('on-1')
			throw new Error('on boom')
		})
		client.on('agent.status', () => seen.push('on-2'))

		expect(() => pair.agent.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'event',
			event: 'agent.status',
			payload: { inspectEnabled: true },
		}))
			.not
			.toThrow()

		expect(seen)
			.toEqual(['subscribe-1', 'subscribe-2', 'on-1', 'on-2'])
		expect(reported)
			.toHaveLength(2)
		expect(() => reported[0]!())
			.toThrow('subscribe boom')
		expect(() => reported[1]!())
			.toThrow('on boom')
		client.close()
	})

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid requestTimeoutMs of %s', (requestTimeoutMs) => {
		const { transport } = createScriptedTransport()
		expect(() => createInspectorClient(transport, { requestTimeoutMs }))
			.toThrow(RangeError)
	})
})
