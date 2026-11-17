// @vitest-environment happy-dom
import type { InspectorBlueprintNode, InspectorRuntimeWidgetSnapshot } from '@deviltea/widget-inspector/protocol'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { LabStoreKey } from '../../composables/use-lab-store'
import RuntimeNodeDetails from './RuntimeNodeDetails.vue'

/** Issue #230, audit U08: the Runtime inspectors hand each Method row its own diagnostic snapshot. */
const method = (name: string) => ({ type: 'method' as const, name, transitivelyWrites: false, transitivelyEmits: false, dependencies: [] })
const node = {
	nodeId: 1,
	resolved: true,
	widgetId: 'w',
	widgetType: 'W',
	sourceSlots: [],
	state: [],
	properties: [],
	methods: [method('ping'), method('bump'), method('legacy')],
	diagnostics: [],
} as unknown as InspectorBlueprintNode

const failure = { code: 'invalid-method-result', message: 'It failed.', location: { type: 'method', widgetId: 'w', name: 'bump' }, reason: 'because' }
const stubClient = { on: () => () => {}, request: () => new Promise(() => {}) } as never

function mountDetails(members: unknown[]) {
	return mount(RuntimeNodeDetails, {
		props: {
			node,
			widgetSnapshot: { ref: { runtimeId: 'r', nodeId: 1 }, widgetId: 'w', widgetType: 'W', members } as unknown as InspectorRuntimeWidgetSnapshot,
			client: stubClient,
		},
		global: {
			provide: {
				[LabI18nKey as symbol]: { locale: { value: 'en' }, locales: ['en'], setLocale: () => {}, t: (source: string) => source },
				[LabStoreKey as symbol]: { previewFocus: shallowRef(null), setFocus: () => {} },
			},
		},
	})
}

describe('runtimeNodeDetails Method failures', () => {
	it('gives each Method row its own snapshot, and none to a Method the peer sends none for', () => {
		const wrapper = mountDetails([
			{ type: 'method', name: 'ping', diagnostics: [] },
			{ type: 'method', name: 'bump', diagnostics: [failure] },
		])
		const rows = Object.fromEntries(wrapper.findAll('[data-testid="runtime-method-row"]')
			.map(row => [row.attributes('data-member'), row]))
		expect(rows.bump!.get('[data-testid="method-status"]')
			.text())
			.toBe('Last call failed')
		expect(rows.bump!.get('[data-testid="method-diagnostic-reason"]')
			.text())
			.toBe('because')
		expect(rows.ping!.get('[data-testid="method-status"]')
			.text())
			.toBe('No failure recorded')
		// No member in the snapshot (a peer below protocol 0.5): no status at all.
		expect(rows.legacy!.find('[data-testid="method-status"]')
			.exists())
			.toBe(false)
	})

	it('no longer calls the Methods inventory only', () => {
		expect(mountDetails([])
			.text())
			.not
			.toContain('inventory only')
	})
})
