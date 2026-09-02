/**
 * The canonical Showcase B preset (checkpoint §6) compiles to a valid Blueprint with the exact
 * dependency-graph evidence checkpoint §4 requires (spot-checked via `@deviltea/widget-core/inspection`
 * facts, never re-derived), plus the checkpoint §1 coordinated live-path demonstration end to end
 * (filter → select → change stage to won → save → recompute → retained-but-empty selection).
 */

import type { BlueprintInspectionNode, ResolvedBlueprintInspectionNode } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { crmPresets, defaultCrmPreset } from './presets'
import { crmSystem } from './system'
import { createCrmRuntime, widgetOfType } from './test-support'

function compileDefault() {
	const blueprint = crmSystem.createBlueprint(JSON.parse(defaultCrmPreset.sourceText))
	if (blueprint.status !== 'valid')
		throw new Error(`expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)
	return blueprint
}

function resolvedNode(blueprint: ReturnType<typeof compileDefault>, id: string): ResolvedBlueprintInspectionNode {
	const inspection = inspectBlueprint(blueprint)
	const node = inspection.nodes.find((candidate: BlueprintInspectionNode) => candidate.resolved && candidate.node.id === id)
	if (node === undefined || !node.resolved)
		throw new Error(`expected a resolved inspection node for widget "${id}"`)
	return node
}

describe('product Prototype presets', () => {
	it.each(crmPresets)('"$id" compiles to a valid Blueprint with no collected diagnostics', (preset) => {
		const blueprint = crmSystem.createBlueprint(JSON.parse(preset.sourceText))
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('exposes the canonical default preset first', () => {
		expect(crmPresets[0])
			.toBe(defaultCrmPreset)
	})
})

describe('dependency-graph evidence (checkpoint §4 spot-checks)', () => {
	it('dealQuery.filteredDeals reads all three configured sources: DealStore.deals, deal-search.value, stage-filter.value', () => {
		const blueprint = compileDefault()
		const property = resolvedNode(blueprint, 'deal-query').properties.find(candidate => candidate.name === 'filteredDeals')!
		expect(property.dependencies.every(dep => dep.status === 'resolved'))
			.toBe(true)

		const targets = property.dependencies.map(dep => (dep.status === 'resolved' ? dep.target : null))
		expect(targets)
			.toEqual(expect.arrayContaining([
				{ nodeId: resolvedNode(blueprint, 'deal-store').nodeId, member: { type: 'state', name: 'deals' } },
				{ nodeId: resolvedNode(blueprint, 'deal-search').nodeId, member: { type: 'state', name: 'value' } },
				{ nodeId: resolvedNode(blueprint, 'stage-filter').nodeId, member: { type: 'state', name: 'value' } },
			]))
	})

	it('button#change-stage/save-stage/cancel-stage each resolve press() to the matching DealStageForm.open/save/cancel method-invoke edge', () => {
		const blueprint = compileDefault()
		const formNodeId = resolvedNode(blueprint, 'deal-stage-form').nodeId

		const cases: readonly [string, string][] = [
			['change-stage', 'open'],
			['save-stage', 'save'],
			['cancel-stage', 'cancel'],
		]
		for (const [buttonId, methodName] of cases) {
			const method = resolvedNode(blueprint, buttonId).methods.find(candidate => candidate.name === 'press')!
			const dep = method.dependencies[0]!
			if (dep.status !== 'resolved')
				throw new Error(`expected a resolved dependency for Button#${buttonId}.press`)
			expect(dep.target)
				.toEqual({ nodeId: formNodeId, member: { type: 'method', name: methodName } })
		}
	})

	it('dealStore.updateStage is compiler-marked transitivelyWrites; DealStore.reset and Table.selectRow too', () => {
		const blueprint = compileDefault()
		const store = resolvedNode(blueprint, 'deal-store')
		expect(store.methods.find(candidate => candidate.name === 'updateStage')!.transitivelyWrites)
			.toBe(true)
		expect(store.methods.find(candidate => candidate.name === 'reset')!.transitivelyWrites)
			.toBe(true)

		const table = resolvedNode(blueprint, 'deal-table')
		expect(table.methods.find(candidate => candidate.name === 'selectRow')!.transitivelyWrites)
			.toBe(true)
	})

	it('dealStageForm.selectedDeal reads Table.selectedRow', () => {
		const blueprint = compileDefault()
		const property = resolvedNode(blueprint, 'deal-stage-form').properties.find(candidate => candidate.name === 'selectedDeal')!
		const dep = property.dependencies[0]!
		if (dep.status !== 'resolved')
			throw new Error('expected a resolved dependency')
		expect(dep.target)
			.toEqual({ nodeId: resolvedNode(blueprint, 'deal-table').nodeId, member: { type: 'property', name: 'selectedRow' } })
	})
})

