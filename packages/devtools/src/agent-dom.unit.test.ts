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

	it('cleans Agent-owned DOM state when the transport peer disconnects', async () => {
		const { root, inner, pair, agent, client } = createDomFixture()
		try {
			await client.request('inspect.enable', {})
			inner.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
			expect(inner.classList.contains('test-highlight'))
				.toBe(true)

			pair.client.close()

			expect(inner.classList.contains('test-highlight'))
				.toBe(false)
			expect(root.querySelector('[data-widget-inspector-badge="true"]'))
				.toBeNull()
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
			outside.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
			await flushTransport()
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
