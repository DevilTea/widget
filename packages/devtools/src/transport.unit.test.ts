import { describe, expect, it } from 'vitest'
import { createInspectorClient } from './client'
import { createMessagePortInspectorTransport } from './transport'

function waitForClose(transport: ReturnType<typeof createMessagePortInspectorTransport>): Promise<void> {
	return new Promise((resolve) => {
		transport.subscribeClose(resolve)
	})
}

describe('messagePort Inspector transport', () => {
	it('round-trips through a native MessageChannel with JSON-cloned wire identity', async () => {
		const channel = new MessageChannel()
		const left = createMessagePortInspectorTransport(channel.port1)
		const right = createMessagePortInspectorTransport(channel.port2)
		try {
			const original = { nested: { value: 1 }, list: ['a', 'b'] }
			const received = new Promise<unknown>(resolve => right.subscribe(resolve))
			left.send(original)

			const result = await received
			expect(result)
				.toEqual(original)
			expect(result).not.toBe(original)
			expect((result as typeof original).nested).not.toBe(original.nested)
		}
		finally {
			left.close()
			right.close()
		}
	})

	it('propagates peer close and rejects pending client requests as disconnected', async () => {
		const channel = new MessageChannel()
		const clientTransport = createMessagePortInspectorTransport(channel.port1)
		const peerTransport = createMessagePortInspectorTransport(channel.port2)
		const client = createInspectorClient(clientTransport)
		try {
			const pending = client.request('runtime.list', {})
			const closed = waitForClose(clientTransport)
			peerTransport.close()
			await closed

			expect(clientTransport.closed)
				.toBe(true)
			await expect(pending)
				.rejects.toMatchObject({ protocolError: expect.objectContaining({ code: 'disconnected' }) })
			expect(() => clientTransport.send({ kind: 'ignored' }))
				.toThrow('Inspector transport is closed.')
		}
		finally {
			client.dispose()
			peerTransport.close()
		}
	})

	it('notifies local close subscribers exactly once and closes idempotently', () => {
		const channel = new MessageChannel()
		const transport = createMessagePortInspectorTransport(channel.port1)
		const peer = createMessagePortInspectorTransport(channel.port2)
		let closes = 0
		transport.subscribeClose(() => closes++)

		transport.close()
		transport.close()

		expect(transport.closed)
			.toBe(true)
		expect(closes)
			.toBe(1)
		peer.close()
	})
})
