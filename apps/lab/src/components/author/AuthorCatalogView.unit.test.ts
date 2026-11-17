// @vitest-environment happy-dom

import { createWidgetSystem } from '@deviltea/widget-core'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { LabStoreKey } from '../../composables/use-lab-store'
import { NotifierPlugin, PlainPlugin } from '../../events/test-support'
import { labI18nProvide } from '../../test-support-i18n'
import AuthorCatalogView from './AuthorCatalogView.vue'

/** Issue #230 (audit U09): the Catalog lists the Events each plugin declares, with a chip for the capability. */
function mountCatalog(locale: 'en' | 'zh-TW' = 'en') {
	const system = createWidgetSystem({ plugins: [NotifierPlugin, PlainPlugin] })
	return mount(AuthorCatalogView, {
		global: {
			provide: {
				...labI18nProvide(locale),
				[LabStoreKey as symbol]: { showcaseId: shallowRef('survey'), session: { system } },
			},
		},
	})
}

describe('author catalog declared Events', () => {
	it('lists the Events of a plugin that declares them, with their descriptions', () => {
		const section = mountCatalog()
			.get('[data-testid="author-catalog-events-Notifier"]')
		expect(section.findAll('[data-testid="declared-event"]')
			.map(event => event.text()))
			.toEqual(['changed: The value changed.', 'pinged: Pinged.'])
	})

	it('shows no Events section for a plugin without the capability, and dims its chip', () => {
		const wrapper = mountCatalog()
		expect(wrapper.find('[data-testid="author-catalog-events-Plain"]')
			.exists())
			.toBe(false)
		const chips = (type: string): Record<string, string> => Object.fromEntries(wrapper.get(`[data-testid="author-catalog-${type}"]`)
			.findAll('span')
			.filter(span => ['Config', 'Slots', 'State', 'Properties', 'Methods', 'Events'].includes(span.text()))
			.map(span => [span.text(), span.attributes('style') ?? '']))
		expect(chips('Notifier').Events)
			.toContain('opacity: 1')
		expect(chips('Plain').Events)
			.toContain('opacity: 0.4')
	})

	it('translates the section label but not the Event names or descriptions', () => {
		const section = mountCatalog('zh-TW')
			.get('[data-testid="author-catalog-events-Notifier"]')
		expect(section.get('strong')
			.text())
			.toBe('Events:')
		expect(section.get('[data-testid="declared-event"]')
			.text())
			.toBe('changed: The value changed.')
	})
})
