/**
 * `DealStageForm.open`/`save`/`cancel`/`canSave` (checkpoint §2), against the real canonical preset
 * (`../presets.ts`) for every scenario reachable there, plus one small isolated fixture Blueprint (not
 * the canonical preset) for the "DealStore.updateStage fails" propagation case: in the canonical preset
 * `DealStageForm.selectedDeal` and `DealStageForm.save`'s `updateStage` call both trace back to the
 * same `DealStore`, so a deal id visible to `selectedDeal` can never be absent from that store by
 * construction (a property of the design, not a gap) — the isolated fixture wires `tableId` and
 * `storeId` to two independent stores so the missing-id failure is genuinely reachable in isolation.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { defaultCrmPreset } from '../presets'
import { crmSystem } from '../system'
import { createCrmRuntime, widgetOfType } from '../test-support'

/**
 * A source text identical to the canonical preset except `stage-editor`'s configured `options` exclude
 * one `DealStage` literal. Used by the finding-3 regression below (PR #22 review 4941241562): "the
 * editor options exclude the selected deal's current stage".
 */
function sourceTextWithoutStageEditorOption(excludedStage: string): string {
	const definition = JSON.parse(defaultCrmPreset.sourceText) as {
		slots: { overlay: readonly [{ slots: { body: readonly [{ slots: { fields: readonly [{ config: { options: { value: string, label: string }[] } }] } }] } }] }
	}
	const stageEditor = definition.slots.overlay[0].slots.body[0].slots.fields[0]
	stageEditor.config.options = stageEditor.config.options.filter(option => option.value !== excludedStage)
	return JSON.stringify(definition)
}

function setup() {
	const { runtime } = createCrmRuntime()
	const form = widgetOfType(runtime, 'deal-stage-form', 'DealStageForm')
	const table = widgetOfType(runtime, 'deal-table', 'Table')
	const modal = widgetOfType(runtime, 'stage-modal', 'Modal')
	const stageEditor = widgetOfType(runtime, 'stage-editor', 'SelectInput')
	const store = widgetOfType(runtime, 'deal-store', 'DealStore')
	return { runtime, form, table, modal, stageEditor, store }
}

describe('dealStageForm.open()', () => {
	it('fails with a method issue and leaves the modal closed when no deal is selected', () => {
		const { form, modal } = setup()
		const result = form.methods.open()
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-result')
		expect(modal.state.open.get())
			.toBe(false)
	})

	it('initializes stage-editor to the selected deal\'s stage and opens the Modal', () => {
		const { form, table, modal, stageEditor } = setup()
		table.methods.selectRow('deal-3') // seed: Cobalt Health, stage "proposal"

		const result = form.methods.open()

		expect(result)
			.toEqual({ success: true, value: undefined })
		expect(stageEditor.state.value.get())
			.toBe('proposal')
		expect(modal.state.open.get())
			.toBe(true)
	})
})

describe('dealStageForm.save()', () => {
	it('happy path: updates the store, closes the Modal, and returns the updated Deal', () => {
		const { form, table, modal, stageEditor } = setup()
		table.methods.selectRow('deal-3')
		form.methods.open()
		stageEditor.state.value.set('won')

		const result = form.methods.save()

		expect(result)
			.toEqual({ success: true, value: { id: 'deal-3', company: 'Cobalt Health', contact: 'Grace Kim', owner: 'Jordan Lee', stage: 'won', amount: 54_000 } })
		expect(modal.state.open.get())
			.toBe(false)
	})

	it('does not depend on canSave: succeeds even though this component never reads canSave', () => {
		const { form, table, stageEditor } = setup()
		table.methods.selectRow('deal-1')
		form.methods.open()
		stageEditor.state.value.set('qualified')

		// Deliberately never inspect `form.properties.canSave` before calling save() — the checkpoint
		// locks `save()` as not consuming/depending on it.
		const result = form.methods.save()
		expect(result.success)
			.toBe(true)
	})

	it('fails via dependency propagation (no modal close) when the selected deal is filtered away before saving', () => {
		const { form, table, modal, stageEditor, runtime } = setup()
		table.methods.selectRow('deal-1')
		form.methods.open()
		stageEditor.state.value.set('won')

		const stageFilter = widgetOfType(runtime, 'stage-filter', 'SelectInput')
		stageFilter.state.value.set('won') // deal-1 is "lead" — this hides it from Table.selectedRow

		const result = form.methods.save()
		expect(result.success)
			.toBe(false)
		expect(modal.state.open.get())
			.toBe(true)
	})
})

