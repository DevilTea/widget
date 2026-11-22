// @vitest-environment happy-dom

import type { LabStore } from './composables/use-lab-store'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, inject, onUnmounted, shallowRef } from 'vue'
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
			// Read by the tutorial store (rechecks on every Document revision) and App.vue's spotlight (the Author view).
			documentState: shallowRef({ revision: 0 }),
			authorView: shallowRef('structure'),
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
					DraftGuardDialog: true,
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

describe('app.vue narrow-viewport gate and the retired Apply shortcut', () => {
	let media: { matches: boolean, listeners: Set<(e: { matches: boolean }) => void> }
	let flushJson: ReturnType<typeof vi.fn>

	const TutorialProbe = defineComponent({
		name: 'WelcomeCard',
		setup() {
			inject(TutorialStoreKey)
			return () => h('div')
		},
	})

	function mountApp() {
		return mount(App, {
			attachTo: document.body,
			global: {
				stubs: {
					LabHeader: defineComponent({ name: 'LabHeader', render: () => h('header', { 'data-testid': 'header-probe' }) }),
					DraftGuardDialog: true,
					TutorialConfirmDialog: true,
					TutorialRail: true,
					WelcomeCard: TutorialProbe,
					Workbench: true,
				},
			},
		})
	}

	beforeEach(() => {
		sessionStorage.clear()
		flushJson = vi.fn(async () => null)
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
				// Read by the tutorial store (rechecks on every Document revision) and App.vue's spotlight (the Author view).
				documentState: shallowRef({ revision: 0 }),
				authorView: shallowRef('structure'),
				isDirty: shallowRef(true),
				jsonBlocked: computed(() => false),
				flushJson,
				dispose: vi.fn(),
			} as unknown as LabStore)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	// Lab UX phase 3: there is no Apply, so Cmd/Ctrl+Enter has no window-wide meaning. The JSON editor's own action commits
	// (`use-monaco-editor.unit.test.ts`); everywhere else the key is left to the focused control and the browser.
	it('leaves Cmd/Ctrl+Enter outside the JSON editor alone: nothing is committed and the event is not claimed', () => {
		const wrapper = mountApp()
		const meta = new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })
		const ctrl = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
		window.dispatchEvent(meta)
		window.dispatchEvent(ctrl)
		expect(flushJson).not.toHaveBeenCalled()
		expect(meta.defaultPrevented)
			.toBe(false)
		expect(ctrl.defaultPrevented)
			.toBe(false)
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
