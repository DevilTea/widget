// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createDevtoolsTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

async function flushTransport(): Promise<void> {
	await Promise.resolve()
}

function createDomFixture() {
	const fixture = createDevtoolsTestFixture()
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

	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({
		runtime: fixture.runtime,
		transport: pair.agent,
		runtimeId: 'runtime-dom',
		dom: {
			root,
			highlightClass: 'test-highlight',
			badgeClass: 'test-badge',
		},
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

			expect(inner.classList.contains('test-highlight'))
				.toBe(true)
			const badge = root.querySelector<HTMLElement>('[data-widget-inspector-badge="true"]')
			expect(badge?.textContent)
				.toBe('DevtoolsCounter#counter')
			expect(badge?.style.pointerEvents)
				.toBe('none')
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
			expect(root.classList.contains('test-highlight'))
				.toBe(true)
		}
		finally {
			client.dispose()
			agent.dispose()
			root.remove()
		}
	})

	it('falls back to a registered ancestor for stale nested DOM anchors', async () => {
		const { root, outer, inner, agent, client } = createDomFixture()
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
			expect(outer.classList.contains('test-highlight'))
				.toBe(true)
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
			expect(inner.classList.contains('test-highlight'))
				.toBe(true)

			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
			await flushTransport()
			expect(agent.inspectEnabled)
				.toBe(false)
			expect(inner.classList.contains('test-highlight'))
				.toBe(false)
			expect(root.querySelector('[data-widget-inspector-badge="true"]'))
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
			expect(root.querySelector('[data-widget-inspector-badge="true"]'))
				.not.toBeNull()

			expect(await client.request('inspect.disable', {}))
				.toEqual({ enabled: false })
			expect(agent.inspectEnabled)
				.toBe(false)
			expect(inner.classList.contains('test-highlight'))
				.toBe(false)
			expect(root.querySelector('[data-widget-inspector-badge="true"]'))
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
			expect(inner.classList.contains('test-highlight'))
				.toBe(true)

			pair.client.close()

			expect(inner.classList.contains('test-highlight'))
				.toBe(false)
			expect(root.querySelector('[data-widget-inspector-badge="true"]'))
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
			expect(inner.classList.contains('test-highlight'))
				.toBe(false)
			expect(root.querySelector('[data-widget-inspector-badge="true"]'))
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
