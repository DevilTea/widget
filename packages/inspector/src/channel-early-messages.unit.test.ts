import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createMessagePortChannelHub } from './channel'
import { createInspectorClient } from './client'
import { createInspectorTestFixture } from './test-fixture'

const sleep = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms))

function createHubs() {
	const native = new MessageChannel()
	const left = createMessagePortChannelHub(native.port1)
	const right = createMessagePortChannelHub(native.port2)
	return {
		left,
		right,
		close() {
			left.close()
			right.close()
		},
	}
}

function collect(transport: ReturnType<ReturnType<typeof createMessagePortChannelHub>['openChannel']>): unknown[] {
	const received: unknown[] = []
	transport.subscribe(message => received.push(message))
	return received
}

describe('messagePort channel hub early messages and reuse', () => {
	it('buffers messages for a channel the peer has not opened yet and delivers them in order on open', async () => {
		const hubs = createHubs()
		try {
			const sender = hubs.left.openChannel('inspector')
			sender.send({ n: 1 })
			sender.send({ n: 2 })
			sender.send({ n: 3 })
			await sleep()

			const receiver = hubs.right.openChannel('inspector')
			const received = collect(receiver)
			expect(received)
				.toEqual([])
			await sleep()
			expect(received)
				.toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])

			// Live messages after the flush keep their order behind the buffered ones.
			sender.send({ n: 4 })
			await sleep()
			expect(received)
				.toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }])
		}
		finally {
			hubs.close()
		}
	})

	it('keeps order when a live message arrives while the buffered ones are still being flushed', async () => {
		const hubs = createHubs()
		try {
			const sender = hubs.left.openChannel('inspector')
			sender.send({ n: 1 })
			await sleep()
			const receiver = hubs.right.openChannel('inspector')
			const received = collect(receiver)
			sender.send({ n: 2 })
			await sleep()
			expect(received)
				.toEqual([{ n: 1 }, { n: 2 }])
		}
		finally {
			hubs.close()
		}
	})

	it('drops the oldest buffered messages beyond the per-channel bound', async () => {
		const hubs = createHubs()
		try {
			const sender = hubs.left.openChannel('inspector')
			for (let n = 0; n < 100; n++)
				sender.send({ n })
			await sleep(60)
			const received = collect(hubs.right.openChannel('inspector'))
			await sleep()
			expect(received)
				.toHaveLength(64)
			expect(received[0])
				.toEqual({ n: 36 })
			expect(received.at(-1))
				.toEqual({ n: 99 })
		}
		finally {
			hubs.close()
		}
	})

	it('caps how many unopened channel states a peer can create', async () => {
		const hubs = createHubs()
		try {
			for (let n = 0; n < 40; n++) {
				hubs.left.openChannel(`random-${n}`)
					.send({ n })
			}
			await sleep(60)
			const buffered: number[] = []
			for (let n = 0; n < 40; n++) {
				const received = collect(hubs.right.openChannel(`random-${n}`))
				await sleep(2)
				if (received.length > 0)
					buffered.push(n)
			}
			expect(buffered)
				.toEqual(Array.from({ length: 16 }, (_, n) => n))
			// A channel opened normally afterwards still works.
			const sender = hubs.left.openChannel('after')
			const received = collect(hubs.right.openChannel('after'))
			sender.send('hello')
			await sleep()
			expect(received)
				.toEqual(['hello'])
		}
		finally {
			hubs.close()
		}
	})

	it('yields a fresh working transport when a name is reopened after the peer closed it', async () => {
		const hubs = createHubs()
		try {
			const left1 = hubs.left.openChannel('x')
			const right1 = hubs.right.openChannel('x')
			left1.close()
			await sleep()
			expect(right1.closed)
				.toBe(true)

			const right2 = hubs.right.openChannel('x')
			const left2 = hubs.left.openChannel('x')
			expect(right2.closed)
				.toBe(false)
			expect(left2.closed)
				.toBe(false)
			expect(right2)
				.not
				.toBe(right1)
			const rightReceived = collect(right2)
			const leftReceived = collect(left2)
			left2.send('to-right')
			right2.send('to-left')
			await sleep()
			expect(rightReceived)
				.toEqual(['to-right'])
			expect(leftReceived)
				.toEqual(['to-left'])
			// The closed generation stays closed.
			expect(() => right1.send('stale'))
				.toThrow('closed')
		}
		finally {
			hubs.close()
		}
	})

	it('yields a fresh transport when the local side closed and reopens a name', async () => {
		const hubs = createHubs()
		try {
			const first = hubs.left.openChannel('x')
			first.close()
			const second = hubs.left.openChannel('x')
			expect(first.closed)
				.toBe(true)
			expect(second.closed)
				.toBe(false)
			// The peer opens after it has seen the close of the first generation.
			await sleep()
			const peer = hubs.right.openChannel('x')
			const received = collect(peer)
			second.send('again')
			await sleep()
			expect(received)
				.toEqual(['again'])
		}
		finally {
			hubs.close()
		}
	})

	it('treats messages after a peer close as a new session the local side can open later', async () => {
		const hubs = createHubs()
		try {
			const left1 = hubs.left.openChannel('x')
			const right1 = hubs.right.openChannel('x')
			left1.close()
			await sleep()
			expect(right1.closed)
				.toBe(true)

			hubs.left.openChannel('x')
				.send('second-session')
			await sleep()
			const received = collect(hubs.right.openChannel('x'))
			await sleep()
			expect(received)
				.toEqual(['second-session'])
		}
		finally {
			hubs.close()
		}
	})

	it('discards messages buffered for a channel the peer closed before it was ever opened', async () => {
		const hubs = createHubs()
		try {
			const sender = hubs.left.openChannel('x')
			sender.send('lost')
			sender.close()
			await sleep()
			const received = collect(hubs.right.openChannel('x'))
			await sleep()
			expect(received)
				.toEqual([])
			expect(hubs.right.openChannel('x').closed)
				.toBe(false)
		}
		finally {
			hubs.close()
		}
	})

	it('still reports a closed transport for a channel opened on an already closed hub', () => {
		const hubs = createHubs()
		hubs.close()
		expect(hubs.right.openChannel('x').closed)
			.toBe(true)
	})

	it('lets a client handshake sent before the agent opened its channel complete once the agent attaches', async () => {
		const hubs = createHubs()
		const fixture = createInspectorTestFixture()
		const client = createInspectorClient(hubs.left.openChannel('inspector'), { requestTimeoutMs: 2000 })
		try {
			const early = client.handshake()
			await sleep(50)
			const agent = createInspectorAgent({
				runtime: fixture.runtime,
				transport: hubs.right.openChannel('inspector'),
				closeTransportOnDispose: false,
			})
			try {
				await expect(early)
					.resolves.toMatchObject({ capabilities: { methods: expect.arrayContaining(['runtime.list']) } })
			}
			finally {
				agent.dispose()
			}
		}
		finally {
			client.dispose()
			hubs.close()
		}
	})
})
