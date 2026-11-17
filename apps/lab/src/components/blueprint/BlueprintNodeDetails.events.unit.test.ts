// @vitest-environment happy-dom

import { createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { ImplementationExplorerKey } from '../../composables/use-implementation-explorer'
import { LabStoreKey } from '../../composables/use-lab-store'
import { NotifierPlugin, PlainPlugin } from '../../events/test-support'
import { testGlobalProperties } from '../../test-support'
import { labI18nProvide } from '../../test-support-i18n'
import BlueprintNodeDetails from './BlueprintNodeDetails.vue'

/** Issue #230 (audit U09): the Blueprint / Selected widget declaration lists the Events the widget's plugin declares. */
function mountNode(type: 'Notifier' | 'Plain', locale: 'en' | 'zh-TW' = 'en') {
	const system = createWidgetSystem({ plugins: [NotifierPlugin, PlainPlugin] })
	const blueprint = system.createBlueprint({ id: 'w', type })
	const inspection = inspectBlueprint(blueprint)
	return mount(BlueprintNodeDetails, {
		props: { node: inspection.getNode(inspection.rootNodeId), blueprint, inspection, embedded: true },
		global: {
			config: { globalProperties: testGlobalProperties },
			provide: {
				...labI18nProvide(locale),
				[LabStoreKey as symbol]: { showcaseId: shallowRef('survey') },
				[ImplementationExplorerKey as symbol]: { open: () => {} },
			},
		},
	})
}

describe('blueprintNodeDetails declared Events', () => {
	it('lists each declared Event with its description, verbatim', () => {
		const wrapper = mountNode('Notifier')
		const events = wrapper.findAll('[data-testid="declared-event"]')
		expect(events.map(event => event.attributes('data-event')))
			.toEqual(['changed', 'pinged'])
		expect(events[0]!.text())
			.toBe('changed: The value changed.')
		expect(wrapper.get('[data-testid="blueprint-node-events"]')
			.text())
			.toContain('Events (2)')
		expect(wrapper.text())
			.toContain('2 Methods · 2 Events')
	})

	it('says so when the plugin declares no Events capability, and keeps the description untranslated in zh-TW', () => {
		expect(mountNode('Plain')
			.get('[data-testid="declared-events-none"]')
			.text())
			.toBe('No Events capability.')
		expect(mountNode('Notifier', 'zh-TW')
			.get('[data-testid="declared-event"]')
			.text())
			.toBe('changed: The value changed.')
		expect(mountNode('Plain', 'zh-TW')
			.get('[data-testid="declared-events-none"]')
			.text())
			.toBe('沒有 Events capability。')
	})
})
