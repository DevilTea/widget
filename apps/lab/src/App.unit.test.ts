// @vitest-environment happy-dom

import type { LabStore } from './composables/use-lab-store'
import type { TutorialStore } from './composables/use-tutorial'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, inject, onUnmounted, shallowRef } from 'vue'
import App from './App.vue'
import { createLabStore } from './composables/use-lab-store'
import { TutorialStoreKey } from './composables/use-tutorial'

vi.mock('./composables/use-lab-store', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./composables/use-lab-store')>()
	return {
		...actual,
		createLabStore: vi.fn(),
	}
})

describe('app.vue teardown ordering', () => {
	let events: string[]

	beforeEach(() => {
		events = []
		const appStore = {
			previewHost: {
				connection: shallowRef(null),
				evaluateTutorial: vi.fn(async () => 0),
				onTutorialObservation: vi.fn(() => () => {}),
				setTutorialSpotlight: vi.fn(),
			},
			showcaseId: shallowRef('sandbox'),
			isDirty: shallowRef(false),
			dispose: vi.fn(() => events.push('app-store-disposed')),
		} as unknown as LabStore
		vi.mocked(createLabStore)
			.mockReturnValue(appStore)
	})

	it('unmounts the Workbench child before disposing the app store', () => {
		const WorkbenchProbe = defineComponent({
			name: 'Workbench',
			setup() {
				onUnmounted(() => events.push('workbench-unmounted'))
				return () => h('div', { 'data-testid': 'workbench-probe' })
			},
		})
		const wrapper = mount(App, {
			global: {
				stubs: {
					LabHeader: true,
					TutorialConfirmDialog: true,
					TutorialRail: true,
					WelcomeCard: true,
					Workbench: WorkbenchProbe,
				},
			},
		})

		expect(wrapper.find('[data-testid="workbench-probe"]')
			.exists())
			.toBe(true)
		wrapper.unmount()

		expect(events)
			.toEqual(['workbench-unmounted', 'app-store-disposed'])
	})
})

describe('app.vue shortcut and narrow-viewport gate', () => {
	let apply: ReturnType<typeof vi.fn>
	let isDirty: ReturnType<typeof shallowRef<boolean>>
	let isApplying: ReturnType<typeof shallowRef<boolean>>
	let tutorial: TutorialStore | undefined
	let media: { matches: boolean, listeners: Set<(e: { matches: boolean }) => void> }

	const TutorialProbe = defineComponent({
		name: 'WelcomeCard',
		setup() {
			tutorial = inject(TutorialStoreKey)
			return () => h('div')
		},
	})

	function mountApp() {
		return mount(App, {
			attachTo: document.body,
			global: {
				stubs: {
					LabHeader: defineComponent({ name: 'LabHeader', render: () => h('header', { 'data-testid': 'header-probe' }) }),
					TutorialConfirmDialog: true,
					TutorialRail: true,
					WelcomeCard: TutorialProbe,
					Workbench: true,
				},
			},
		})
	}

	function press(init: KeyboardEventInit & { keyCode?: number } = {}): KeyboardEvent {
		const event = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true, ...init })
		if (init.keyCode !== undefined)
			Object.defineProperty(event, 'keyCode', { value: init.keyCode })
		window.dispatchEvent(event)
		return event
	}

	beforeEach(() => {
		sessionStorage.clear()
		tutorial = undefined
		apply = vi.fn(async () => undefined)
		isDirty = shallowRef(true)
		isApplying = shallowRef(false)
		media = { matches: true, listeners: new Set() }
		vi.stubGlobal('matchMedia', () => ({
			get matches() { return media.matches },
			addEventListener: (_: string, l: (e: { matches: boolean }) => void) => media.listeners.add(l),
			removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => media.listeners.delete(l),
		}))
		vi.mocked(createLabStore)
			.mockReturnValue({
				previewHost: {
					connection: shallowRef(null),
					evaluateTutorial: vi.fn(async () => 0),
					onTutorialObservation: vi.fn(() => () => {}),
					setTutorialSpotlight: vi.fn(),
				},
				showcaseId: shallowRef('sandbox'),
				isDirty,
				isApplying,
				apply,
				dispose: vi.fn(),
			} as unknown as LabStore)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('applies on Cmd+Enter and Ctrl+Enter in the normal case', () => {
		const wrapper = mountApp()
		tutorial!.dismissWelcome()
		const event = press()
		press({ metaKey: false, ctrlKey: true })

		expect(apply)
			.toHaveBeenCalledTimes(2)
		expect(event.defaultPrevented)
			.toBe(true)
		wrapper.unmount()
	})

	it('ignores IME composition, key repeat, and already-handled events', () => {
		const wrapper = mountApp()
		tutorial!.dismissWelcome()
		press({ isComposing: true })
		press({ keyCode: 229 })
		press({ repeat: true })
		const handled = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
		handled.preventDefault()
		window.dispatchEvent(handled)

		expect(apply).not.toHaveBeenCalled()
		wrapper.unmount()
	})

	it('ignores the shortcut while the welcome dialog is open', () => {
		const wrapper = mountApp()
		expect(tutorial!.welcomeVisible.value)
			.toBe(true)
		press()
		expect(apply).not.toHaveBeenCalled()

		tutorial!.dismissWelcome()
		press()
		expect(apply)
			.toHaveBeenCalledTimes(1)
		wrapper.unmount()
	})

	it('follows the header Apply button: skips when not dirty or already applying', () => {
		const wrapper = mountApp()
		tutorial!.dismissWelcome()
		isDirty.value = false
		press()
		isDirty.value = true
		isApplying.value = true
		press()

		expect(apply).not.toHaveBeenCalled()
		wrapper.unmount()
	})

	it('ignores the shortcut while the narrow-viewport gate is active and resumes afterwards', async () => {
		const wrapper = mountApp()
		tutorial!.dismissWelcome()
		media.matches = false
		for (const l of media.listeners)
			l({ matches: false })
		await wrapper.vm.$nextTick()
		const gated = press()
		expect(apply).not.toHaveBeenCalled()
		expect(gated.defaultPrevented)
			.toBe(false)

		media.matches = true
		for (const l of media.listeners)
			l({ matches: true })
		await wrapper.vm.$nextTick()
		press()
		expect(apply)
			.toHaveBeenCalledTimes(1)
		wrapper.unmount()
	})

	it('makes the header and .lab-body inert, but not the gate, only while the gate is active', async () => {
		const wrapper = mountApp()
		const inertOf = (selector: string) => wrapper.get(selector).element.closest('[inert]') !== null
		expect(inertOf('[data-testid="header-probe"]'))
			.toBe(false)
		expect(inertOf('.lab-body'))
			.toBe(false)

		media.matches = false
		for (const l of media.listeners)
			l({ matches: false })
		await wrapper.vm.$nextTick()
		expect(inertOf('[data-testid="header-probe"]'))
			.toBe(true)
		expect(inertOf('.lab-body'))
			.toBe(true)
		expect(inertOf('.narrow-viewport-gate'))
			.toBe(false)

		media.matches = true
		for (const l of media.listeners)
			l({ matches: true })
		await wrapper.vm.$nextTick()
		expect(inertOf('[data-testid="header-probe"]'))
			.toBe(false)
		expect(inertOf('.lab-body'))
			.toBe(false)
		wrapper.unmount()
	})
})
