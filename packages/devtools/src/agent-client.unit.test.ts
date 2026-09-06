import type { InspectorRequestMessage, InspectorResponseMessage } from './protocol'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { INSPECTOR_PROTOCOL_VERSION, parseInspectorResponseMessage } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'

interface FixtureInterfaces {
	state: { count: number }
	properties: { doubled: number }
}

function createFixture() {
	let computeCalls = 0
	const plugin = createWidgetPlugin('devtools-fixture')
		.description('DevTools fixture')
		.interfaces<FixtureInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 2,
		}))
		.properties(properties => properties.doubled({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps }) => {
				computeCalls++
				deps.count()
				return 4
			},
		}))
		.done()
	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'devtools-fixture' })
	if (blueprint.status !== 'valid')
		throw new Error('fixture must compile')
	const runtime = blueprint.createRuntime()
	return { runtime, getComputeCalls: () => computeCalls }
}

function containsFunction(value: unknown, seen = new Set<object>()): boolean {
	if (typeof value === 'function')
		return true
	if (typeof value !== 'object' || value === null || seen.has(value))
		return false
	seen.add(value)
	return Object.values(value)
		.some(candidate => containsFunction(candidate, seen))
}

describe('inspector client/agent protocol boundary', () => {
	it('handshakes, lists the Runtime, and projects Blueprint/Runtime facts without leaking Core objects', async () => {
		const { runtime, getComputeCalls } = createFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-test' })
		const client = createInspectorClient(pair.client)

		const handshake = await client.request('handshake', { protocol: INSPECTOR_PROTOCOL_VERSION })
		expect(handshake.protocol.major)
			.toBe(INSPECTOR_PROTOCOL_VERSION.major)
		expect(handshake.capabilities.methods)
			.toContain('blueprint.getSnapshot')

		const { runtimes } = await client.request('runtime.list', {})
		expect(runtimes)
			.toEqual([{ runtimeId: 'runtime-test', rootNodeId: expect.any(Number) }])

		const blueprint = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-test' })
		expect(blueprint.nodes[0])
			.toMatchObject({
				resolved: true,
				widgetId: 'root',
				widgetType: 'devtools-fixture',
			})
		expect(blueprint.nodes[0]).not.toHaveProperty('node')
		expect(blueprint.nodes[0]).not.toHaveProperty('plugin')
		expect(containsFunction(blueprint))
			.toBe(false)
		expect(JSON.parse(JSON.stringify(blueprint)))
			.toEqual(blueprint)

		const widget = await client.request('runtime.getWidgetSnapshot', {
			ref: { runtimeId: 'runtime-test', nodeId: runtimes[0]!.rootNodeId },
		})
		expect(widget.members)
			.toEqual(expect.arrayContaining([
				{ type: 'state', name: 'count', value: { type: 'number', value: 2 } },
				{ type: 'property', name: 'doubled', snapshot: { status: 'never-evaluated' } },
			]))
		expect(getComputeCalls())
			.toBe(0)
		expect(containsFunction(widget))
			.toBe(false)
		expect(JSON.parse(JSON.stringify(widget)))
			.toEqual(widget)

		client.dispose()
		agent.dispose()
	})

	it('correlates concurrent responses by requestId even when the peer replies out of order', async () => {
		const pair = createInProcessInspectorTransportPair()
		const client = createInspectorClient(pair.client)
		const requests: InspectorRequestMessage[] = []
		pair.agent.subscribe(raw => requests.push(raw as InspectorRequestMessage))

		const first = client.request('runtime.list', {})
		const second = client.request('runtime.list', {})
		expect(requests)
			.toHaveLength(2)
		const firstRequest = requests[0]!
		const secondRequest = requests[1]!

		pair.agent.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: secondRequest.requestId,
			ok: true,
			result: { runtimes: [{ runtimeId: 'second', rootNodeId: 2 }] },
		})
		pair.agent.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: firstRequest.requestId,
			ok: true,
			result: { runtimes: [{ runtimeId: 'first', rootNodeId: 1 }] },
		})

		await expect(first).resolves.toEqual({ runtimes: [{ runtimeId: 'first', rootNodeId: 1 }] })
		await expect(second).resolves.toEqual({ runtimes: [{ runtimeId: 'second', rootNodeId: 2 }] })
		client.dispose()
		pair.agent.close()
	})

	it('rejects in-flight and future requests when the peer transport disconnects', async () => {
		const pair = createInProcessInspectorTransportPair()
		const client = createInspectorClient(pair.client)
		const pending = client.request('runtime.list', {})

		pair.agent.close()

		await expect(pending).rejects.toMatchObject({ code: 'disconnected' })
		await expect(client.request('runtime.list', {})).rejects.toMatchObject({ code: 'disconnected' })
	})

	it('runtime-validates malformed requests and rejects incompatible major versions', () => {
		const { runtime } = createFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-test' })
		const responses: InspectorResponseMessage[] = []
		pair.client.subscribe((raw) => {
			const parsed = parseInspectorResponseMessage(raw)
			if (parsed !== null)
				responses.push(parsed)
		})

		pair.client.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'request',
			requestId: 'bad-params',
			method: 'runtime.getWidgetSnapshot',
			params: { ref: { runtimeId: 42, nodeId: 'bad' } },
		})
		pair.client.send({
			protocol: { major: 99, minor: 0 },
			kind: 'request',
			requestId: 'bad-version',
			method: 'runtime.list',
			params: {},
		})

		expect(responses)
			.toEqual([
				expect.objectContaining({ requestId: 'bad-params', ok: false, error: expect.objectContaining({ code: 'invalid-message' }) }),
				expect.objectContaining({ requestId: 'bad-version', ok: false, error: expect.objectContaining({ code: 'unsupported-version' }) }),
			])
		agent.dispose()
	})

	it('ignores non-request envelopes instead of replying to responses with another response', () => {
		const { runtime } = createFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-test' })
		const responses: unknown[] = []
		pair.client.subscribe(raw => responses.push(raw))

		pair.client.send({
			protocol: INSPECTOR_PROTOCOL_VERSION,
			kind: 'response',
			requestId: 'not-a-request',
			ok: true,
			result: {},
		})

		expect(responses)
			.toHaveLength(0)
		agent.dispose()
	})

	it('returns a protocol error when a new member subscription is attempted after Runtime disposal', async () => {
		const { runtime } = createFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-test' })
		const client = createInspectorClient(pair.client)
		const { runtimes } = await client.request('runtime.list', {})
		runtime.dispose()

		await expect(client.request('runtime.subscribeMember', {
			ref: { runtimeId: 'runtime-test', nodeId: runtimes[0]!.rootNodeId },
			member: { type: 'property', name: 'doubled' },
		})).rejects.toMatchObject({ code: 'internal-error' })

		client.dispose()
		agent.dispose()
	})

	it('distinguishes an unknown Runtime identity from a missing widget', async () => {
		const { runtime } = createFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-test' })
		const client = createInspectorClient(pair.client)
		const { runtimes } = await client.request('runtime.list', {})
		const wrongRuntimeRef = { runtimeId: 'other-runtime', nodeId: runtimes[0]!.rootNodeId }

		await expect(client.request('runtime.getWidgetSnapshot', { ref: wrongRuntimeRef }))
			.rejects.toMatchObject({ code: 'runtime-not-found' })
		await expect(client.request('runtime.subscribeMember', {
			ref: wrongRuntimeRef,
			member: { type: 'state', name: 'count' },
		}))
			.rejects.toMatchObject({ code: 'runtime-not-found' })
		await expect(client.request('highlight.show', { ref: wrongRuntimeRef }))
			.rejects.toMatchObject({ code: 'runtime-not-found' })

		client.dispose()
		agent.dispose()
	})

	it('subscribes passively and emits encoded member changes only after real Runtime activity', async () => {
		const { runtime, getComputeCalls } = createFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-test' })
		const client = createInspectorClient(pair.client)
		const { runtimes } = await client.request('runtime.list', {})
		const ref = { runtimeId: 'runtime-test', nodeId: runtimes[0]!.rootNodeId }
		const changes = vi.fn()
		client.on('runtime.memberChanged', changes)

		const subscription = await client.request('runtime.subscribeMember', {
			ref,
			member: { type: 'property', name: 'doubled' },
		})
		expect(subscription.member)
			.toEqual({ type: 'property', name: 'doubled', snapshot: { status: 'never-evaluated' } })
		expect(getComputeCalls())
			.toBe(0)
		expect(changes).not.toHaveBeenCalled()

		const widget = runtime.getWidget('root')!
		expect(widget.properties.doubled.get())
			.toEqual({ ok: true, value: 4 })
		expect(getComputeCalls())
			.toBe(1)
		expect(changes)
			.toHaveBeenCalledTimes(1)
		expect(changes.mock.calls[0]![0])
			.toMatchObject({
				ref,
				member: { type: 'property', name: 'doubled', snapshot: { status: 'completed' } },
			})

		await client.request('runtime.unsubscribeMember', { subscriptionId: subscription.subscriptionId })
		client.dispose()
		agent.dispose()
	})
})
