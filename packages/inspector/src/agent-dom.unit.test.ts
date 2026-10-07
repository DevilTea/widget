// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

async function flushTransport(): Promise<void> {
	await Promise.resolve()
}

interface Box { x: number, y: number, width: number, height: number }

const OUTER_BOX: Box = { x: 0, y: 0, width: 200, height: 100 }
const INNER_BOX: Box = { x: 10, y: 30, width: 80, height: 20 }

function mockRects(element: Element, boxes: readonly Box[]): void {
	Object.defineProperty(element, 'getClientRects', {
		configurable: true,
		value: () => boxes.map(box => new DOMRect(box.x, box.y, box.width, box.height)),
	})
}

function overlayHost(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-widget-inspector-overlay="true"]')
}

function drawnBoxes(): Box[] {
	return [...overlayHost()?.shadowRoot?.querySelectorAll<HTMLElement>('.rect') ?? []].map(element => ({
		x: Number.parseFloat(element.style.left),
		y: Number.parseFloat(element.style.top),
		width: Number.parseFloat(element.style.width),
		height: Number.parseFloat(element.style.height),
	}))
}

function drawnLabel(): string | null {
	return overlayHost()?.shadowRoot?.querySelector('.badge')?.textContent ?? null
}

function createDomFixture() {
	const fixture = createInspectorTestFixture()
	const root = document.createElement('div')
	root.style.position = 'relative'
	const outer = document.createElement('section')
	outer.dataset.widgetId = 'root'
	outer.dataset.widgetType = 'DevtoolsRoot'
	const inner = document.createElement('button')
	inner.type = 'button'
	inner.dataset.widgetId = 'counter'
	inner.dataset.widgetType = 'DevtoolsCounter'
	inner.textContent = 'Counter action'
	outer.append(inner)
	root.append(outer)
	document.body.append(root)
	mockRects(outer, [OUTER_BOX])
	mockRects(inner, [INNER_BOX])

	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({
		runtime: fixture.runtime,
		transport: pair.agent,
		runtimeId: 'runtime-dom',
		dom: { root },
	})
	const client = createInspectorClient(pair.client)
	return { ...fixture, root, outer, inner, pair, agent, client }
}

