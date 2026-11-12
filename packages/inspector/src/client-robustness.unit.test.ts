import type { InspectorTransport } from './transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectorClient, InspectorClientError } from './client'

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

function deepSchema(depth: number): Record<string, unknown> {
	const root: Record<string, unknown> = {}
	let current = root
	for (let index = 0; index < depth; index++) {
		const next: Record<string, unknown> = {}
		current.a = next
		current = next
	}
	return root
}

function snapshotWithSchema(schema: unknown) {
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
			diagnostics: [],
			capabilities: { config: true, slots: false, state: false, properties: false, methods: false, events: false },
			config: { description: '', schema },
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
	it.each([5000, 100_000])('validates a response whose config schema is nested %i levels deep without overflowing the stack', async (depth) => {
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport)
		const pending = client.request('blueprint.getSnapshot', { runtimeId: 'r' })
		deliver({
			protocol: { major: 0, minor: 3 },
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: true,
			result: snapshotWithSchema(deepSchema(depth)),
		})
		await expect(pending)
			.resolves.toMatchObject({ runtimeId: 'r' })
		client.close()
	})

	it('still rejects a cyclic config schema without recursing on it', async () => {
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport)
		const pending = client.request('blueprint.getSnapshot', { runtimeId: 'r' })
		const cyclic: Record<string, unknown> = {}
		cyclic.self = cyclic
		deliver({
			protocol: { major: 0, minor: 3 },
			kind: 'response',
			requestId: sent[0]!.requestId,
			ok: true,
			result: snapshotWithSchema(cyclic),
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
			protocol: { major: 0, minor: 3 },
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
			protocol: { major: 0, minor: 3 },
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
			protocol: { major: 0, minor: 3 },
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

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid requestTimeoutMs of %s', (requestTimeoutMs) => {
		const { transport } = createScriptedTransport()
		expect(() => createInspectorClient(transport, { requestTimeoutMs }))
			.toThrow(RangeError)
	})
})
