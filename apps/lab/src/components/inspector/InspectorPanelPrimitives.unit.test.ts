// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import InspectorPanelShell from './InspectorPanelShell.vue'
import InspectorSplitLayout from './InspectorSplitLayout.vue'

const global = {
	config: { globalProperties: { pika: (value: unknown) => JSON.stringify(value) } },
	provide: {
		[LabI18nKey as symbol]: {
			locale: { value: 'en' },
			locales: ['en', 'zh-TW'],
			setLocale: () => {},
			t: (source: string) => source,
		},
	},
}

describe('inspector presentation primitives', () => {
	beforeEach(() => {
		sessionStorage.clear()
	})

	it('renders the caller content inside the shared description shell', () => {
		const wrapper = mount(InspectorPanelShell, {
			props: {
				storageKey: 'widget-lab:test:inspector-shell',
				text: 'Inspector description',
			},
			slots: { default: '<div data-testid="caller-content">Blueprint-owned content</div>' },
			global,
		})

		expect(wrapper.get('[data-testid="inspector-panel-shell"]')
			.text())
			.toContain('Inspector description')
		expect(wrapper.get('[data-testid="caller-content"]')
			.text())
			.toBe('Blueprint-owned content')
	})

	it('keeps tree and details slots in the shared three-column layout', () => {
		const wrapper = mount(InspectorSplitLayout, {
			slots: {
				tree: '<button data-testid="tree-slot">Document tree</button>',
				details: '<div data-testid="details-slot">Runtime details</div>',
			},
			global,
		})
		const layout = wrapper.get('[data-testid="inspector-split-layout"]')

		expect(layout.element.children)
			.toHaveLength(3)
		expect(wrapper.get('[data-testid="tree-slot"]')
			.text())
			.toBe('Document tree')
		expect(wrapper.get('[data-testid="details-slot"]')
			.text())
			.toBe('Runtime details')
	})
})
