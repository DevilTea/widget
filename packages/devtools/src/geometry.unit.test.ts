// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createDevtoolsTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

function rect(x: number, y: number, width: number, height: number): DOMRect {
	return new DOMRect(x, y, width, height)
}

function setRects(element: Element, rects: readonly DOMRect[]): void {
	Object.defineProperty(element, 'getClientRects', {
		configurable: true,
		value: () => rects,
	})
	Object.defineProperty(element, 'getBoundingClientRect', {
		configurable: true,
		value: () => rects[0] ?? rect(0, 0, 0, 0),
	})
}

function setElementsFromPoint(elements: readonly Element[]): void {
	Object.defineProperty(document, 'elementsFromPoint', {
		configurable: true,
		value: () => [...elements],
	})
}

function createGeometryFixture() {
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
	Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 })

	const fixture = createDevtoolsTestFixture()
	const root = document.createElement('div')
	const outer = document.createElement('section')
	outer.dataset.widgetId = 'root'
	outer.dataset.widgetType = 'DevtoolsRoot'
	const inner = document.createElement('button')
	inner.dataset.widgetId = 'counter'
	inner.dataset.widgetType = 'DevtoolsCounter'
	const leaf = document.createElement('span')
	inner.append(leaf)
	outer.append(inner)
	root.append(outer)
	document.body.append(root)

	setRects(outer, [rect(0, 0, 280, 180)])
	setRects(inner, [rect(10, 20, 80, 30)])
	setRects(leaf, [rect(12, 22, 10, 10)])

	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({
		runtime: fixture.runtime,
		transport: pair.agent,
		runtimeId: 'runtime-geometry',
		dom: { root },
	})
	const client = createInspectorClient(pair.client)

	return {
		...fixture,
		root,
		outer,
		inner,
		leaf,
		agent,
		client,
		dispose() {
			client.dispose()
			agent.dispose()
			root.remove()
		},
	}
}

function nextAnimationFrame(): Promise<void> {
	return new Promise(resolve => window.requestAnimationFrame(() => resolve()))
}

