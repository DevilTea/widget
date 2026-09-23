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

function createGeometryFixture(options: { shadowRoot?: boolean } = {}) {
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
	const shadowHost = options.shadowRoot ? document.createElement('div') : null
	if (shadowHost !== null) {
		shadowHost.attachShadow({ mode: 'open' })
			.append(root)
		document.body.append(shadowHost)
	}
	else {
		document.body.append(root)
	}

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
			shadowHost?.remove()
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

	it('does not leak 0.2-only geometry notifications or methods into a 0.1 session', async () => {
		const fixture = createGeometryFixture()
		try {
			const handshake = await fixture.client.request('handshake', { protocol: { major: 0, minor: 1 } })
			expect(handshake.protocol)
				.toEqual({ major: 0, minor: 1 })
			expect(handshake.capabilities.events).not.toContain('geometry.invalidated')
			const notifications = vi.fn()
			fixture.client.on('geometry.invalidated', notifications)
			await expect(fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			}))
				.rejects.toMatchObject({ code: 'unknown-method' })
			document.dispatchEvent(new Event('scroll'))
			await nextAnimationFrame()
			expect(notifications).not.toHaveBeenCalled()

			const upgraded = await fixture.client.handshake()
			expect(upgraded.capabilities.events)
				.toContain('geometry.invalidated')
			document.dispatchEvent(new Event('scroll'))
			await nextAnimationFrame()
			expect(notifications)
				.toHaveBeenCalledTimes(1)
		}
		finally {
			fixture.dispose()
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

	it('does not hit through a topmost non-semantic overlay onto a covered Widget', async () => {
		const fixture = createGeometryFixture()
		const overlay = document.createElement('div')
		fixture.root.append(overlay)
		try {
			// Native elementsFromPoint is ordered topmost-first, including covered elements.
			setElementsFromPoint([overlay, fixture.leaf, fixture.inner, fixture.outer])
			const result = await fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			})
			expect(result)
				.toEqual({ target: null })
		}
		finally {
			overlay.remove()
			fixture.dispose()
		}
	})

	it('resolves the topmost overlay own semantic ancestor rather than a covered sibling Widget', async () => {
		const fixture = createGeometryFixture()
		const overlay = document.createElement('div')
		fixture.outer.append(overlay)
		try {
			setElementsFromPoint([overlay, fixture.leaf, fixture.inner, fixture.outer])
			const result = await fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			})
			expect(result.target?.widgetId)
				.toBe('root')
		}
		finally {
			overlay.remove()
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

	it('rejects degenerate rects in rectangle-only hit testing', async () => {
		const fixture = createGeometryFixture()
		const previousStack = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
		const previousSingle = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
		try {
			Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: undefined })
			Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: undefined })
			setRects(fixture.outer, [])
			setRects(fixture.inner, [rect(15, 25, 0, 0)])
			await expect(fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			}))
				.resolves.toEqual({ target: null })
		}
		finally {
			if (previousStack !== undefined)
				Object.defineProperty(document, 'elementsFromPoint', previousStack)
			else Reflect.deleteProperty(document, 'elementsFromPoint')
			if (previousSingle !== undefined)
				Object.defineProperty(document, 'elementFromPoint', previousSingle)
			else Reflect.deleteProperty(document, 'elementFromPoint')
			fixture.dispose()
		}
	})

	it('uses the browser single-element hit test when stack API is missing', async () => {
		const fixture = createGeometryFixture()
		const previousStack = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
		const previousSingle = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
		try {
			// Siblings overlap, and the upper layer is later in DOM order.
			fixture.root.append(fixture.inner)
			Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: undefined })
			Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => fixture.inner })
			const result = await fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			})
			expect(result.target?.widgetId)
				.toBe('counter')
		}
		finally {
			if (previousStack !== undefined)
				Object.defineProperty(document, 'elementsFromPoint', previousStack)
			else Reflect.deleteProperty(document, 'elementsFromPoint')
			if (previousSingle !== undefined)
				Object.defineProperty(document, 'elementFromPoint', previousSingle)
			else Reflect.deleteProperty(document, 'elementFromPoint')
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

	it.each([false, true])('does not re-invalidate from its own badge DOM when Preview is ShadowRoot=%s', async (shadowRoot) => {
		const fixture = createGeometryFixture({ shadowRoot })
		try {
			const blueprint = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const root = blueprint.nodes.find(node => node.widgetId === 'root')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: root.nodeId }
			const invalidations = vi.fn()
			fixture.client.on('geometry.invalidated', () => {
				invalidations()
				// A remote overlay naturally re-highlights or re-resolves when geometry becomes stale.
				void fixture.client.request('highlight.show', { ref })
			})
			await fixture.client.request('highlight.show', { ref })
			await nextAnimationFrame()
			await nextAnimationFrame()
			expect(invalidations)
				.toHaveBeenCalledTimes(0)
			fixture.outer.style.transform = 'translateX(3px)'
			await vi.waitFor(() => expect(invalidations)
				.toHaveBeenCalledTimes(1))
			for (let frame = 0; frame < 5; frame++)
				await nextAnimationFrame()
			expect(invalidations)
				.toHaveBeenCalledTimes(1)
			await fixture.client.request('highlight.clear', {})
			await nextAnimationFrame()
			await nextAnimationFrame()
			expect(invalidations)
				.toHaveBeenCalledTimes(1)
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
	it('hit-tests an internal Shadow DOM widget when document hit testing returns the host', async () => {
		const fixture = createGeometryFixture({ shadowRoot: true })
		const tree = fixture.root.getRootNode() as ShadowRoot
		const documentStack = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
		const shadowStack = Object.getOwnPropertyDescriptor(tree, 'elementsFromPoint')
		try {
			Object.defineProperty(document, 'elementsFromPoint', {
				configurable: true,
				value: () => [tree.host],
			})
			Object.defineProperty(tree, 'elementsFromPoint', {
				configurable: true,
				value: () => [fixture.leaf, fixture.inner, fixture.outer],
			})
			const result = await fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			})
			expect(result.target?.widgetId)
				.toBe('counter')
		}
		finally {
			if (documentStack !== undefined)
				Object.defineProperty(document, 'elementsFromPoint', documentStack)
			else Reflect.deleteProperty(document, 'elementsFromPoint')
			if (shadowStack !== undefined)
				Object.defineProperty(tree, 'elementsFromPoint', shadowStack)
			else Reflect.deleteProperty(tree, 'elementsFromPoint')
			fixture.dispose()
		}
	})

	it('uses ShadowRoot stacking and suppresses fallback for an overlay sibling outside the bounded root', async () => {
		const fixture = createGeometryFixture({ shadowRoot: true })
		const tree = fixture.root.getRootNode() as ShadowRoot
		const overlay = document.createElement('div')
		overlay.dataset.widgetId = 'counter'
		overlay.dataset.widgetType = 'DevtoolsCounter'
		tree.append(overlay)
		const documentStack = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
		const shadowStack = Object.getOwnPropertyDescriptor(tree, 'elementsFromPoint')
		const shadowElementsFromPoint = vi.fn(() => [overlay, fixture.leaf, fixture.inner, fixture.outer])
		const documentElementsFromPoint = vi.fn(() => [fixture.leaf, fixture.inner, fixture.outer])
		try {
			Object.defineProperty(tree, 'elementsFromPoint', {
				configurable: true,
				value: shadowElementsFromPoint,
			})
			Object.defineProperty(document, 'elementsFromPoint', {
				configurable: true,
				value: documentElementsFromPoint,
			})
			await expect(fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			}))
				.resolves.toEqual({ target: null })
			expect(shadowElementsFromPoint)
				.toHaveBeenCalledWith(15, 25)
			expect(documentElementsFromPoint)
				.not.toHaveBeenCalled()
		}
		finally {
			if (shadowStack !== undefined)
				Object.defineProperty(tree, 'elementsFromPoint', shadowStack)
			else Reflect.deleteProperty(tree, 'elementsFromPoint')
			if (documentStack !== undefined)
				Object.defineProperty(document, 'elementsFromPoint', documentStack)
			else Reflect.deleteProperty(document, 'elementsFromPoint')
			overlay.remove()
			fixture.dispose()
		}
	})

	it('uses ShadowRoot.elementFromPoint when its elementsFromPoint API is unavailable', async () => {
		const fixture = createGeometryFixture({ shadowRoot: true })
		const tree = fixture.root.getRootNode() as ShadowRoot
		const shadowStack = Object.getOwnPropertyDescriptor(tree, 'elementsFromPoint')
		const shadowSingle = Object.getOwnPropertyDescriptor(tree, 'elementFromPoint')
		const documentStack = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
		try {
			Object.defineProperty(tree, 'elementsFromPoint', {
				configurable: true,
				value: undefined,
			})
			Object.defineProperty(tree, 'elementFromPoint', {
				configurable: true,
				value: () => fixture.inner,
			})
			Object.defineProperty(document, 'elementsFromPoint', {
				configurable: true,
				value: () => [tree.host],
			})
			const result = await fixture.client.request('inspect.hitTest', {
				coordinateSpace: 'preview-viewport',
				x: 15,
				y: 25,
			})
			expect(result.target?.widgetId)
				.toBe('counter')
		}
		finally {
			if (shadowStack !== undefined)
				Object.defineProperty(tree, 'elementsFromPoint', shadowStack)
			else Reflect.deleteProperty(tree, 'elementsFromPoint')
			if (shadowSingle !== undefined)
				Object.defineProperty(tree, 'elementFromPoint', shadowSingle)
			else Reflect.deleteProperty(tree, 'elementFromPoint')
			if (documentStack !== undefined)
				Object.defineProperty(document, 'elementsFromPoint', documentStack)
			else Reflect.deleteProperty(document, 'elementsFromPoint')
			fixture.dispose()
		}
	})

	it('removes every ShadowRoot event listener with the exact registered callback on Inspector teardown', () => {
		const add = vi.spyOn(ShadowRoot.prototype, 'addEventListener')
		const remove = vi.spyOn(ShadowRoot.prototype, 'removeEventListener')
		const fixture = createGeometryFixture({ shadowRoot: true })
		try {
			fixture.agent.dispose()
			for (const event of ['scroll', 'load', 'error']) {
				const registered = add.mock.calls.find(call => call[0] === event && call[2] === true)
				if (registered === undefined)
					throw new Error(`Expected a ShadowRoot ${event} listener registration.`)
				expect(remove)
					.toHaveBeenCalledWith(event, registered[1], true)
			}
		}
		finally {
			fixture.dispose()
			add.mockRestore()
			remove.mockRestore()
		}
	})

	it.each(['load', 'error'])('invalidates for a %s resource event contained inside Shadow DOM', async (kind) => {
		const fixture = createGeometryFixture({ shadowRoot: true })
		const resource = document.createElement('img')
		try {
			fixture.root.append(resource)
			await nextAnimationFrame()
			await nextAnimationFrame()
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			const before = await fixture.client.request('geometry.resolve', { ref })
			resource.dispatchEvent(new Event(kind, { bubbles: false, composed: false }))
			const after = await fixture.client.request('geometry.resolve', { ref })
			expect(after.revision)
				.toBe(before.revision + 1)
		}
		finally {
			fixture.dispose()
		}
	})

	it('invalidates when a scroll event cannot cross the Shadow DOM boundary', async () => {
		const fixture = createGeometryFixture({ shadowRoot: true })
		try {
			await nextAnimationFrame()
			await nextAnimationFrame()
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			const before = await fixture.client.request('geometry.resolve', { ref })
			fixture.root.dispatchEvent(new Event('scroll', { bubbles: false, composed: false }))
			const after = await fixture.client.request('geometry.resolve', { ref })
			expect(after.revision)
				.toBe(before.revision + 1)
		}
		finally {
			fixture.dispose()
		}
	})

	it('observes geometry-affecting mutations when the Preview root is inside Shadow DOM', async () => {
		const fixture = createGeometryFixture({ shadowRoot: true })
		try {
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			const before = await fixture.client.request('geometry.resolve', { ref })
			fixture.inner.style.transform = 'translateX(2px)'
			await vi.waitFor(async () => {
				const after = await fixture.client.request('geometry.resolve', { ref })
				expect(after.revision)
					.toBeGreaterThan(before.revision)
			})
		}
		finally {
			fixture.dispose()
		}
	})

	it('invalidates when an external resource fails without emitting load', async () => {
		const fixture = createGeometryFixture()
		const image = document.createElement('img')
		try {
			document.body.append(image)
			await nextAnimationFrame()
			await nextAnimationFrame()
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			const before = await fixture.client.request('geometry.resolve', { ref })
			image.dispatchEvent(new Event('error'))
			const after = await fixture.client.request('geometry.resolve', { ref })
			expect(after.revision)
				.toBe(before.revision + 1)
		}
		finally {
			image.remove()
			fixture.dispose()
		}
	})

	it('provides host-only invalidation for stylesheet/CSSOM updates without DOM mutation', async () => {
		const fixture = createGeometryFixture()
		try {
			await nextAnimationFrame()
			await nextAnimationFrame()
			const snapshot = await fixture.client.request('blueprint.getSnapshot', { runtimeId: 'runtime-geometry' })
			const counter = snapshot.nodes.find(node => node.widgetId === 'counter')!
			const ref = { runtimeId: 'runtime-geometry', nodeId: counter.nodeId }
			const before = await fixture.client.request('geometry.resolve', { ref })
			const invalidations = vi.fn()
			fixture.client.on('geometry.invalidated', invalidations)

			fixture.agent.invalidateGeometry()
			fixture.agent.invalidateGeometry()
			const current = await fixture.client.request('geometry.resolve', { ref })
			expect(current.revision)
				.toBe(before.revision + 1)
			await nextAnimationFrame()
			expect(invalidations)
				.toHaveBeenCalledExactlyOnceWith({ revision: before.revision + 1 })
			fixture.agent.dispose()
			fixture.agent.invalidateGeometry()
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