describe('inspectorAgent DOM ownership', () => {
	it('owns innermost-anchor hover/highlight and emits a scoped WidgetRef', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			const events: unknown[] = []
			client.on('inspect.hovered', payload => events.push(payload))
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			await flushTransport()

			expect(drawnBoxes())
				.toStrictEqual([INNER_BOX])
			expect(drawnLabel())
				.toBe('DevtoolsCounter#counter')
			expect(overlayHost()?.style.pointerEvents)
				.toBe('none')
			// The Agent never mutates renderer elements or the renderer subtree.
			expect(inner.getAttributeNames()
				.sort())
				.toStrictEqual(['data-widget-id', 'data-widget-type', 'type'])
			expect(root.querySelector('[data-widget-inspector-overlay]'))
				.toBeNull()
			expect(overlayHost()?.parentElement)
				.toBe(document.body)
			expect(events)
				.toContainEqual(expect.objectContaining({
					ref: expect.objectContaining({ runtimeId: 'runtime-dom' }),
					widgetId: 'counter',
					widgetType: 'DevtoolsCounter',
				}))
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('highlights a registered Preview root anchor as well as geometry resolves it', async () => {
		const { root, outer, agent, client } = createDomFixture()
		try {
			root.dataset.widgetId = 'root'
			root.dataset.widgetType = 'DevtoolsRoot'
			outer.removeAttribute('data-widget-id')
			outer.removeAttribute('data-widget-type')
			Object.defineProperty(root, 'getClientRects', {
				configurable: true,
				value: () => [new DOMRect(0, 0, 200, 100)],
			})
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-dom' })
			const ref = { runtimeId: 'runtime-dom', nodeId: snapshot.rootNodeId }
			const geometry = await client.request('geometry.resolve', { ref })
			expect(geometry)
				.toMatchObject({ visibility: 'visible', rects: [{ x: 0, y: 0, width: 200, height: 100 }] })
			expect(await client.request('highlight.show', { ref }))
				.toEqual({ highlighted: true })
			expect(drawnBoxes())
				.toStrictEqual([OUTER_BOX])
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('falls back to a registered ancestor for stale nested DOM anchors', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			inner.dataset.widgetId = 'stale-widget'
			const selections: unknown[] = []
			const hovered: unknown[] = []
			client.on('inspect.selected', value => selections.push(value))
			client.on('inspect.hovered', value => hovered.push(value))
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			const click = new MouseEvent('click', { bubbles: true, cancelable: true })
			inner.dispatchEvent(click)
			await flushTransport()
			expect(drawnBoxes())
				.toStrictEqual([OUTER_BOX])
			expect(click.defaultPrevented)
				.toBe(true)
			expect(hovered)
				.toContainEqual(expect.objectContaining({ widgetId: 'root' }))
			expect(selections)
				.toContainEqual(expect.objectContaining({ widgetId: 'root' }))
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('suppresses underlying pointer/click activation while Inspect is enabled and selects the inner widget', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			const action = vi.fn()
			inner.addEventListener('click', action)
			const events: unknown[] = []
			client.on('inspect.selected', payload => events.push(payload))
			await client.request('inspect.enable', {})

			const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
			inner.dispatchEvent(pointerDown)
			const click = new MouseEvent('click', { bubbles: true, cancelable: true })
			inner.dispatchEvent(click)
			await flushTransport()

			expect(pointerDown.defaultPrevented)
				.toBe(true)
			expect(click.defaultPrevented)
				.toBe(true)
			expect(action).not.toHaveBeenCalled()
			expect(events)
				.toContainEqual(expect.objectContaining({ widgetId: 'counter', widgetType: 'DevtoolsCounter' }))
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('captures pointerup while enabled and releases the native listener after RPC disable', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			const underlyingPointerUp = vi.fn()
			inner.addEventListener('pointerup', underlyingPointerUp)
			await client.request('inspect.enable', {})

			const enabledPointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true })
			inner.dispatchEvent(enabledPointerUp)
			expect(enabledPointerUp.defaultPrevented)
				.toBe(true)
			expect(underlyingPointerUp)
				.not.toHaveBeenCalled()

			await client.request('inspect.disable', {})
			const disabledPointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true })
			inner.dispatchEvent(disabledPointerUp)
			expect(disabledPointerUp.defaultPrevented)
				.toBe(false)
			expect(underlyingPointerUp)
				.toHaveBeenCalledTimes(1)
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('escape/disable clears Agent-owned chrome and immediately restores normal activation', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			const action = vi.fn()
			inner.addEventListener('click', action)
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			expect(overlayHost())
				.not.toBeNull()

			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			await flushTransport()
			expect(agent.inspectEnabled)
				.toBe(false)
			expect(overlayHost())
				.toBeNull()
			expect(overlayHost())
				.toBeNull()

			inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
			expect(action)
				.toHaveBeenCalledTimes(1)
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('disables through the RPC, removes the badge, and restores normal native click actions', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			const action = vi.fn()
			inner.addEventListener('click', action)
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			expect(overlayHost())
				.not.toBeNull()

			expect(await client.request('inspect.disable', {}))
				.toEqual({ enabled: false })
			expect(agent.inspectEnabled)
				.toBe(false)
			expect(overlayHost())
				.toBeNull()
			expect(overlayHost())
				.toBeNull()

			const click = new MouseEvent('click', { bubbles: true, cancelable: true })
			inner.dispatchEvent(click)
			expect(click.defaultPrevented)
				.toBe(false)
			expect(action)
				.toHaveBeenCalledTimes(1)
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('captures and consumes Escape before inspected controls can react', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			const underlyingKeydown = vi.fn((event: KeyboardEvent) => event.stopPropagation())
			inner.addEventListener('keydown', underlyingKeydown)
			await client.request('inspect.enable', {})

			const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			inner.dispatchEvent(escape)

			expect(agent.inspectEnabled)
				.toBe(false)
			expect(escape.defaultPrevented)
				.toBe(true)
			expect(underlyingKeydown).not.toHaveBeenCalled()
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('removes Agent-owned DOM state and restores native activation after peer disconnect', async () => {
		const { root, inner, pair, agent, client } = createDomFixture()
		try {
			const nativeClick = vi.fn()
			const nativeKeydown = vi.fn()
			inner.addEventListener('click', nativeClick)
			inner.addEventListener('keydown', nativeKeydown)
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			expect(overlayHost())
				.not.toBeNull()

			pair.client.close()

			expect(overlayHost())
				.toBeNull()
			expect(overlayHost())
				.toBeNull()

			// Chrome can clear even when capture listeners are leaked. Probe actual native activation.
			const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
			const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true })
			const click = new MouseEvent('click', { bubbles: true, cancelable: true })
			inner.dispatchEvent(pointerDown)
			inner.dispatchEvent(pointerUp)
			inner.dispatchEvent(click)
			expect(pointerDown.defaultPrevented)
				.toBe(false)
			expect(pointerUp.defaultPrevented)
				.toBe(false)
			expect(click.defaultPrevented)
				.toBe(false)
			expect(nativeClick)
				.toHaveBeenCalledTimes(1)

			// A partial teardown must not revive Inspect chrome or intercept native Escape.
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			expect(overlayHost())
				.toBeNull()
			expect(overlayHost())
				.toBeNull()
			const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
			inner.dispatchEvent(escape)
			expect(escape.defaultPrevented)
				.toBe(false)
			expect(nativeKeydown)
				.toHaveBeenCalledTimes(1)
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('does not inspect anchors outside the bounded root', async () => {
		const { root, agent, client } = createDomFixture()
		const outside = document.createElement('button')
		outside.dataset.widgetId = 'counter'
		outside.dataset.widgetType = 'DevtoolsCounter'
		document.body.append(outside)
		try {
			const nativePointerDown = vi.fn()
			const nativeClick = vi.fn()
			outside.addEventListener('pointerdown', nativePointerDown)
			outside.addEventListener('click', nativeClick)
			const events: unknown[] = []
			client.on('inspect.selected', payload => events.push(payload))
			await client.request('inspect.enable', {})
			outside.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
			outside.dispatchEvent(pointerDown)
			const click = new MouseEvent('click', { bubbles: true, cancelable: true })
			outside.dispatchEvent(click)
			await flushTransport()
			expect(pointerDown.defaultPrevented)
				.toBe(false)
			expect(click.defaultPrevented)
				.toBe(false)
			expect(nativePointerDown)
				.toHaveBeenCalledTimes(1)
			expect(nativeClick)
				.toHaveBeenCalledTimes(1)
			expect(events)
				.toHaveLength(0)
		}
		finally {
			outside.remove()
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})
})

describe('inspectorAgent ShadowRoot overlay', () => {
	it('draws the highlight inside an open ShadowRoot on a fixed, pointer-transparent, aria-hidden host', async () => {
		const { root, agent, client, inner } = createDomFixture()
		try {
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))

			const host = overlayHost()
			expect(host?.shadowRoot)
				.not.toBeNull()
			expect(host?.getAttribute('aria-hidden'))
				.toBe('true')
			expect(host?.style.position)
				.toBe('fixed')
			expect(host?.style.pointerEvents)
				.toBe('none')
			// Presentation lives inside the ShadowRoot, so document CSS cannot restyle or leak into it.
			expect(host?.shadowRoot?.querySelector('style')?.textContent)
				.toContain('.rect')
			expect(host?.querySelector('.rect'))
				.toBeNull()
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('highlights every fragment of a Widget with one label, in document order', async () => {
		const { root, outer, inner, agent, client } = createDomFixture()
		const second = document.createElement('button')
		second.dataset.widgetId = 'counter'
		second.dataset.widgetType = 'DevtoolsCounter'
		outer.append(second)
		const secondBox: Box = { x: 10, y: 60, width: 80, height: 20 }
		const wrappedA: Box = { x: 100, y: 30, width: 40, height: 10 }
		const wrappedB: Box = { x: 100, y: 40, width: 30, height: 10 }
		mockRects(second, [secondBox])
		mockRects(inner, [INNER_BOX, wrappedA, wrappedB])
		try {
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-dom' })
			const counter = snapshot.nodes.find(node => node.resolved && node.widgetId === 'counter')
			const ref = { runtimeId: 'runtime-dom', nodeId: counter!.nodeId }
			expect(await client.request('highlight.show', { ref }))
				.toEqual({ highlighted: true })

			expect(drawnBoxes())
				.toStrictEqual([INNER_BOX, wrappedA, wrappedB, secondBox])
			expect(overlayHost()?.shadowRoot?.querySelectorAll('.badge'))
				.toHaveLength(1)
			expect(drawnLabel())
				.toBe('DevtoolsCounter#counter')
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('survives a renderer re-render and follows the replaced anchors', async () => {
		const { root, outer, inner, agent, client } = createDomFixture()
		try {
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			expect(drawnBoxes())
				.toStrictEqual([INNER_BOX])

			// Simulate a Vue re-render: the renderer patches classes and swaps the anchor element.
			inner.className = 'patched-by-renderer'
			const replacement = document.createElement('button')
			replacement.dataset.widgetId = 'counter'
			replacement.dataset.widgetType = 'DevtoolsCounter'
			const moved: Box = { x: 20, y: 40, width: 90, height: 24 }
			mockRects(replacement, [moved])
			inner.replaceWith(replacement)
			outer.className = 'patched-by-renderer'

			await vi.waitFor(() => expect(drawnBoxes())
				.toStrictEqual([moved]))
			expect(overlayHost())
				.not.toBeNull()
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('removes the drawn rects when the highlighted Widget unmounts and redraws if it returns', async () => {
		const { root, outer, inner, agent, client } = createDomFixture()
		try {
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			expect(overlayHost())
				.not.toBeNull()

			inner.remove()
			await vi.waitFor(() => expect(overlayHost())
				.toBeNull())

			const remounted = document.createElement('button')
			remounted.dataset.widgetId = 'counter'
			remounted.dataset.widgetType = 'DevtoolsCounter'
			mockRects(remounted, [INNER_BOX])
			outer.append(remounted)
			await vi.waitFor(() => expect(drawnBoxes())
				.toStrictEqual([INNER_BOX]))
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('does not report its own overlay as a geometry change', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			const invalidations: unknown[] = []
			client.on('geometry.invalidated', payload => invalidations.push(payload))
			await client.handshake()
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			inner.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
			await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
			expect(invalidations)
				.toHaveLength(0)
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('highlight.show returns false without drawing when the Widget has no anchor element', async () => {
		const { root, inner, agent, client } = createDomFixture()
		try {
			inner.remove()
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-dom' })
			const counter = snapshot.nodes.find(node => node.resolved && node.widgetId === 'counter')
			expect(await client.request('highlight.show', { ref: { runtimeId: 'runtime-dom', nodeId: counter!.nodeId } }))
				.toEqual({ highlighted: false })
			expect(overlayHost())
				.toBeNull()
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('removes the overlay on highlight.clear and on dispose', async () => {
		const { root, agent, client } = createDomFixture()
		try {
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-dom' })
			const ref = { runtimeId: 'runtime-dom', nodeId: snapshot.rootNodeId }
			await client.request('highlight.show', { ref })
			expect(overlayHost())
				.not.toBeNull()
			expect(await client.request('highlight.clear', {}))
				.toEqual({ highlighted: false })
			expect(overlayHost())
				.toBeNull()

			await client.request('highlight.show', { ref })
			expect(overlayHost())
				.not.toBeNull()
			agent.dispose()
			expect(overlayHost())
				.toBeNull()
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})
})
