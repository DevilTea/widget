// @vitest-environment happy-dom
import type { InspectorBlueprintNode, InspectorRuntimeWidgetSnapshot } from '@deviltea/widget-inspector/protocol'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { LabStoreKey } from '../../composables/use-lab-store'
import RuntimeNodeDetails from './RuntimeNodeDetails.vue'

function method(name: string, transitivelyWrites: boolean, transitivelyEmits?: boolean) {
	return { type: 'method' as const, name, transitivelyWrites, ...(transitivelyEmits === undefined ? {} : { transitivelyEmits }), dependencies: [] }
}

const node = {
	nodeId: 1,
	resolved: true,
	widgetId: 'w',
	widgetType: 'W',
	sourceSlots: [],
	state: [],
	properties: [],
	methods: [
		method('ping', false, true),
		method('bump', true, true),
		method('save', true, false),
		method('legacy', false),
	],
	diagnostics: [],
} as unknown as InspectorBlueprintNode

describe('runtimeNodeDetails Method rows', () => {
	it('passes each Method\'s own transitivelyWrites and transitivelyEmits to its row', () => {
		const wrapper = mount(RuntimeNodeDetails, {
			props: {
				node,
				widgetSnapshot: { ref: { nodeId: 1 }, widgetId: 'w', widgetType: 'W', members: [] } as unknown as InspectorRuntimeWidgetSnapshot,
				client: {} as never,
			},
			global: {
				provide: {
					[LabI18nKey as symbol]: { locale: { value: 'en' }, locales: ['en'], setLocale: () => {}, t: (source: string) => source },
					[LabStoreKey as symbol]: { previewFocus: shallowRef(null), setFocus: () => {} },
				},
			},
		})

		const markers = (name: string) => {
			const text = wrapper.findAll('button')
				.find(button => button.text()
					.startsWith(`${name}()`))
				?.text() ?? ''
			return { writes: text.includes('writes'), emits: text.includes('emits') }
		}
		expect(markers('ping'))
			.toEqual({ writes: false, emits: true })
		expect(markers('bump'))
			.toEqual({ writes: true, emits: true })
		expect(markers('save'))
			.toEqual({ writes: true, emits: false })
		// `transitivelyEmits` absent (Inspector below protocol 0.4): no marker.
		expect(markers('legacy'))
			.toEqual({ writes: false, emits: false })
	})
})
