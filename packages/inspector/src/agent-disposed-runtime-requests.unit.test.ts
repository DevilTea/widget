// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

afterEach(() => {
	document.body.innerHTML = ''
})

function createFixture() {
	const fixture = createInspectorTestFixture()
	const root = document.createElement('div')
	document.body.append(root)
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-x', dom: { root } })
	const client = createInspectorClient(pair.client)
	return { ...fixture, agent, client }
}

async function counterRef(client: ReturnType<typeof createFixture>['client']) {
	const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })
	return { runtimeId: 'runtime-x', nodeId: snapshot.nodes.find(node => node.widgetId === 'counter')!.nodeId }
}

describe('requests on a disposed Runtime', () => {
	it('answers runtime-disposed to every method that depends on the live Runtime from 0.4, including the DOM methods', async () => {
		const { runtime, agent, client } = createFixture()
		try {
			await client.handshake()
			const ref = await counterRef(client)
			runtime.dispose()

			await expect(client.request('inspect.hitTest', { coordinateSpace: 'preview-viewport', x: 1, y: 1 }))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
			await expect(client.request('inspect.enable', {}))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
			await expect(client.request('highlight.show', { ref }))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
			await expect(client.request('highlight.clear', {}))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
			await expect(client.request('geometry.resolve', { ref }))
				.rejects
				.toMatchObject({ code: 'runtime-disposed' })
			// Enabling inspect mode on a dead Runtime must not have taken effect.
			expect(agent.inspectEnabled)
				.toBe(false)

			// Releasing things the peer holds stays answerable.
			expect(await client.request('inspect.disable', {}))
				.toEqual({ enabled: false })
			expect(await client.request('runtime.unsubscribeMember', { subscriptionId: 'nope' }))
				.toEqual({ removed: false })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('still answers them normally while the Runtime is live', async () => {
		const { agent, client } = createFixture()
		try {
			await client.handshake()
			expect(await client.request('inspect.enable', {}))
				.toEqual({ enabled: true })
			expect(await client.request('highlight.clear', {}))
				.toEqual({ highlighted: false })
			expect(await client.request('inspect.hitTest', { coordinateSpace: 'preview-viewport', x: 1, y: 1 }))
				.toBeDefined()
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('keeps the previous behavior for a peer negotiated below 0.4', async () => {
		const { runtime, agent, client } = createFixture()
		try {
			await client.request('handshake', { protocol: { major: 0, minor: 3 } })
			runtime.dispose()

			expect(await client.request('inspect.enable', {}))
				.toEqual({ enabled: true })
			expect(await client.request('highlight.clear', {}))
				.toEqual({ highlighted: false })
			expect(await client.request('inspect.hitTest', { coordinateSpace: 'preview-viewport', x: 1, y: 1 }))
				.toBeDefined()
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})
