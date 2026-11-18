/**
 * The Property chain across widgets, against a real Runtime of `trip-default`:
 *
 *   `Currency.convert` -> `Expense.amountBase` -> `Expense.shares` -> `Person.owed`/`Person.paid`
 *   -> `Person.balance` -> `Settlement.balances` -> `Settlement.transfers`
 *
 * What a viewer changes is State on one widget; every figure downstream follows through declared
 * dependencies, and the chain is visible as declared dependencies in the Blueprint inspection (what Relations
 * and the Graph show).
 */

import type { BlueprintInspection } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { createTripRuntime, valueOf, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createTripRuntime()
	return {
		runtime,
		settlement: widgetOfType(runtime, 'settlement', 'Settlement'),
		currency: widgetOfType(runtime, 'currency', 'Currency'),
		hotel: widgetOfType(runtime, 'hotel', 'Expense'),
		dinner: widgetOfType(runtime, 'dinner', 'Expense'),
		museum: widgetOfType(runtime, 'museum', 'Expense'),
		taxi: widgetOfType(runtime, 'taxi', 'Expense'),
		market: widgetOfType(runtime, 'market', 'Expense'),
		ana: widgetOfType(runtime, 'ana', 'Person'),
		ben: widgetOfType(runtime, 'ben', 'Person'),
		chloe: widgetOfType(runtime, 'chloe', 'Person'),
		dev: widgetOfType(runtime, 'dev', 'Person'),
	}
}

/** The declared dependencies of one Property or Method, as `widget.member` strings. */
function declared(inspection: BlueprintInspection, widgetId: string, kind: 'property' | 'method', name: string): string[] {
	const node = inspection.nodes.find(candidate => candidate.resolved && candidate.node.id === widgetId)
	if (node === undefined || !node.resolved)
		throw new Error(`No widget ${widgetId}`)
	const member = (kind === 'property' ? node.properties : node.methods).find(candidate => candidate.name === name)
	if (member === undefined)
		throw new Error(`No ${kind} ${widgetId}.${name}`)
	return member.dependencies.flatMap((dependency) => {
		if (dependency.status !== 'resolved')
			return []
		const target = inspection.getNode(dependency.target.nodeId)
		const id = target?.resolved === true ? target.node.id : '?'
		return [`${id}.${dependency.target.member.name}`]
	})
		.sort()
}

describe('the chain is declared, so Relations and the Graph can show it', () => {
	it('links each stage to the one before through dependencies on other widgets', () => {
		const { runtime } = setup()
		const inspection = inspectBlueprint(runtime.blueprint)

		// The expense line starts the chain: its amount is State, converted by a read-only Method of another widget.
		expect(declared(inspection, 'museum', 'property', 'amountBase'))
			.toEqual(['currency.convert', 'museum.amount', 'museum.currency'])
		expect(declared(inspection, 'museum', 'property', 'shares'))
			.toEqual(['museum.amountBase', 'museum.counted', 'museum.participants'])
		// A person reads every expense, then their own two Properties.
		expect(declared(inspection, 'ben', 'property', 'owed'))
			.toEqual(['dinner.shares', 'hotel.shares', 'market.shares', 'museum.shares', 'taxi.shares'])
		expect(declared(inspection, 'ben', 'property', 'balance'))
			.toEqual(['ben.owed', 'ben.paid'])
		// The settlement reads every person, and the Currency's second read-only Method.
		expect(declared(inspection, 'settlement', 'property', 'balances'))
			.toEqual(['ana.balance', 'ana.name', 'ben.balance', 'ben.name', 'chloe.balance', 'chloe.name', 'dev.balance', 'dev.name'])
		expect(declared(inspection, 'settlement', 'property', 'transfers'))
			.toEqual(['currency.roundTransfer', 'settlement.balances'])
	})

	it('has no cycle: nothing reads the settlement', () => {
		const { runtime } = setup()
		expect(inspectBlueprint(runtime.blueprint).invalidCycles)
			.toEqual([])
	})
})

