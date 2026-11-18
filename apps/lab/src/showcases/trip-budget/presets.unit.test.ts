/**
 * The three presets: the default is valid and its chain has the documented numbers, the invalid one has exactly
 * one located diagnostic per mistake, and the run-time failure one compiles and fails when it runs.
 */

import { describe, expect, it } from 'vitest'
import { defaultTripBudgetPreset, tripBudgetPresets } from './presets'
import { tripBudgetSystem } from './system'
import { createTripRuntime, valueOf, widgetOfType } from './test-support'

function blueprintOf(id: string) {
	const preset = tripBudgetPresets.find(candidate => candidate.id === id)!
	return tripBudgetSystem.createBlueprint(JSON.parse(preset.sourceText))
}

describe('preset list', () => {
	it('has the default first and a stable set of ids', () => {
		expect(tripBudgetPresets.map(preset => preset.id))
			.toEqual(['trip-default', 'trip-invalid', 'trip-unsupported-currency'])
		expect(defaultTripBudgetPreset)
			.toBe(tripBudgetPresets[0])
	})

	it('has no cycle preset: nothing in a trip reads the settlement', () => {
		expect(tripBudgetPresets.some(preset => /cycle/i.test(preset.id)))
			.toBe(false)
	})
})

describe('trip-default', () => {
	it('is a valid Blueprint with no diagnostics and only recognized widget keys', () => {
		const blueprint = blueprintOf('trip-default')
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
		expect(blueprint.sourceJsonCompatible)
			.toBe(true)
	})

	it('has four people, five expenses in three currencies and both split modes', () => {
		const document = JSON.parse(defaultTripBudgetPreset.sourceText)
		expect(document.slots.people.map((person: { id: string }) => person.id))
			.toEqual(['ana', 'ben', 'chloe', 'dev'])
		const expenses = document.slots.expenses
		expect(expenses.map((expense: { id: string }) => expense.id))
			.toEqual(['hotel', 'dinner', 'museum', 'taxi', 'market'])
		expect(new Set(expenses.map((expense: { config: { currency: string } }) => expense.config.currency)))
			.toEqual(new Set(['EUR', 'USD', 'GBP']))
		expect(new Set(expenses.map((expense: { config: { split: { mode: string } } }) => expense.config.split.mode)))
			.toEqual(new Set(['equal', 'percent']))
	})

	it('settles to the documented balances and payments', () => {
		const { runtime } = createTripRuntime()
		const settlement = widgetOfType(runtime, 'settlement', 'Settlement')
		expect(valueOf(settlement.properties.total.get()))
			.toBe(65174)
		expect(valueOf(settlement.properties.balances.get()))
			.toEqual([
				{ id: 'ana', name: 'Ana', cents: 23744 },
				{ id: 'ben', name: 'Ben', cents: -6199 },
				{ id: 'chloe', name: 'Chloe', cents: -11922 },
				{ id: 'dev', name: 'Dev', cents: -5623 },
			])
		expect(valueOf(settlement.properties.transfers.get()).transfers.map(({ from, to, cents }) => ({ from, to, cents })))
			.toEqual([
				{ from: 'chloe', to: 'ana', cents: 11922 },
				{ from: 'ben', to: 'ana', cents: 6199 },
				{ from: 'dev', to: 'ana', cents: 5623 },
			])
	})
})

describe('trip-invalid', () => {
	it('has exactly the four intended diagnostics, one per widget, none hiding another', () => {
		const blueprint = blueprintOf('trip-invalid')
		expect(blueprint.status)
			.toBe('invalid')
		const found = blueprint.diagnostics.map(diagnostic => ({
			code: diagnostic.code,
			widget: diagnostic.location.type === 'widget' ? diagnostic.location.node.id : null,
			reason: 'reason' in diagnostic ? diagnostic.reason : undefined,
			path: 'path' in diagnostic ? diagnostic.path : undefined,
		}))
		expect(found)
			.toEqual([
				{ code: 'invalid-widget-config', widget: 'currency', reason: 'invalid-rate', path: ['rates', 'USD'] },
				{ code: 'invalid-widget-config', widget: 'taxi', reason: 'percent-total', path: ['split', 'percents'] },
				{ code: 'invalid-widget-config', widget: 'market', reason: 'out-of-range', path: ['amount'] },
				{ code: 'invalid-widget-structure', widget: 'dinner', reason: 'unknown-person', path: undefined },
			])
	})

	it('differs from the default only by the four mistakes', () => {
		const clean = JSON.parse(defaultTripBudgetPreset.sourceText)
		const broken = JSON.parse(tripBudgetPresets[1]!.sourceText)
		expect(broken.slots.expenses.find((expense: { id: string }) => expense.id === 'museum'))
			.toEqual(clean.slots.expenses.find((expense: { id: string }) => expense.id === 'museum'))
		expect(broken.slots.people)
			.toEqual(clean.slots.people)
	})
})

describe('trip-unsupported-currency', () => {
	it('compiles to a valid Blueprint', () => {
		const blueprint = blueprintOf('trip-unsupported-currency')
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('fails when it runs: the conversion Method fails and every Property that depends on it fails with it', () => {
		const blueprint = blueprintOf('trip-unsupported-currency')
		if (blueprint.status !== 'valid')
			throw new Error('Expected a valid Blueprint')
		const runtime = blueprint.createRuntime()
		const museum = widgetOfType(runtime, 'museum', 'Expense')
		const chain = [
			museum.properties.amountBase.get(),
			museum.properties.shares.get(),
			widgetOfType(runtime, 'ana', 'Person').properties.balance.get(),
			widgetOfType(runtime, 'settlement', 'Settlement').properties.transfers.get(),
		]
		expect(chain.map(result => result.ok))
			.toEqual([false, false, false, false])
		// An expense that does not use the missing currency is unaffected.
		expect(widgetOfType(runtime, 'hotel', 'Expense').properties.amountBase.get().ok)
			.toBe(true)
	})
})
