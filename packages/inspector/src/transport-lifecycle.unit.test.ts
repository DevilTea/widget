import { describe, expect, it, vi } from 'vitest'
import { createMessagePortChannelHub } from './channel'
import { createInspectorClient } from './client'
import { createInProcessInspectorTransportPair, createMessagePortInspectorTransport } from './transport'

describe('in-process Inspector transport subscriptions', () => {
	it('stops delivering to a message listener once it unsubscribes', () => {
		const pair = createInProcessInspectorTransportPair()
		const kept = vi.fn()
		const dropped = vi.fn()
		pair.agent.subscribe(kept)
		const unsubscribe = pair.agent.subscribe(dropped)

		pair.client.send({ n: 1 })
		unsubscribe()
		pair.client.send({ n: 2 })

		expect(kept.mock.calls)
			.toEqual([[{ n: 1 }], [{ n: 2 }]])
		expect(dropped.mock.calls)
			.toEqual([[{ n: 1 }]])
	})

	it('does not notify a close listener that unsubscribed before close', () => {
		const pair = createInProcessInspectorTransportPair()
		const kept = vi.fn()
		const dropped = vi.fn()
		pair.agent.subscribeClose(kept)
		pair.agent.subscribeClose(dropped)()

		pair.client.close()

		expect(kept)
			.toHaveBeenCalledTimes(1)
		expect(dropped).not.toHaveBeenCalled()
		expect(pair.agent.closed)
			.toBe(true)
	})

	it('reports an already-closed transport to late close subscribers and ignores late message subscribers', () => {
		const pair = createInProcessInspectorTransportPair()
		pair.client.close()
		const late = vi.fn()
		const lateMessage = vi.fn()

		pair.agent.subscribeClose(late)
		pair.agent.subscribe(lateMessage)

		expect(late)
			.toHaveBeenCalledTimes(1)
		expect(lateMessage).not.toHaveBeenCalled()
	})
})

describe('messagePort Inspector transport native lifecycle', () => {
	it('treats a native port close event as peer disconnect and notifies close listeners once', () => {
		const channel = new MessageChannel()
		const transport = createMessagePortInspectorTransport(channel.port1)
		const closed = vi.fn()
		transport.subscribeClose(closed)

		channel.port1.dispatchEvent(new Event('close'))
		channel.port1.dispatchEvent(new Event('close'))

		expect(transport.closed)
			.toBe(true)
		expect(closed)
			.toHaveBeenCalledTimes(1)
		expect(() => transport.send({ kind: 'late' }))
			.toThrow('Inspector transport is closed.')
		channel.port2.close()
	})

	it('honours message and close listener unsubscription', async () => {
		const channel = new MessageChannel()
		const left = createMessagePortInspectorTransport(channel.port1)
		const right = createMessagePortInspectorTransport(channel.port2)
		const dropped = vi.fn()
		const kept = new Promise<unknown>(resolve => right.subscribe(resolve))
		right.subscribe(dropped)()
		const droppedClose = vi.fn()
		right.subscribeClose(droppedClose)()

		left.send({ hello: 'world' })
		expect(await kept)
			.toEqual({ hello: 'world' })
		left.close()
		await vi.waitFor(() => expect(right.closed)
			.toBe(true))

		expect(dropped).not.toHaveBeenCalled()
		expect(droppedClose).not.toHaveBeenCalled()
	})

	it('reports a closed transport to late close subscribers without registering them', () => {
		const channel = new MessageChannel()
		const transport = createMessagePortInspectorTransport(channel.port1)
		transport.close()
		const late = vi.fn()
		const lateMessage = vi.fn()

		transport.subscribeClose(late)
		transport.subscribe(lateMessage)

		expect(late)
			.toHaveBeenCalledTimes(1)
		expect(lateMessage).not.toHaveBeenCalled()
		channel.port2.close()
	})
})

describe('messagePort channel hub native lifecycle', () => {
	it('closes the hub and every logical channel when the native port closes', () => {
		const native = new MessageChannel()
		const hub = createMessagePortChannelHub(native.port1)
		const inspector = hub.openChannel('inspector')
		const host = hub.openChannel('host')
		const inspectorClosed = vi.fn()
		const hostClosed = vi.fn()
		inspector.subscribeClose(inspectorClosed)
		host.subscribeClose(hostClosed)

		native.port1.dispatchEvent(new Event('close'))

		expect(hub.closed)
			.toBe(true)
		expect(inspector.closed)
			.toBe(true)
		expect(host.closed)
			.toBe(true)
		expect(inspectorClosed)
			.toHaveBeenCalledTimes(1)
		expect(hostClosed)
			.toHaveBeenCalledTimes(1)
		native.port2.close()
	})

	it('honours channel message and close unsubscription and reports closed channels to late subscribers', async () => {
		const native = new MessageChannel()
		const leftHub = createMessagePortChannelHub(native.port1)
		const rightHub = createMessagePortChannelHub(native.port2)
		const left = leftHub.openChannel('inspector')
		const right = rightHub.openChannel('inspector')
		const dropped = vi.fn()
		const kept = new Promise<unknown>(resolve => right.subscribe(resolve))
		right.subscribe(dropped)()
		const droppedClose = vi.fn()
		right.subscribeClose(droppedClose)()

		left.send({ ping: true })
		expect(await kept)
			.toEqual({ ping: true })
		leftHub.close()
		await vi.waitFor(() => expect(right.closed)
			.toBe(true))

		expect(dropped).not.toHaveBeenCalled()
		expect(droppedClose).not.toHaveBeenCalled()
		const late = vi.fn()
		const lateMessage = vi.fn()
		right.subscribeClose(late)
		right.subscribe(lateMessage)
		expect(late)
			.toHaveBeenCalledTimes(1)
		expect(lateMessage).not.toHaveBeenCalled()
		rightHub.close()
	})
})

describe('inspectorClient raw message subscription', () => {
	it('delivers valid event messages to raw subscribers until they unsubscribe', () => {
		const pair = createInProcessInspectorTransportPair()
		const client = createInspectorClient(pair.client)
		const received: unknown[] = []
		const unsubscribe = client.subscribe(message => received.push(message))
		const event = {
			protocol: { major: 0, minor: 3 },
			kind: 'event',
			event: 'agent.status',
			payload: { inspectEnabled: true },
		}

		pair.agent.send(event)
		unsubscribe()
		pair.agent.send({ ...event, payload: { inspectEnabled: false } })

		expect(received)
			.toEqual([event])
		client.dispose()
	})
})