describe('coordinated live path (checkpoint §1 required demonstration)', () => {
	it('filter to proposal, select a deal, change its stage to won and save: row leaves the filtered table, KPIs/chart recompute, selection retained but empty', () => {
		const { runtime } = createCrmRuntime()
		const stageFilter = widgetOfType(runtime, 'stage-filter', 'SelectInput')
		const table = widgetOfType(runtime, 'deal-table', 'Table')
		const query = widgetOfType(runtime, 'deal-query', 'DealQuery')
		const form = widgetOfType(runtime, 'deal-stage-form', 'DealStageForm')
		const stageEditor = widgetOfType(runtime, 'stage-editor', 'SelectInput')
		const modal = widgetOfType(runtime, 'stage-modal', 'Modal')

		// filter stage = proposal
		stageFilter.state.value.set('proposal')
		expect(query.properties.count.get())
			.toEqual({ ok: true, value: 2 })

		// select a proposal deal
		expect(table.methods.selectRow('deal-3').ok)
			.toBe(true)

		// open Change stage
		expect(form.methods.open().ok)
			.toBe(true)
		expect(stageEditor.state.value.get())
			.toBe('proposal')
		expect(modal.state.open.get())
			.toBe(true)

		// change stage -> won, save
		stageEditor.state.value.set('won')
		const saveResult = form.methods.save()
		expect(saveResult)
			.toEqual({ ok: true, value: { id: 'deal-3', company: 'Cobalt Health', contact: 'Grace Kim', owner: 'Jordan Lee', stage: 'won', amount: 54_000 } })

		// store mutates; proposal-filtered table loses that row
		const filtered = query.properties.filteredDeals.get()
		expect(filtered.ok && filtered.value.map(deal => deal.id))
			.toEqual(['deal-4'])

		// count/value/chart recompute
		expect(query.properties.count.get())
			.toEqual({ ok: true, value: 1 })
		expect(query.properties.pipelineValue.get())
			.toEqual({ ok: true, value: 41_000 })
		const series = query.properties.stageSeries.get()
		expect(series.ok && series.value)
			.toEqual([
				{ label: 'lead', value: 0 },
				{ label: 'qualified', value: 0 },
				{ label: 'proposal', value: 1 },
				{ label: 'negotiation', value: 0 },
				{ label: 'won', value: 0 },
				{ label: 'lost', value: 0 },
			])

		// selectedRow becomes null while selectedRowId remains retained
		expect(table.state.selectedRowId.get())
			.toBe('deal-3')
		expect(table.properties.selectedRow.get())
			.toEqual({ ok: true, value: null })

		// Modal closed after a successful save
		expect(modal.state.open.get())
			.toBe(false)

		// If the retained id becomes visible again, selectedRow reappears without rewriting selectedRowId.
		stageFilter.state.value.set('won')
		expect(table.state.selectedRowId.get())
			.toBe('deal-3')
		const reappeared = table.properties.selectedRow.get()
		expect(reappeared.ok && reappeared.value?.id)
			.toBe('deal-3')
	})
})