describe('dealStageForm.cancel()', () => {
	it('closes the Modal without mutating any deal', () => {
		const { form, table, modal, store } = setup()
		table.methods.selectRow('deal-2')
		form.methods.open()
		expect(modal.state.open.get())
			.toBe(true)
		const before = store.state.deals.get()

		const result = form.methods.cancel()

		expect(result)
			.toEqual({ success: true, value: undefined })
		expect(modal.state.open.get())
			.toBe(false)
		expect(store.state.deals.get())
			.toEqual(before)
	})
})

describe('dealStageForm.canSave', () => {
	it('is false with no selection and true once a deal is selected', () => {
		const { form, table } = setup()
		expect(form.properties.canSave.get())
			.toEqual({ success: true, value: false })

		table.methods.selectRow('deal-1')
		expect(form.properties.canSave.get())
			.toEqual({ success: true, value: true })
	})
})

// -------------------------------------------------------------------------------------------------
// Isolated fixture: DealStageForm.save() propagating a genuine DealStore.updateStage failure.
// -------------------------------------------------------------------------------------------------

function createIsolatedStoreMismatchRuntime(): WidgetSystemRuntime {
	const source = {
		id: 'root',
		type: 'Card',
		slots: {
			body: [
				{ id: 'store-a', type: 'DealStore', config: { seedDeals: [{ id: 'ghost-deal', company: 'Ghost Co', contact: 'G', owner: 'O', stage: 'lead', amount: 100 }] } },
				{ id: 'store-b', type: 'DealStore', config: { seedDeals: [] } },
				{ id: 'search-a', type: 'TextInput', config: { label: 'Search' } },
				{ id: 'filter-a', type: 'SelectInput', config: { label: 'Stage', options: [{ value: 'all', label: 'All' }], default: 'all' } },
				{ id: 'query-a', type: 'DealQuery', config: { storeId: 'store-a', searchInputId: 'search-a', stageFilterId: 'filter-a' } },
				{ id: 'table-a', type: 'Table', config: { source: { widgetId: 'query-a', property: 'filteredDeals' }, rowIdKey: 'id', columns: [] } },
				{ id: 'stage-editor-a', type: 'SelectInput', config: { label: 'Stage', options: [{ value: 'lead', label: 'Lead' }, { value: 'won', label: 'Won' }], default: 'lead' } },
				{ id: 'modal-a', type: 'Modal', config: { title: 'Modal' } },
				{ id: 'form-a', type: 'DealStageForm', config: { storeId: 'store-b', tableId: 'table-a', stageInputId: 'stage-editor-a', modalId: 'modal-a' }, slots: { fields: [], actions: [] } },
			],
		},
	}
	const blueprint = crmSystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)
	return blueprint.createRuntime()
}

describe('dealStageForm.save() — propagates a genuine DealStore.updateStage failure (isolated fixture)', () => {
	it('leaves the Modal open and returns a failure when the selected deal id is absent from the configured store', () => {
		const runtime = createIsolatedStoreMismatchRuntime()
		const table = widgetOfType(runtime, 'table-a', 'Table')
		const form = widgetOfType(runtime, 'form-a', 'DealStageForm')
		const modal = widgetOfType(runtime, 'modal-a', 'Modal')

		expect(table.methods.selectRow('ghost-deal').success)
			.toBe(true)
		expect(form.methods.open().success)
			.toBe(true)
		expect(modal.state.open.get())
			.toBe(true)

		const result = form.methods.save()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-dependency')
		expect(modal.state.open.get())
			.toBe(true)
	})
})

describe('dealStageForm.open() — stage-editor options exclude the selected deal\'s current stage (PR #22 review 4941241562 finding 3 regression)', () => {
	it('fails and leaves the Modal closed instead of opening with a stale/default stage-editor value', () => {
		const { runtime } = createCrmRuntime(sourceTextWithoutStageEditorOption('proposal'))
		const form = widgetOfType(runtime, 'deal-stage-form', 'DealStageForm')
		const table = widgetOfType(runtime, 'deal-table', 'Table')
		const modal = widgetOfType(runtime, 'stage-modal', 'Modal')
		const stageEditor = widgetOfType(runtime, 'stage-editor', 'SelectInput')

		// deal-3 (Cobalt Health) is seeded at stage "proposal", which is no longer a legal stage-editor
		// option in this fixture.
		expect(table.methods.selectRow('deal-3').success)
			.toBe(true)
		expect(stageEditor.state.value.get())
			.toBe('lead') // untouched configured default — proves open() never got to write it

		const result = form.methods.open()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-dependency')
		expect(modal.state.open.get())
			.toBe(false)
		// The failed write must not have mutated stage-editor's value either.
		expect(stageEditor.state.value.get())
			.toBe('lead')
	})
})
