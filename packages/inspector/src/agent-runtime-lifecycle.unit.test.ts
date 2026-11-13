import type { InspectorEventMessage } from './protocol'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { INSPECTOR_PROTOCOL_VERSION, parseInspectorEventMessage, parseInspectorResponseMessage } from './protocol'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

function createFixture(options: { readonly closeTransportOnDispose?: boolean, readonly maxSubscriptions?: number } = {}) {
	const fixture = createInspectorTestFixture()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({
		runtime: fixture.runtime,
		transport: pair.agent,
		runtimeId: 'runtime-x',
		...options,
	})
	const client = createInspectorClient(pair.client)
	const events: InspectorEventMessage[] = []
	client.subscribe(event => events.push(event))
	const disposedEvents = () => events.filter(event => event.event === 'runtime.disposed')
	return { ...fixture, pair, agent, client, events, disposedEvents }
}

/** The ref of the fixture's counter widget, which owns the `count` State. */
async function counterRef(client: ReturnType<typeof createFixture>['client']) {
	const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })
	return { runtimeId: 'runtime-x', nodeId: snapshot.nodes.find(node => node.widgetId === 'counter')!.nodeId }
}

describe('runtime lifecycle visibility (protocol 0.4)', () => {
	it('tells the client when the Runtime is disposed and stops listing it', async () => {
		const { runtime, agent, client, disposedEvents } = createFixture()
		try {
			await client.handshake()
			const ref = await counterRef(client)
			runtime.dispose()

			expect(await client.request('runtime.list', {}))
				.toEqual({ runtimes: [] })
			expect(disposedEvents())
				.toEqual([{
					protocol: INSPECTOR_PROTOCOL_VERSION,
					kind: 'event',
					event: 'runtime.disposed',
					payload: { runtimeId: 'runtime-x', reason: 'runtime-disposed' },
				}])

			await expect(client.request('runtime.subscribeMember', { ref, member: { type: 'state', name: 'count' } }))
				.rejects.toMatchObject({ code: 'runtime-disposed' })
			await expect(client.request('runtime.subscribeEvent', { ref, event: 'anything' }))
				.rejects.toMatchObject({ code: 'runtime-disposed' })
			await expect(client.request('runtime.getWidgetSnapshot', { ref }))
				.rejects.toMatchObject({ code: 'runtime-disposed' })
			await expect(client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' }))
				.rejects.toMatchObject({ code: 'runtime-disposed' })
			// An unrelated Runtime id is still simply unknown, and the event is sent once.
			await expect(client.request('blueprint.getSnapshot', { runtimeId: 'other' }))
				.rejects.toMatchObject({ code: 'runtime-not-found' })
			expect(disposedEvents())
				.toHaveLength(1)
			// Releasing a subscription stays a harmless no-op.
			expect(await client.request('runtime.unsubscribeMember', { subscriptionId: 'nope' }))
				.toEqual({ removed: false })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('keeps the previous behaviour for a peer negotiated below 0.4', async () => {
		const { runtime, agent, client, disposedEvents } = createFixture()
		try {
			const handshake = await client.request('handshake', { protocol: { major: 0, minor: 3 } })
			expect(handshake.capabilities.events).not.toContain('runtime.disposed')
			const ref = await counterRef(client)
			runtime.dispose()

			const { runtimes } = await client.request('runtime.list', {})
			expect(runtimes)
				.toHaveLength(1)
			await expect(client.request('runtime.subscribeMember', { ref, member: { type: 'state', name: 'count' } }))
				.rejects.toMatchObject({ code: 'internal-error' })
			expect((await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })).runtimeId)
				.toBe('runtime-x')
			expect(disposedEvents())
				.toHaveLength(0)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('advertises the event only from 0.4 on', async () => {
		const { agent, client } = createFixture()
		try {
			expect((await client.request('handshake', { protocol: INSPECTOR_PROTOCOL_VERSION })).capabilities.events)
				.toContain('runtime.disposed')
			expect((await client.request('handshake', { protocol: { major: 0, minor: 3 } })).capabilities.events).not.toContain('runtime.disposed')
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('tells the client when the Agent is disposed while the transport stays open', async () => {
		const { agent, client, pair, disposedEvents } = createFixture({ closeTransportOnDispose: false })
		try {
			await client.handshake()
			agent.dispose()
			expect(pair.agent.closed)
				.toBe(false)
			expect(disposedEvents())
				.toMatchObject([{ payload: { runtimeId: 'runtime-x', reason: 'agent-disposed' } }])
			// Disposing again does not repeat it.
			agent.dispose()
			expect(disposedEvents())
				.toHaveLength(1)
		}
		finally {
			client.dispose()
		}
	})

	it('does not announce a second disposal for a Runtime whose disposal was already observed', async () => {
		const { runtime, agent, client, disposedEvents } = createFixture({ closeTransportOnDispose: false })
		try {
			await client.handshake()
			runtime.dispose()
			await client.request('runtime.list', {})
			agent.dispose()
			expect(disposedEvents())
				.toMatchObject([{ payload: { reason: 'runtime-disposed' } }])
		}
		finally {
			client.dispose()
		}
	})

	it('sends no disposal event to a peer negotiated below 0.4 or when it closes the transport', async () => {
		const legacy = createFixture({ closeTransportOnDispose: false })
		try {
			await legacy.client.request('handshake', { protocol: { major: 0, minor: 3 } })
			legacy.agent.dispose()
			expect(legacy.disposedEvents())
				.toHaveLength(0)
		}
		finally {
			legacy.client.dispose()
		}

		const closing = createFixture()
		try {
			await closing.client.handshake()
			closing.agent.dispose()
			expect(closing.pair.client.closed)
				.toBe(true)
			expect(closing.disposedEvents())
				.toHaveLength(0)
		}
		finally {
			closing.client.dispose()
		}
	})

	it('releases the subscriptions it counted once the Runtime is observed disposed', async () => {
		const { runtime, agent, client } = createFixture({ maxSubscriptions: 1 })
		try {
			await client.handshake()
			const ref = await counterRef(client)
			await client.request('runtime.subscribeMember', { ref, member: { type: 'state', name: 'count' } })
			runtime.dispose()
			await client.request('runtime.list', {})
			// The cap is no longer what answers: the Runtime being gone is.
			await expect(client.request('runtime.subscribeMember', { ref, member: { type: 'state', name: 'count' } }))
				.rejects.toMatchObject({ code: 'runtime-disposed' })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('only accepts the new code and event on envelopes of 0.4 or newer', () => {
		const error = { code: 'runtime-disposed', message: 'gone' }
		expect(parseInspectorResponseMessage({ protocol: { major: 0, minor: 4 }, kind: 'response', requestId: 'r', ok: false, error }))
			.not
			.toBeNull()
		expect(parseInspectorResponseMessage({ protocol: { major: 0, minor: 3 }, kind: 'response', requestId: 'r', ok: false, error }))
			.toBeNull()

		const event = {
			protocol: { major: 0, minor: 4 },
			kind: 'event',
			event: 'runtime.disposed',
			payload: { runtimeId: 'r', reason: 'agent-disposed' },
		}
		expect(parseInspectorEventMessage(event))
			.toEqual(event)
		expect(parseInspectorEventMessage({ ...event, payload: { runtimeId: 'r', reason: 'other' } }))
			.toBeNull()
		expect(parseInspectorEventMessage({ ...event, payload: { reason: 'agent-disposed' } }))
			.toBeNull()
	})
})