describe('one State write reaches the settlement', () => {
	it('moves every stage when the hotel amount changes, and the balances still add up to zero', () => {
		const { hotel, ana, ben, settlement } = setup()
		expect(hotel.state.amount.set(520).ok)
			.toBe(true)

		expect(valueOf(hotel.properties.amountBase.get()))
			.toBe(52000)
		expect(valueOf(hotel.properties.shares.get()))
			.toEqual({ ana: 13000, ben: 13000, chloe: 13000, dev: 13000 })
		// Ana paid the hotel and owed a quarter more of it; Ben owed a quarter more.
		expect(valueOf(ana.properties.paid.get()))
			.toBe(52000)
		expect(valueOf(ben.properties.owed.get()))
			.toBe(15849 + 2500)
		expect(valueOf(settlement.properties.total.get()))
			.toBe(65174 + 10000)
		const balances = valueOf(settlement.properties.balances.get())
		expect(balances.reduce((sum, balance) => sum + balance.cents, 0))
			.toBe(0)
		expect(balances.find(balance => balance.id === 'ana')?.cents)
			.toBe(23744 + 7500)
	})

	it('converts a currency change through the Currency widget', () => {
		const { museum, settlement } = setup()
		museum.state.currency.set('GBP')
		expect(valueOf(museum.properties.amountBase.get()))
			.toBe(7488)
		expect(valueOf(settlement.properties.total.get()))
			.toBe(65174 - 5888 + 7488)
		museum.state.currency.set('EUR')
		expect(valueOf(museum.properties.amountBase.get()))
			.toBe(6400)
	})

	it('shares among whoever is ticked, in roster order, with the leftover cent to the first', () => {
		const { dinner } = setup()
		dinner.state.among.set(['chloe', 'ben'])
		expect(valueOf(dinner.properties.participants.get()))
			.toEqual(['ben', 'chloe'])
		expect(valueOf(dinner.properties.shares.get()))
			.toEqual({ ben: 4825, chloe: 4825 })
		dinner.state.among.set(['dev', 'ana', 'ben'])
		expect(valueOf(dinner.properties.shares.get()))
			.toEqual({ ana: 3217, ben: 3217, dev: 3216 })
	})

	it('follows who paid', () => {
		const { dinner, ben, chloe } = setup()
		expect(valueOf(ben.properties.paid.get()))
			.toBe(9650)
		dinner.state.paidBy.set('chloe')
		expect(valueOf(ben.properties.paid.get()))
			.toBe(0)
		expect(valueOf(chloe.properties.paid.get()))
			.toBe(5888 + 9650)
	})

	it('uses the authored percentages for a percent expense, whatever `among` holds', () => {
		const { taxi } = setup()
		expect(valueOf(taxi.properties.participants.get()))
			.toEqual(['ana', 'ben', 'chloe'])
		expect(valueOf(taxi.properties.shares.get()))
			.toEqual({ ana: 1778, ben: 1334, chloe: 1334 })
		taxi.state.among.set(['dev'])
		expect(valueOf(taxi.properties.shares.get()))
			.toEqual({ ana: 1778, ben: 1334, chloe: 1334 })
	})

	it('notifies a subscriber of the settlement once for one write, with the new transfers', () => {
		const { hotel, settlement } = setup()
		const seen: number[] = []
		const stop = settlement.properties.transfers.subscribe((result) => {
			if (result.ok)
				seen.push(result.value.transfers.length)
		})
		hotel.state.amount.set(0)
		stop()
		expect(seen)
			.toEqual([3])
		expect(valueOf(settlement.properties.transfers.get()).transfers.map(transfer => transfer.cents))
			.not
			.toEqual([11922, 6199, 5623])
	})

	it('is settled, with nothing to pay, when everyone shares what they paid', () => {
		const { runtime, settlement } = setup()
		for (const id of ['hotel', 'dinner', 'museum', 'taxi', 'market'])
			widgetOfType(runtime, id, 'Expense').state.amount.set(0)
		expect(valueOf(settlement.properties.total.get()))
			.toBe(0)
		expect(valueOf(settlement.properties.transfers.get()))
			.toEqual({ transfers: [], roundingGapCents: 0 })
	})
})

describe('an expense that cannot be counted', () => {
	it.each([
		['a negative amount', (hotel: ReturnType<typeof setup>['hotel']) => hotel.state.amount.set(-5), 'amount-negative'],
		['no amount', (hotel: ReturnType<typeof setup>['hotel']) => hotel.state.amount.set(null), 'amount-missing'],
		['nobody sharing', (hotel: ReturnType<typeof setup>['hotel']) => hotel.state.among.set([]), 'nobody-shares'],
		['nobody who paid', (hotel: ReturnType<typeof setup>['hotel']) => hotel.state.paidBy.set(null), 'no-payer'],
	] as const)('is stored, reported and left out of the settlement: %s', (_label, write, code) => {
		const { hotel, settlement, ana } = setup()
		expect(write(hotel).ok)
			.toBe(true)

		expect(valueOf(hotel.properties.problem.get()))
			.toBe(code)
		expect(valueOf(hotel.properties.counted.get()))
			.toBe(false)
		expect(valueOf(hotel.properties.errors.get())
			.map(error => error.code))
			.toEqual([code])
		expect(valueOf(hotel.properties.shares.get()))
			.toEqual({})
		expect(valueOf(settlement.properties.total.get()))
			.toBe(65174 - 42000)
		expect(valueOf(ana.properties.paid.get()))
			.toBe(0)
	})

	it('is counted again as soon as the input is fixed', () => {
		const { hotel, settlement } = setup()
		hotel.state.amount.set(-5)
		hotel.state.amount.set(420)
		expect(valueOf(hotel.properties.errors.get()))
			.toEqual([])
		expect(valueOf(settlement.properties.total.get()))
			.toBe(65174)
	})

	it('still accepts zero as an amount', () => {
		const { hotel } = setup()
		hotel.state.amount.set(0)
		expect(valueOf(hotel.properties.counted.get()))
			.toBe(true)
	})

	it('refuses a State value that is not a number, a currency code or a person id', () => {
		const { hotel } = setup()
		expect(hotel.state.amount.set(Number.NaN).ok)
			.toBe(false)
		expect(hotel.state.currency.set('euro').ok)
			.toBe(false)
		expect(hotel.state.paidBy.set('Ana').ok)
			.toBe(false)
		expect(hotel.state.among.set(['ana', 'ana']).ok)
			.toBe(false)
		expect(hotel.state.amount.get())
			.toBe(420)
	})
})

