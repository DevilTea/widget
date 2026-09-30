// @vitest-environment happy-dom

import type { LabStore } from './composables/use-lab-store'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, onUnmounted, shallowRef } from 'vue'
import App from './App.vue'
import { createLabStore } from './composables/use-lab-store'

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
