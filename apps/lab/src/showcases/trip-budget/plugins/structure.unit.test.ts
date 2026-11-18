/**
 * Where each widget may sit, and which people an expense may name: located `invalid-widget-structure`
 * diagnostics with a machine-readable `reason`, built from the default preset with one change each.
 */

import { describe, expect, it } from 'vitest'
import { tripBudgetSystem } from '../system'
import { defaultDocument, expenseOf } from '../test-support'

function reasonsOf(document: unknown): { code: string, reason: string | undefined, widget: string | null }[] {
	const blueprint = tripBudgetSystem.createBlueprint(document)
	return blueprint.diagnostics.map(diagnostic => ({
		code: diagnostic.code,
		reason: 'reason' in diagnostic ? diagnostic.reason : undefined,
		widget: diagnostic.location.type === 'widget' ? diagnostic.location.node.id ?? null : null,
	}))
}

function reasons(document: unknown): (string | undefined)[] {
	return reasonsOf(document)
		.map(entry => entry.reason)
}

describe('the default document', () => {
	it('has no diagnostic', () => {
		expect(reasonsOf(defaultDocument()))
			.toEqual([])
	})
})

describe('the Trip slots', () => {
	it('needs exactly one Currency in settings', () => {
		const none = defaultDocument()
		none.slots.settings = []
		expect(reasons(none))
			.toEqual(['settings-needs-one-currency'])

		const two = defaultDocument()
		two.slots.settings.push({ ...two.slots.settings[0], id: 'currency-2' })
		expect(reasons(two))
			.toEqual(['settings-needs-one-currency'])
	})

	it('takes only a Currency in settings, Persons in people, Expenses in expenses and one Settlement in summary', () => {
		const wrongSettings = defaultDocument()
		wrongSettings.slots.settings = [{ id: 'who', type: 'Person', config: { name: 'X' } }]
		expect(reasons(wrongSettings))
			.toContain('not-a-currency')

		const wrongPeople = defaultDocument()
		wrongPeople.slots.people.push({ id: 'summary-2', type: 'Settlement' })
		expect(reasons(wrongPeople))
			.toContain('not-a-person')

		const wrongExpenses = defaultDocument()
		wrongExpenses.slots.expenses.push({ id: 'x', type: 'Person', config: { name: 'X' } })
		expect(reasons(wrongExpenses))
			.toContain('not-an-expense')

		const twoSettlements = defaultDocument()
		twoSettlements.slots.summary.push({ id: 'settlement-2', type: 'Settlement' })
		expect(reasons(twoSettlements))
			.toContain('too-many-settlements')

		const wrongSummary = defaultDocument()
		wrongSummary.slots.summary = [{ id: 'x', type: 'Person', config: { name: 'X' } }]
		expect(reasons(wrongSummary))
			.toContain('not-a-settlement')
	})

	it('allows a trip with no settlement at all', () => {
		const none = defaultDocument()
		none.slots.summary = []
		expect(reasonsOf(none))
			.toEqual([])
	})
})

describe('placement', () => {
	it('requires a Trip as the root, and every other widget directly under one', () => {
		const nested = defaultDocument()
		nested.slots.people.push({ id: 'inner', type: 'Trip', config: { title: { en: 'Inner' } } })
		expect(reasons(nested))
			.toContain('trip-not-root')

		expect(reasons({ id: 'ana', type: 'Person', config: { name: 'Ana' } }))
			.toContain('outside-trip')
		expect(reasons({ id: 'settlement', type: 'Settlement' }))
			.toContain('outside-trip')
		expect(reasons({ id: 'currency', type: 'Currency', config: { base: 'EUR', rates: {} } }))
			.toContain('outside-trip')
	})

	it('keeps person ids boring, because they are keys of shares and percents', () => {
		const document = defaultDocument()
		document.slots.people[0].id = 'Ana'
		expect(reasonsOf(document))
			.toContainEqual({ code: 'invalid-widget-structure', reason: 'person-id-format', widget: 'Ana' })
	})
})

describe('an expense names only people of the trip', () => {
	it('reports a payer who is not a Person', () => {
		const document = defaultDocument()
		expenseOf(document, 'hotel').config.paidBy = 'zoe'
		expect(reasonsOf(document))
			.toEqual([{ code: 'invalid-widget-structure', reason: 'unknown-person', widget: 'hotel' }])
	})

	it('reports a participant, in an equal split and in a percent split', () => {
		const equal = defaultDocument()
		expenseOf(equal, 'hotel').config.split.among = ['ana', 'zoe']
		expect(reasonsOf(equal))
			.toEqual([{ code: 'invalid-widget-structure', reason: 'unknown-person', widget: 'hotel' }])

		const percent = defaultDocument()
		expenseOf(percent, 'taxi').config.split.percents = { ana: 50, zoe: 50 }
		expect(reasonsOf(percent))
			.toEqual([{ code: 'invalid-widget-structure', reason: 'unknown-person', widget: 'taxi' }])
	})

	it('does not accept a widget that is not a Person, even with that id', () => {
		const document = defaultDocument()
		expenseOf(document, 'hotel').config.paidBy = 'market'
		expect(reasons(document))
			.toEqual(['unknown-person'])
	})

	it('does not pile a structure diagnostic on top of the config diagnostic of the same expense', () => {
		const document = defaultDocument()
		const hotel = expenseOf(document, 'hotel')
		hotel.config.amount = -1
		hotel.config.paidBy = 'zoe'
		expect(reasonsOf(document))
			.toEqual([{ code: 'invalid-widget-config', reason: 'out-of-range', widget: 'hotel' }])
	})
})
