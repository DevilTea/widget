// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient, InspectorClientError } from './client'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair, createMessagePortInspectorTransport } from './transport'

const originalElementsFromPoint = document.elementsFromPoint

afterEach(() => {
	document.elementsFromPoint = originalElementsFromPoint
})

function failHitTesting(): void {
	document.elementsFromPoint = () => {
		throw new Error('synthetic DOM failure')
	}
}

describe('inspectorAgent request catch-all', () => {
	it('answers a throwing handler with an internal-error InspectorClientError and keeps serving (in-process)', async () => {
		failHitTesting()
		const fixture = createInspectorTestFixture()
		const root = document.createElement('div')
		document.body.append(root)
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-x', dom: { root } })
		const client = createInspectorClient(pair.client)
		try {
			const error = await client.request('inspect.hitTest', { coordinateSpace: 'preview-viewport', x: 1, y: 1 })
				.catch((reason: unknown) => reason)
			expect(error)
				.toBeInstanceOf(InspectorClientError)
			expect(error)
				.toMatchObject({ code: 'internal-error' })
			// The failure detail stays inside the Agent's realm.
			expect((error as Error).message).not.toContain('synthetic DOM failure')

			expect(await client.request('runtime.list', {}))
				.toEqual({ runtimes: [{ runtimeId: 'runtime-x', rootNodeId: expect.any(Number) }] })
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('settles the request over a MessagePort instead of leaving it pending forever', async () => {
		failHitTesting()
		const fixture = createInspectorTestFixture()
		const root = document.createElement('div')
		document.body.append(root)
		const channel = new MessageChannel()
		const agent = createInspectorAgent({
			runtime: fixture.runtime,
			transport: createMessagePortInspectorTransport(channel.port2),
			dom: { root },
		})
		const client = createInspectorClient(createMessagePortInspectorTransport(channel.port1), { requestTimeoutMs: 2000 })
		try {
			await expect(client.request('inspect.hitTest', { coordinateSpace: 'preview-viewport', x: 1, y: 1 }))
				.rejects.toMatchObject({ code: 'internal-error' })
			await expect(client.request('runtime.list', {}))
				.resolves.toMatchObject({ runtimes: [expect.anything()] })
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('answers internal-error when the response itself cannot be serialized, then keeps serving', async () => {
		const fixture = createInspectorTestFixture()
		const pair = createInProcessInspectorTransportPair()
		const responses: unknown[] = []
		pair.client.subscribe(message => responses.push(message))
		const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-x' })
		const originalSend = pair.agent.send.bind(pair.agent)
		let failNext = true
		pair.agent.send = (message) => {
			if (failNext && (message as { ok?: boolean }).ok === true) {
				failNext = false
				throw new TypeError('not serializable')
			}
			originalSend(message)
		}
		try {
			pair.client.send({ protocol: { major: 0, minor: 3 }, kind: 'request', requestId: 'a', method: 'runtime.list', params: {} })
			pair.client.send({ protocol: { major: 0, minor: 3 }, kind: 'request', requestId: 'b', method: 'runtime.list', params: {} })
			expect(responses)
				.toMatchObject([
					{ requestId: 'a', ok: false, error: { code: 'internal-error' } },
					{ requestId: 'b', ok: true },
				])
		}
		finally {
			agent.dispose()
		}
	})
})
