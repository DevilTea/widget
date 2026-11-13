import type { InspectorEventMessage } from './protocol'
import type { InspectorTransport } from './transport'
import { describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { INSPECTOR_PROTOCOL_VERSION } from './protocol'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

function createBinding(runtime: ReturnType<typeof createInspectorTestFixture>['runtime'], options: { readonly closeTransportOnDispose?: boolean } = {}) {
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-x', ...options })
	const client = createInspectorClient(pair.client)
	const events: InspectorEventMessage[] = []
	client.subscribe(event => events.push(event))
	const disposedEvents = () => events.filter(event => event.event === 'runtime.disposed')
	return { pair, agent, client, events, disposedEvents }
}

function createFixture(options: { readonly closeTransportOnDispose?: boolean } = {}) {
	const fixture = createInspectorTestFixture()
	return { ...fixture, ...createBinding(fixture.runtime, options) }
}

const DISPOSED_EVENT = {
	protocol: INSPECTOR_PROTOCOL_VERSION,
	kind: 'event',
	event: 'runtime.disposed',
	payload: { runtimeId: 'runtime-x', reason: 'runtime-disposed' },
}

describe('runtime disposal is announced when it happens', () => {
	it('tells the peer inside runtime.dispose(), with no request in between', async () => {
		const { runtime, agent, client, disposedEvents } = createFixture()
		try {
			await client.handshake()
			expect(disposedEvents())
				.toHaveLength(0)

			runtime.dispose()

			expect(disposedEvents())
				.toEqual([DISPOSED_EVENT])
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('announces exactly once, not again on a later request, a later event or Agent disposal', async () => {
		const { runtime, agent, client, disposedEvents } = createFixture({ closeTransportOnDispose: false })
		try {
			await client.handshake()
			runtime.dispose()
			expect(disposedEvents())
				.toHaveLength(1)

			await client.request('runtime.list', {})
			await expect(client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' }))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
			expect(disposedEvents())
				.toHaveLength(1)

			agent.dispose()
			expect(disposedEvents())
				.toEqual([DISPOSED_EVENT])
		}
		finally {
			client.dispose()
		}
	})

	it('sends nothing to a peer negotiated below 0.4, neither at disposal nor afterwards', async () => {
		const { runtime, agent, client, disposedEvents } = createFixture({ closeTransportOnDispose: false })
		try {
			await client.request('handshake', { protocol: { major: 0, minor: 3 } })
			runtime.dispose()
			expect(disposedEvents())
				.toHaveLength(0)

			await client.request('runtime.list', {})
			agent.dispose()
			expect(disposedEvents())
				.toHaveLength(0)
		}
		finally {
			client.dispose()
		}
	})

	it('announces to a peer that has not handshaken yet, at the Agent\'s own minor, and does not repeat it after a later handshake', async () => {
		const { runtime, agent, client, disposedEvents, events } = createFixture()
		try {
			runtime.dispose()
			// Before any handshake the Agent serves events at its highest minor, so the peer is told at once.
			expect(disposedEvents())
				.toEqual([DISPOSED_EVENT])

			const handshake = await client.request('handshake', { protocol: { major: 0, minor: 3 } })
			expect(handshake.capabilities.events)
				.not
				.toContain('runtime.disposed')
			await client.request('runtime.list', {})
			expect(events.filter(event => event.event === 'runtime.disposed'))
				.toHaveLength(1)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('does not make runtime.dispose() throw when the transport throws on send, and still runs later listeners', async () => {
		const { runtime, agent, client, pair, disposedEvents } = createFixture()
		try {
			await client.handshake()
			const send = vi.spyOn(pair.agent, 'send')
				.mockImplementation(() => {
					throw new Error('transport failed')
				})
			const later = vi.fn()
			runtime.subscribeDisposal(later)

			expect(() => runtime.dispose())
				.not
				.toThrow()
			expect(send)
				.toHaveBeenCalledTimes(1)
			expect(later)
				.toHaveBeenCalledTimes(1)

			// The peer could not be told, and the Agent does not retry.
			send.mockRestore()
			await client.request('runtime.list', {})
			expect(disposedEvents())
				.toHaveLength(0)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('does not send and does not throw when the transport is already closed', () => {
		const { runtime } = createInspectorTestFixture()
		const send = vi.fn()
		const transport: InspectorTransport = {
			send,
			subscribe: () => () => {},
			// A transport that reports itself closed without having told its subscribers yet.
			subscribeClose: () => () => {},
			close: () => {},
			closed: true,
		}
		const agent = createInspectorAgent({ runtime, transport, runtimeId: 'runtime-x' })
		try {
			expect(() => runtime.dispose())
				.not
				.toThrow()
			expect(send)
				.not
				.toHaveBeenCalled()
		}
		finally {
			agent.dispose()
		}
	})

	it('creates an Agent on an already disposed Runtime without throwing and announces on the first request', async () => {
		const fixture = createInspectorTestFixture()
		fixture.runtime.dispose()
		const { agent, client, disposedEvents } = createBinding(fixture.runtime)
		try {
			expect(disposedEvents())
				.toHaveLength(0)

			expect(await client.request('runtime.list', {}))
				.toEqual({ runtimes: [] })
			expect(disposedEvents())
				.toEqual([DISPOSED_EVENT])
			await client.request('runtime.list', {})
			expect(disposedEvents())
				.toHaveLength(1)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('announces an already disposed Runtime when the Agent is disposed before any request', async () => {
		const fixture = createInspectorTestFixture()
		fixture.runtime.dispose()
		const { agent, client, disposedEvents } = createBinding(fixture.runtime, { closeTransportOnDispose: false })
		try {
			agent.dispose()
			expect(disposedEvents())
				.toEqual([DISPOSED_EVENT])
		}
		finally {
			client.dispose()
		}
	})

	it('sends nothing and throws nothing when the Runtime is disposed after its Agent', async () => {
		const { runtime, agent, client, pair, disposedEvents } = createFixture({ closeTransportOnDispose: false })
		try {
			await client.handshake()
			agent.dispose()
			expect(disposedEvents())
				.toMatchObject([{ payload: { reason: 'agent-disposed' } }])
			const send = vi.spyOn(pair.agent, 'send')

			expect(() => runtime.dispose())
				.not
				.toThrow()

			expect(send)
				.not
				.toHaveBeenCalled()
			expect(disposedEvents())
				.toHaveLength(1)
		}
		finally {
			client.dispose()
		}
	})

	it('announces to every Agent bound to the Runtime, each on its own transport', async () => {
		const fixture = createInspectorTestFixture()
		const first = createBinding(fixture.runtime)
		const second = createBinding(fixture.runtime)
		try {
			await first.client.handshake()
			await second.client.handshake()

			fixture.runtime.dispose()

			expect(first.disposedEvents())
				.toEqual([DISPOSED_EVENT])
			expect(second.disposedEvents())
				.toEqual([DISPOSED_EVENT])
		}
		finally {
			first.client.dispose()
			first.agent.dispose()
			second.client.dispose()
			second.agent.dispose()
		}
	})
})
