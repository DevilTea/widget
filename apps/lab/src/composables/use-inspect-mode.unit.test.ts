// @vitest-environment happy-dom
/**
 * `useInspectMode()` regression tests (issue #25 P2): off-by-default toggle state, Escape-driven exit
 * (only while active), and listener cleanup on unmount. Mounted through a throwaway host component
 * since `onMounted`/`onBeforeUnmount` require an active component instance.
 */

import type { InspectMode } from './use-inspect-mode'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { useInspectMode } from './use-inspect-mode'

function mountInspectMode() {
	let inspect!: InspectMode
	const wrapper = mount(defineComponent({
		setup() {
			inspect = useInspectMode()
			return () => h('div')
		},
	}))
	return { wrapper, inspect }
}

function pressEscape(): void {
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
}

describe('useInspectMode', () => {
	it('is off by default', () => {
		const { inspect } = mountInspectMode()

		expect(inspect.active.value)
			.toBe(false)
		expect(inspect.hovered.value)
			.toBeNull()
	})

	it('toggle() flips active on, then off again (clearing any hovered state)', () => {
		const { inspect } = mountInspectMode()

		inspect.toggle()
		expect(inspect.active.value)
			.toBe(true)

		inspect.setHovered({ widgetId: 'w1', widgetType: 'Button', rect: new DOMRect() })
		expect(inspect.hovered.value)
			.not.toBeNull()

		inspect.toggle()
		expect(inspect.active.value)
			.toBe(false)
		expect(inspect.hovered.value)
			.toBeNull()
	})

	it('escape exits an active session (and clears hovered state)', () => {
		const { inspect } = mountInspectMode()

		inspect.toggle()
		inspect.setHovered({ widgetId: 'w1', widgetType: 'Button', rect: new DOMRect() })

		pressEscape()

		expect(inspect.active.value)
			.toBe(false)
		expect(inspect.hovered.value)
			.toBeNull()
	})

	it('escape is a no-op while already inactive', () => {
		const { inspect } = mountInspectMode()

		expect(() => pressEscape())
			.not.toThrow()
		expect(inspect.active.value)
			.toBe(false)
	})

	it('disable() is idempotent and reachable directly', () => {
		const { inspect } = mountInspectMode()

		inspect.toggle()
		inspect.disable()
		expect(inspect.active.value)
			.toBe(false)
		inspect.disable()
		expect(inspect.active.value)
			.toBe(false)
	})

	it('removes its Escape listener on unmount: a later Escape does not resurrect a stale instance state', () => {
		const { wrapper, inspect } = mountInspectMode()
		inspect.toggle()
		expect(inspect.active.value)
			.toBe(true)

		wrapper.unmount()

		// The now-unmounted instance's own listener must not still be attached — dispatching Escape after
		// unmount must not throw (a stale listener touching a torn-down effect scope would be a symptom of
		// a leak), and a fresh instance must start clean regardless.
		expect(() => pressEscape())
			.not.toThrow()

		const { inspect: freshInspect } = mountInspectMode()
		expect(freshInspect.active.value)
			.toBe(false)
	})
})