describe('the interface language', () => {
	it('reaches every widget through the root State', () => {
		const { runtime, hotel, ana, settlement, currency } = setup()
		const trip = widgetOfType(runtime, 'lisbon', 'Trip')
		expect(valueOf(trip.properties.title.get()))
			.toBe('Lisbon weekend')
		expect(valueOf(hotel.properties.title.get()))
			.toBe('Hotel, three nights')
		expect(valueOf(ana.properties.view.get()))
			.toEqual({ language: 'en', base: 'EUR' })

		expect(trip.state.language.set('zh-TW').ok)
			.toBe(true)
		expect(valueOf(trip.properties.title.get()))
			.toBe('里斯本週末小旅行')
		expect(valueOf(hotel.properties.title.get()))
			.toBe('旅館三晚')
		expect(valueOf(ana.properties.view.get()))
			.toMatchObject({ language: 'zh-TW', base: 'EUR' })
		expect(valueOf(settlement.properties.view.get()))
			.toEqual({ language: 'zh-TW', base: 'EUR' })
		expect(valueOf(currency.properties.view.get()))
			.toEqual({ language: 'zh-TW', base: 'EUR' })
		hotel.state.amount.set(-1)
		expect(valueOf(hotel.properties.errors.get())[0]?.message)
			.toBe('金額不能是負數。')
	})

	it('accepts only a language the trip has', () => {
		const { runtime } = setup()
		const trip = widgetOfType(runtime, 'lisbon', 'Trip')
		expect(trip.state.language.set('fr').ok)
			.toBe(false)
		expect(trip.state.language.get())
			.toBe('en')
	})
})

describe('breakdown and ledger', () => {
	it('explains the conversion, each share and the leftover cents', () => {
		const { museum, hotel } = setup()
		expect(valueOf(museum.properties.breakdown.get()))
			.toEqual({
				conversion: { amount: 64, currency: 'USD', rate: 0.92, baseCents: 5888 },
				totalCents: 5888,
				lines: [
					{ id: 'ana', name: 'Ana', cents: 1963, percent: null },
					{ id: 'chloe', name: 'Chloe', cents: 1963, percent: null },
					{ id: 'dev', name: 'Dev', cents: 1962, percent: null },
				],
				remainderCents: 2,
			})
		expect(valueOf(hotel.properties.breakdown.get()).conversion)
			.toBeNull()
		expect(valueOf(hotel.properties.breakdown.get()).remainderCents)
			.toBe(0)
	})

	it('shows the authored percentages of a percent split', () => {
		const { taxi } = setup()
		expect(valueOf(taxi.properties.breakdown.get()).lines.map(line => line.percent))
			.toEqual([40, 30, 30])
	})

	it('lists what a person paid and their share per expense, skipping expenses that do not involve them', () => {
		const { ben, dev } = setup()
		const entries = valueOf(ben.properties.ledger.get()).entries
		expect(entries.map(entry => [entry.expense, entry.paidCents, entry.shareCents]))
			.toEqual([
				['hotel', 0, 10500],
				['dinner', 9650, 3217],
				['taxi', 0, 1334],
				['market', 0, 798],
			])
		// Dev is not in the dinner.
		expect(valueOf(dev.properties.ledger.get()).entries.map(entry => entry.expense))
			.toEqual(['hotel', 'museum', 'taxi', 'market'])
	})

	it('leaves out an expense that is not counted', () => {
		const { hotel, ben } = setup()
		hotel.state.amount.set(-1)
		expect(valueOf(ben.properties.ledger.get()).entries.map(entry => entry.expense))
			.not
			.toContain('hotel')
	})
})
