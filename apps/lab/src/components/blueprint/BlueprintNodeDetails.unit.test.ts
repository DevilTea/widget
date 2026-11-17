// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { ImplementationExplorerKey } from '../../composables/use-implementation-explorer'
import { LabStoreKey } from '../../composables/use-lab-store'
import { labI18nProvide } from '../../test-support-i18n'
import BlueprintNodeDetails from './BlueprintNodeDetails.vue'

function mountEmpty(embedded: boolean, locale: 'en' | 'zh-TW' = 'en') {
	return mount(BlueprintNodeDetails, {
		props: { node: null, blueprint: {} as never, inspection: {} as never, embedded },
		global: {
			provide: {
				...labI18nProvide(locale),
				[LabStoreKey as symbol]: { showcaseId: shallowRef('survey') },
				[ImplementationExplorerKey as symbol]: { open: () => {} },
			},
		},
	})
}

describe('blueprintNodeDetails empty state', () => {
	it('points at the tree on the left in the Blueprint panel', () => {
		expect(mountEmpty(false)
			.text())
			.toBe('No node selected — click a node in the tree on the left to see its config, slots, and diagnostics.')
	})

	it('does not mention a tree that is not there when embedded in the Selected widget pane', () => {
		const text = mountEmpty(true)
			.text()
		expect(text)
			.toBe('No widget selected — choose one with Inspect in the Preview, or in Blueprint or Dependencies, to see its declaration.')
		expect(text)
			.not
			.toContain('on the left')
	})

	it('has zh-TW copy for the embedded variant', () => {
		expect(mountEmpty(true, 'zh-TW')
			.text())
			.toBe('尚未選取 widget——請用 Preview 的檢視模式，或在 Blueprint、「相依性」選一個，即可查看它的宣告。')
	})
})
