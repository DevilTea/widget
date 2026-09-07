import { describe, expect, it } from 'vitest'
import { createMessagePortChannelHub } from './channel'

function nextMessage(transport: ReturnType<ReturnType<typeof createMessagePortChannelHub>['openChannel']>): Promise<unknown> {
	return new Promise(resolve => transport.subscribe(resolve))
}

function nextClose(transport: ReturnType<ReturnType<typeof createMessagePortChannelHub>['openChannel']>): Promise<void> {
	return new Promise(resolve => transport.subscribeClose(resolve))
}

describe('messagePort channel hub', () => {
	it('isolates logical channels while preserving JSON wire identity', async () => {
		const native = new MessageChannel()
		const leftHub = createMessagePortChannelHub(native.port1)
		const rightHub = createMessagePortChannelHub(native.port2)
		const leftInspector = leftHub.openChannel('inspector')
		const rightInspector = rightHub.openChannel('inspector')
		const rightHost = rightHub.openChannel('host')
		try {
			let hostMessages = 0
			rightHost.subscribe(() => hostMessages++)
			const original = { nested: { value: 1 } }
			const received = nextMessage(rightInspector)
			leftInspector.send(original)
			const result = await received
			expect(result)
				.toEqual(original)
			expect(result).not.toBe(original)
			expect(hostMessages)
				.toBe(0)
		}
		finally {
			leftHub.close()
			rightHub.close()
		}
	})

	it('scopes channel close without disconnecting sibling channels', async () => {
		const native = new MessageChannel()
		const leftHub = createMessagePortChannelHub(native.port1)
		const rightHub = createMessagePortChannelHub(native.port2)
		const leftInspector = leftHub.openChannel('inspector')
		const rightInspector = rightHub.openChannel('inspector')
		const leftHost = leftHub.openChannel('host')
		const rightHost = rightHub.openChannel('host')
		try {
			const peerClosed = nextClose(rightInspector)
			leftInspector.close()
			await peerClosed
			expect(leftInspector.closed)
				.toBe(true)
			expect(rightInspector.closed)
				.toBe(true)
			expect(leftHost.closed)
				.toBe(false)
			expect(rightHost.closed)
				.toBe(false)

			const hostMessage = nextMessage(rightHost)
			leftHost.send({ ready: true })
			await expect(hostMessage).resolves.toEqual({ ready: true })
		}
		finally {
			leftHub.close()
			rightHub.close()
		}
	})

	it('disconnects every logical channel when the native peer closes', async () => {
		const native = new MessageChannel()
		const leftHub = createMessagePortChannelHub(native.port1)
		const rightHub = createMessagePortChannelHub(native.port2)
		const inspector = leftHub.openChannel('inspector')
		const host = leftHub.openChannel('host')
		const inspectorClosed = nextClose(inspector)
		const hostClosed = nextClose(host)

		rightHub.close()
		await Promise.all([inspectorClosed, hostClosed])
		expect(leftHub.closed)
			.toBe(true)
		expect(inspector.closed)
			.toBe(true)
		expect(host.closed)
			.toBe(true)
	})
})
