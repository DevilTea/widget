// @vitest-environment happy-dom
import type { InspectorEventMessage } from './protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

const DOM_METHODS = ['inspect.enable', 'inspect.disable', 'highlight.show', 'highlight.clear'] as const

const sleep = (ms = 40) => new Promise<void>(resolve => setTimeout(resolve, ms))

afterEach(() => {
	vi.restoreAllMocks()
	document.body.innerHTML = ''
})

function createFixture(withDom: boolean) {
	const fixture = createInspectorTestFixture()
	const root = document.createElement('div')
	const outer = document.createElement('section')
	outer.dataset.widgetId = 'root'
	outer.dataset.widgetType = 'DevtoolsRoot'
	const inner = document.createElement('button')
	inner.dataset.widgetId = 'counter'
	inner.dataset.widgetType = 'DevtoolsCounter'
	outer.append(inner)
	root.append(outer)
	const outside = document.createElement('p')
	document.body.append(root, outside)
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({
		runtime: fixture.runtime,
		transport: pair.agent,
		runtimeId: 'runtime-x',
		...(withDom ? { dom: { root } } : {}),
	})
	const client = createInspectorClient(pair.client)
	const events: InspectorEventMessage[] = []
	client.subscribe(event => events.push(event))
	return { ...fixture, root, outer, inner, outside, agent, client, events }
}

describe('inspectorAgent without a DOM root', () => {
	it.each([1, 2, 3, 4])('does not advertise the DOM methods at protocol 0.%i', async (minor) => {
		const { agent, client } = createFixture(false)
		try {
			const handshake = await client.request('handshake', { protocol: { major: 0, minor } })
			for (const method of DOM_METHODS)
				expect(handshake.capabilities.methods).not.toContain(method)
			expect(handshake.capabilities.methods)
				.toContain('runtime.list')
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('answers the DOM methods with unknown-method instead of vacuously succeeding', async () => {
		const { agent, client } = createFixture(false)
		try {
			await client.handshake()
			const ref = { runtimeId: 'runtime-x', nodeId: 0 }
			await expect(client.request('inspect.enable', {}))
				.rejects.toMatchObject({ code: 'unknown-method' })
			await expect(client.request('inspect.disable', {}))
				.rejects.toMatchObject({ code: 'unknown-method' })
			await expect(client.request('highlight.show', { ref }))
				.rejects.toMatchObject({ code: 'unknown-method' })
			await expect(client.request('highlight.clear', {}))
				.rejects.toMatchObject({ code: 'unknown-method' })
			expect(agent.inspectEnabled)
				.toBe(false)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('keeps advertising and serving the DOM methods when a DOM root is configured', async () => {
		const { agent, client } = createFixture(true)
		try {
			const handshake = await client.handshake()
			for (const method of DOM_METHODS) {
				expect(handshake.capabilities.methods)
					.toContain(method)
			}
			expect(await client.request('inspect.enable', {}))
				.toEqual({ enabled: true })
			expect(agent.inspectEnabled)
				.toBe(true)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})

describe('inspectorAgent lazy geometry observation', () => {
	it('observes nothing at creation and stays silent about unrelated document changes', async () => {
		const observers: unknown[] = []
		const OriginalObserver = MutationObserver
		vi.stubGlobal('MutationObserver', class extends OriginalObserver {
			constructor(callback: MutationCallback) {
				super(callback)
				observers.push(this)
			}
		})
		const documentListeners: string[] = []
		const addListener = document.addEventListener.bind(document)
		vi.spyOn(document, 'addEventListener')
			.mockImplementation(((type: string, ...rest: [EventListenerOrEventListenerObject, ...unknown[]]) => {
				documentListeners.push(type)
				return addListener(type, ...rest as [EventListenerOrEventListenerObject])
			}) as typeof document.addEventListener)

		const { agent, client, outside, events } = createFixture(true)
		try {
			await client.handshake()
			expect(observers)
				.toHaveLength(0)
			expect(documentListeners).not.toContain('scroll')
			outside.textContent = 'changed'
			await sleep()
			expect(events.filter(event => event.event === 'geometry.invalidated'))
				.toHaveLength(0)
			vi.unstubAllGlobals()
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it.each([
		['geometry.resolve', (ref: { runtimeId: string, nodeId: number }) => ['geometry.resolve', { ref }] as const],
		['inspect.hitTest', () => ['inspect.hitTest', { coordinateSpace: 'preview-viewport', x: 1, y: 1 }] as const],
		['inspect.enable', () => ['inspect.enable', {}] as const],
		['highlight.show', (ref: { runtimeId: string, nodeId: number }) => ['highlight.show', { ref }] as const],
	])('starts observing on the first %s and then reports document changes', async (_name, build) => {
		const { agent, client, outside, events } = createFixture(true)
		try {
			await client.handshake()
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })
			const ref = { runtimeId: 'runtime-x', nodeId: snapshot.rootNodeId }
			const [method, params] = build(ref)
			await client.request(method, params as never)
			outside.textContent = 'changed'
			await sleep()
			expect(events.filter(event => event.event === 'geometry.invalidated').length)
				.toBeGreaterThan(0)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('lets the host invalidate before any use without starting observation', async () => {
		const { agent, client, events } = createFixture(true)
		try {
			await client.handshake()
			agent.invalidateGeometry()
			await sleep()
			expect(events.filter(event => event.event === 'geometry.invalidated'))
				.toHaveLength(0)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})

describe('inspectorAgent hover de-duplication', () => {
	it('emits inspect.hovered only when the hovered target changes', async () => {
		const { agent, client, root, outer, inner, outside, events } = createFixture(true)
		try {
			await client.request('inspect.enable', {})
			const hovered = () => events
				.filter(event => event.event === 'inspect.hovered')
				.map(event => (event.payload as { widgetId?: string }).widgetId ?? null)
			const over = (element: Element) => element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))

			over(inner)
			over(inner)
			over(inner)
			expect(hovered())
				.toEqual(['counter'])
			over(outer)
			over(outer)
			expect(hovered())
				.toEqual(['counter', 'root'])
			// Moving over a part of the root that is not an anchor hands the hover back to nothing, once.
			root.dispatchEvent(new PointerEvent('pointerleave'))
			root.dispatchEvent(new PointerEvent('pointerleave'))
			expect(hovered())
				.toEqual(['counter', 'root', null])
			over(inner)
			expect(hovered())
				.toEqual(['counter', 'root', null, 'counter'])
			expect(outside).not.toBeNull()
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})
