import type { InspectorTransport } from './transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectorClient } from './client'

/** A transport that hands messages over by reference, so the test controls exactly what the client sees. */
function createScriptedTransport() {
	const sent: Record<string, unknown>[] = []
	const listeners = new Set<(message: unknown) => void>()
	const closeListeners = new Set<() => void>()
	let closed = false
	let failSends = false
	const transport: InspectorTransport = {
		get closed() {
			return closed
		},
		send(message) {
			if (failSends)
				throw new TypeError('transport down')
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
		failSends: () => {
			failSends = true
		},
		deliver(message: unknown) {
			for (const listener of [...listeners])
				listener(message)
		},
	}
}

const ref = { runtimeId: 'r', nodeId: 0 }
const memberResult = { subscriptionId: 'subscription-9', member: { type: 'state', name: 'count', value: { type: 'number', value: 1 } } }
const eventResult = { subscriptionId: 'event-subscription-9', event: 'changed' }

function success(requestId: unknown, result: unknown) {
	return { protocol: { major: 0, minor: 4 }, kind: 'response', requestId, ok: true, result }
}

afterEach(() => {
	vi.useRealTimers()
})

describe('a subscribe request that timed out', () => {
	it.each([
		{ method: 'runtime.subscribeMember', params: { ref, member: { type: 'state', name: 'count' } }, result: memberResult, unsubscribe: 'runtime.unsubscribeMember' },
		{ method: 'runtime.subscribeEvent', params: { ref, event: 'changed' }, result: eventResult, unsubscribe: 'runtime.unsubscribeEvent' },
	] as const)('releases the late $method subscription it never reported to the caller', async ({ method, params, result, unsubscribe }) => {
		vi.useFakeTimers()
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport, { requestTimeoutMs: 50 })
		const outcome = client.request(method, params as never)
			.catch((reason: unknown) => reason)
		await vi.advanceTimersByTimeAsync(50)
		expect(await outcome)
			.toMatchObject({ code: 'timeout' })
		expect(sent)
			.toHaveLength(1)

		deliver(success(sent[0]!.requestId, result))

		expect(sent)
			.toHaveLength(2)
		expect(sent[1])
			.toMatchObject({
				kind: 'request',
				method: unsubscribe,
				params: { subscriptionId: result.subscriptionId },
			})
		expect(sent[1]!.requestId)
			.not
			.toBe(sent[0]!.requestId)

		// The answer to that unsubscribe, and any duplicate late response, trigger nothing further.
		deliver(success(sent[1]!.requestId, { removed: true }))
		deliver(success(sent[0]!.requestId, result))
		expect(sent)
			.toHaveLength(2)
		client.close()
	})

	it('does not unsubscribe a subscription whose request did not time out', async () => {
		vi.useFakeTimers()
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport, { requestTimeoutMs: 50 })
		const pending = client.request('runtime.subscribeEvent', { ref, event: 'changed' })
		deliver(success(sent[0]!.requestId, eventResult))
		await expect(pending)
			.resolves
			.toEqual(eventResult)
		expect(sent)
			.toHaveLength(1)
		client.close()
	})

	it('sends no unsubscribe for a late error response, an invalid late result or a non-subscribe request', async () => {
		vi.useFakeTimers()
		const { transport, sent, deliver } = createScriptedTransport()
		const client = createInspectorClient(transport, { requestTimeoutMs: 50 })
		const outcomes = [
			client.request('runtime.subscribeEvent', { ref, event: 'a' })
				.catch(() => {}),
			client.request('runtime.subscribeEvent', { ref, event: 'b' })
				.catch(() => {}),
			client.request('runtime.list', {})
				.catch(() => {}),
		]
		await vi.advanceTimersByTimeAsync(50)
		await Promise.all(outcomes)

		deliver({ protocol: { major: 0, minor: 4 }, kind: 'response', requestId: sent[0]!.requestId, ok: false, error: { code: 'event-not-found', message: 'No.' } })
		deliver(success(sent[1]!.requestId, { subscriptionId: 42 }))
		deliver(success(sent[2]!.requestId, { runtimes: [] }))

		expect(sent)
			.toHaveLength(3)
		client.close()
	})

	it('forgets a timed-out subscribe once the client is closed and survives a transport that cannot send', async () => {
		vi.useFakeTimers()
		const scripted = createScriptedTransport()
		const client = createInspectorClient(scripted.transport, { requestTimeoutMs: 50 })
		const outcome = client.request('runtime.subscribeEvent', { ref, event: 'changed' })
			.catch(() => {})
		await vi.advanceTimersByTimeAsync(50)
		await outcome
		const requestId = scripted.sent[0]!.requestId

		scripted.failSends()
		expect(() => scripted.deliver(success(requestId, eventResult)))
			.not
			.toThrow()
		expect(scripted.sent)
			.toHaveLength(1)

		client.close()
		expect(() => scripted.deliver(success(requestId, eventResult)))
			.not
			.toThrow()
	})
})