describe('semantic geometry Inspector protocol', () => {
	it('advertises geometry only for DOM-backed Agents', async () => {
		const fixture = createDevtoolsTestFixture()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-no-dom' })
		const client = createInspectorClient(pair.client)
		try {
			const handshake = await client.handshake()
			expect(handshake.capabilities.methods).not.toContain('geometry.resolve')
			expect(handshake.capabilities.methods).not.toContain('inspect.hitTest')
			expect(handshake.capabilities.events).not.toContain('geometry.invalidated')
		}
		finally {
			client.dispose()
			agent.dispose()
		}

		const domFixture = createGeometryFixture()
		try {
			const handshake = await domFixture.client.handshake()
			expect(handshake.capabilities.methods)
				.toEqual(expect.arrayContaining([
					'runtime.subscribeEvent',
					'runtime.unsubscribeEvent',
					'geometry.resolve',
					'inspect.hitTest',
				]))
			expect(handshake.capabilities.events)
				.toEqual(expect.arrayContaining(['runtime.eventOccurred', 'geometry.invalidated']))
		}
		finally {
			domFixture.dispose()
		}
	})

	it('resolves complete ordered rect lists in Preview viewport CSS pixels', async () => {
		const fixture = createGeometryFixture()
		const second = document.createElement('div')
		second.dataset.widgetId = 'counter'
		second.dataset.widgetType = 'DevtoolsCounter'
		setRects(fixture.inner, [rect(10, 20, 80, 30), rect(10, 55, 60, 20)])
		setRects(second, [rect(120, 25, 40, 20)])
		fixture.outer.append(second)
		try {
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const geometry = await fixture.client.request('geometry.resolve', {
				ref: { runtimeId: 'runtime-geometry', nodeId: counter.nodeId },
			})
			expect(geometry)
				.toEqual({
					coordinateSpace: 'preview-viewport',
					revision: expect.any(Number),
					visibility: 'visible',
					rects: [
						{ x: 10, y: 20, width: 80, height: 30 },
						{ x: 10, y: 55, width: 60, height: 20 },
						{ x: 120, y: 25, width: 40, height: 20 },
					],
				})
		}
		finally {
			fixture.dispose()
		}
	})

	it('distinguishes visible, clipped, hidden, and missing without discarding offscreen rects', async () => {
		const fixture = createGeometryFixture()
		try {
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }

			expect((await fixture.client.request('geometry.resolve', { ref })).visibility)
				.toBe('visible')

			setRects(fixture.inner, [rect(350, 20, 80, 30)])
			const clipped = await fixture.client.request('geometry.resolve', { ref })
			expect(clipped.visibility)
				.toBe('clipped')
			expect(clipped.rects)
				.toEqual([{ x: 350, y: 20, width: 80, height: 30 }])

			setRects(fixture.inner, [rect(Number.POSITIVE_INFINITY, 20, 80, 30)])
			const invalid = await fixture.client.request('geometry.resolve', { ref })
			expect(invalid)
				.toMatchObject({ visibility: 'hidden', rects: [] })

			setRects(fixture.inner, [])
			const hidden = await fixture.client.request('geometry.resolve', { ref })
			expect(hidden)
				.toMatchObject({ visibility: 'hidden', rects: [] })

			const missing = await fixture.client.request('geometry.resolve', {
				ref: { runtimeId: 'runtime-geometry', nodeId: 999999 },
			})
			expect(missing)
				.toMatchObject({ visibility: 'missing', rects: [] })
		}
		finally {
			fixture.dispose()
		}
	})

	it('hit-tests the innermost semantic anchor and returns identity plus geometry under one revision', async () => {
		const fixture = createGeometryFixture()
		try {
			setElementsFromPoint([fixture.leaf, fixture.inner, fixture.outer])
			const result = await fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			})
			if (result.target === null)
				throw new Error('Expected semantic hit.')
			expect(result.target.widgetId)
				.toBe('counter')
			expect(result.target.widgetType)
				.toBe('DevtoolsCounter')
			expect(result.geometry)
				.toMatchObject({
					coordinateSpace: 'preview-viewport',
					visibility: 'visible',
					rects: [{ x: 10, y: 20, width: 80, height: 30 }],
				})
			const resolved = await fixture.client.request('geometry.resolve', { ref: result.target.ref })
			expect(resolved.revision)
				.toBe(result.geometry.revision)
		}
		finally {
			fixture.dispose()
		}
	})

	it('falls back to a registered ancestor when the innermost DOM anchor is stale', async () => {
		const fixture = createGeometryFixture()
		try {
			fixture.inner.dataset.widgetId = 'no-longer-registered'
			setElementsFromPoint([fixture.leaf, fixture.inner, fixture.outer])
			const result = await fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			})
			if (result.target === null)
				throw new Error('Expected registered ancestor hit.')
			expect(result.target.widgetId)
				.toBe('root')
			expect(result.geometry.rects)
				.toEqual([{ x: 0, y: 0, width: 280, height: 180 }])
		}
		finally {
			fixture.dispose()
		}
	})

	it('returns target:null for a valid Preview point with no semantic anchor', async () => {
		const fixture = createGeometryFixture()
		try {
			setElementsFromPoint([fixture.root])
			await expect(fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 250,
				y: 150,
			}))
				.resolves.toEqual({ target: null })
		}
		finally {
			fixture.dispose()
		}
	})

	it('advances one global revision immediately and coalesces invalidation notification to one per frame', async () => {
		const fixture = createGeometryFixture()
		try {
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			const before = await fixture.client.request('geometry.resolve', { ref })
			const invalidations = vi.fn()
			fixture.client.on('geometry.invalidated', invalidations)

			document.dispatchEvent(new Event('scroll'))
			document.dispatchEvent(new Event('scroll'))
			window.dispatchEvent(new Event('resize'))

			const staleBoundary = await fixture.client.request('geometry.resolve', { ref })
			expect(staleBoundary.revision)
				.toBe(before.revision + 1)
			expect(invalidations).not.toHaveBeenCalled()

			await nextAnimationFrame()
			expect(invalidations)
				.toHaveBeenCalledTimes(1)
			expect(invalidations)
				.toHaveBeenCalledWith({ revision: before.revision + 1 })

			document.dispatchEvent(new Event('scroll'))
			const next = await fixture.client.request('geometry.resolve', { ref })
			expect(next.revision)
				.toBe(before.revision + 2)
			await nextAnimationFrame()
			expect(invalidations)
				.toHaveBeenCalledTimes(2)
		}
		finally {
			fixture.dispose()
		}
	})
	it('invalidates geometry after layout-affecting mutations outside the Preview root', async () => {
		const fixture = createGeometryFixture()
		try {
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			const before = await fixture.client.request('geometry.resolve', { ref })
			const invalidations = vi.fn()
			fixture.client.on('geometry.invalidated', invalidations)

			document.body.classList.add('outside-root-geometry-change')
			await vi.waitFor(async () => {
				const after = await fixture.client.request('geometry.resolve', { ref })
				expect(after.revision)
					.toBeGreaterThan(before.revision)
			})
			await nextAnimationFrame()
			expect(invalidations)
				.toHaveBeenCalledTimes(1)
		}
		finally {
			document.body.classList.remove('outside-root-geometry-change')
			fixture.dispose()
		}
	})

	it('observes an existing element that becomes a semantic anchor', async () => {
		const observed = new Set<Element>()
		let onResize: ResizeObserverCallback | null = null
		class TestResizeObserver {
			constructor(callback: ResizeObserverCallback) {
				onResize = callback
			}

			observe(element: Element): void {
				observed.add(element)
			}

			disconnect(): void {
				observed.clear()
			}
		}
		vi.stubGlobal('ResizeObserver', TestResizeObserver)
		const fixture = createGeometryFixture()
		try {
			const newAnchor = document.createElement('div')
			fixture.root.append(newAnchor)
			newAnchor.dataset.widgetId = 'counter'
			newAnchor.dataset.widgetType = 'DevtoolsCounter'
			setRects(newAnchor, [rect(120, 40, 20, 20)])

			await vi.waitFor(() => {
				expect(observed.has(newAnchor))
					.toBe(true)
			})
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			await nextAnimationFrame()
			const before = await fixture.client.request('geometry.resolve', { ref })
			if (onResize === null)
				throw new Error('Expected a ResizeObserver.')
			const triggerResize: ResizeObserverCallback = onResize
			triggerResize([], {} as ResizeObserver)
			const after = await fixture.client.request('geometry.resolve', { ref })
			expect(after.revision)
				.toBe(before.revision + 1)
		}
		finally {
			fixture.dispose()
			vi.unstubAllGlobals()
		}
	})
})
