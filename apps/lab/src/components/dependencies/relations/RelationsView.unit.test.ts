// @vitest-environment happy-dom

import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { RelationsMemberIdentity, RelationsViewModel } from '../../../graph/relations'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { LabI18nKey } from '../../../composables/use-lab-i18n'
import RelationsView from './RelationsView.vue'

function method(flags: { transitivelyWrites?: boolean, transitivelyEmits?: boolean }): RelationsMemberIdentity {
	return {
		nodeId: 1 as InspectionNodeId,
		clusterId: 'cluster:1',
		widgetId: 'w',
		widgetType: 'W',
		kind: 'method',
		name: 'ping',
		invalidCycle: false,
		...flags,
	}
}

function mountModel(model: RelationsViewModel) {
	return mount(RelationsView, {
		props: { model },
		global: {
			// `pika()` is replaced by the PikaCSS build transform, which the unit test pipeline does not run.
			mocks: { pika: () => '' },
			provide: {
				[LabI18nKey as symbol]: { locale: shallowRef('en'), locales: ['en'], setLocale: () => {}, t: (source: string) => source },
			},
		},
	})
}

function memberModel(selectedMember: RelationsMemberIdentity): RelationsViewModel {
	return { mode: 'member', selectedMember, usedBy: [], dependsOn: [], totalUsedByCount: 0, totalDependsOnCount: 0 }
}

function widgetModel(members: RelationsMemberIdentity[]): RelationsViewModel {
	return {
		mode: 'widget',
		selectedWidget: { nodeId: 1 as InspectionNodeId, clusterId: 'cluster:1', widgetId: 'w', widgetType: 'W', label: 'w : W', memberCounts: { state: 0, property: 0, method: members.length, total: members.length }, members },
		usedBy: [],
		dependsOn: [],
		internal: [],
		totalUsedByCount: 0,
		totalDependsOnCount: 0,
		totalInternalCount: 0,
	}
}

describe('relationsView Method effect markers', () => {
	it('selected member: shows "E emits" for emitting, "W writes" for writing, both for both, neither for neither', () => {
		const none = mountModel(memberModel(method({ transitivelyWrites: false, transitivelyEmits: false })))
			.text()
		expect(none)
			.not
			.toContain('W writes')
		expect(none)
			.not
			.toContain('E emits')

		const emits = mountModel(memberModel(method({ transitivelyWrites: false, transitivelyEmits: true })))
			.text()
		expect(emits)
			.toContain('E emits')
		expect(emits)
			.not
			.toContain('W writes')

		const writes = mountModel(memberModel(method({ transitivelyWrites: true, transitivelyEmits: false })))
			.text()
		expect(writes)
			.toContain('W writes')
		expect(writes)
			.not
			.toContain('E emits')

		const both = mountModel(memberModel(method({ transitivelyWrites: true, transitivelyEmits: true })))
			.text()
		expect(both)
			.toContain('E emits')
		expect(both)
			.toContain('W writes')
	})

	it('selected member: an absent transitivelyEmits (unknown) shows no emits marker', () => {
		expect(mountModel(memberModel(method({ transitivelyWrites: true })))
			.text())
			.not
			.toContain('E emits')
	})

	it('widget member chips: W and E appear independently', () => {
		const wrapper = mountModel(widgetModel([
			{ ...method({ transitivelyWrites: true, transitivelyEmits: true }), name: 'both' },
			{ ...method({ transitivelyWrites: false, transitivelyEmits: true }), name: 'onlyEmits' },
			{ ...method({ transitivelyWrites: false, transitivelyEmits: false }), name: 'quiet' },
		]))
		const chipText = (name: string) => wrapper.findAll('button')
			.find(button => button.text()
				.includes(name))
			?.text()
			.replace(name, '')
		expect(chipText('both'))
			.toMatch(/W\s*E/)
		expect(chipText('onlyEmits'))
			.toMatch(/E/)
		expect(chipText('onlyEmits'))
			.not
			.toMatch(/W/)
		expect(chipText('quiet'))
			.not
			.toMatch(/[WE]/)
	})
})
