// @vitest-environment happy-dom

import { createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { ImplementationExplorerKey } from '../../composables/use-implementation-explorer'
import { LabStoreKey } from '../../composables/use-lab-store'
import { NotifierPlugin, PlainPlugin } from '../../events/test-support'
import { defaultOnboardingPreset } from '../../showcases/onboarding/presets'
import { onboardingSystem } from '../../showcases/onboarding/system'
import { labI18nProvide } from '../../test-support-i18n'
import BlueprintNodeDetails from './BlueprintNodeDetails.vue'

// The fixture plugins are not a showcase: their documentation comes from a stand-in entry (see `eventsFixtureShowcase`).
vi.mock('../../showcases/registry', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../showcases/registry')>()
	const { eventsFixtureShowcase } = await import('../../events/test-support')
	return { ...actual, getShowcase: (id: string) => id === eventsFixtureShowcase.id ? eventsFixtureShowcase : actual.getShowcase(id) }
})

/** Issue #230 (audit U09): the Blueprint / Selected widget declaration lists the Events the widget's plugin declares. */
function mountNode(type: 'Notifier' | 'Plain', locale: 'en' | 'zh-TW' = 'en') {
	const system = createWidgetSystem({ plugins: [NotifierPlugin, PlainPlugin] })
	const blueprint = system.createBlueprint({ id: 'w', type })
	const inspection = inspectBlueprint(blueprint)
	return mount(BlueprintNodeDetails, {
		props: { node: inspection.getNode(inspection.rootNodeId), blueprint, inspection, embedded: true },
		global: {
			provide: {
				...labI18nProvide(locale),
				[LabStoreKey as symbol]: { showcaseId: shallowRef('events-fixture') },
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
			.toContain('3 Methods · 2 Events')
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

	it('reads a showcase\'s Event descriptions from its generated documentation (the JSDoc on its Interfaces)', () => {
		const blueprint = onboardingSystem.createBlueprint(JSON.parse(defaultOnboardingPreset.sourceText))
		const inspection = inspectBlueprint(blueprint)
		const wrapper = mount(BlueprintNodeDetails, {
			props: { node: inspection.getNode(inspection.rootNodeId), blueprint, inspection, embedded: true },
			global: {
				provide: {
					...labI18nProvide('en'),
					[LabStoreKey as symbol]: { showcaseId: shallowRef('onboarding') },
					[ImplementationExplorerKey as symbol]: { open: () => {} },
				},
			},
		})
		expect(wrapper.findAll('[data-testid="declared-event"]')
			.map(event => event.text()))
			.toEqual([
				'stepChanged: The visitor moved to another step. Carries the step ids and indexes it left and entered, and how (next, back or jump).',
				'completed: The visitor finished the wizard. Carries every step\'s answers by step id.',
			])
	})
})
