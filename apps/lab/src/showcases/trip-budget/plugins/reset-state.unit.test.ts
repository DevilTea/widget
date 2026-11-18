/**
 * `resetState()` on a widget and on the Runtime: State goes back to its initialization outcome (the authored
 * values of the document), everything derived from it recomputes, and nothing else is touched.
 */

import { describe, expect, it, vi } from 'vitest'
import { defaultTripBudgetPreset, tripBudgetPresets } from '../presets'
import { createTripRuntime, valueOf, widgetOfType } from '../test-support'

function setup(sourceText: string = defaultTripBudgetPreset.sourceText) {
	const { runtime } = createTripRuntime(sourceText)
	return {
		runtime,
		trip: widgetOfType(runtime, 'lisbon', 'Trip'),
		currency: widgetOfType(runtime, 'currency', 'Currency'),
		hotel: widgetOfType(runtime, 'hotel', 'Expense'),
		dinner: widgetOfType(runtime, 'dinner', 'Expense'),
		settlement: widgetOfType(runtime, 'settlement', 'Settlement'),
	}
}

function editHotel({ hotel }: ReturnType<typeof setup>): void {
	hotel.state.amount.set(999)
	hotel.state.currency.set('GBP')
	hotel.state.paidBy.set('dev')
	hotel.state.among.set(['ana'])
}

describe('widget.resetState()', () => {
	it('puts every State member of that widget back to the authored value', () => {
		const s = setup()
		editHotel(s)
		expect(s.hotel.state.amount.get())
			.toBe(999)

		s.hotel.resetState()

		expect(s.hotel.state.amount.get())
			.toBe(420)
		expect(s.hotel.state.currency.get())
			.toBe('EUR')
		expect(s.hotel.state.paidBy.get())
			.toBe('ana')
		expect(s.hotel.state.among.get())
			.toEqual(['ana', 'ben', 'chloe', 'dev'])
	})

	it('leaves other widgets alone and lets the settlement follow', () => {
		const s = setup()
		const before = valueOf(s.settlement.properties.transfers.get())
		editHotel(s)
		s.dinner.state.amount.set(10)
		expect(valueOf(s.settlement.properties.transfers.get()))
			.not
			.toEqual(before)

		s.hotel.resetState()

		expect(s.dinner.state.amount.get())
			.toBe(10)
		expect(valueOf(s.settlement.properties.total.get()))
			.toBe(65174 - 9650 + 1000)
		s.dinner.resetState()
		expect(valueOf(s.settlement.properties.transfers.get()))
			.toEqual(before)
	})

	it('notifies only the State that actually changed', () => {
		const s = setup()
		const amount = vi.fn()
		const currency = vi.fn()
		s.hotel.state.amount.subscribe(amount)
		s.hotel.state.currency.subscribe(currency)
		s.hotel.state.amount.set(500)
		amount.mockClear()

		s.hotel.resetState()

		expect(amount)
			.toHaveBeenCalledTimes(1)
		expect(amount)
			.toHaveBeenCalledWith(420)
		// The currency never changed, so resetting does not notify it.
		expect(currency)
			.not
			.toHaveBeenCalled()
	})

	it('restores the Currency step and the language the same way', () => {
		const s = setup()
		s.currency.state.roundStep.set(500)
		s.trip.state.language.set('zh-TW')
		s.currency.resetState()
		expect(s.currency.state.roundStep.get())
			.toBe(1)
		expect(s.trip.state.language.get())
			.toBe('zh-TW')
		s.trip.resetState()
		expect(s.trip.state.language.get())
			.toBe('en')
	})
})

describe('runtime.resetState()', () => {
	it('starts every widget over, including the language and the rounding step', () => {
		const s = setup()
		editHotel(s)
		s.dinner.state.amount.set(1)
		s.currency.state.roundStep.set(100)
		s.trip.state.language.set('zh-TW')

		s.runtime.resetState()

		expect(s.hotel.state.amount.get())
			.toBe(420)
		expect(s.dinner.state.amount.get())
			.toBe(96.5)
		expect(s.currency.state.roundStep.get())
			.toBe(1)
		expect(s.trip.state.language.get())
			.toBe('en')
		expect(valueOf(s.settlement.properties.total.get()))
			.toBe(65174)
	})

	it('restores State only: Property and Method diagnostics are not cleared', () => {
		const unsupported = tripBudgetPresets.find(preset => preset.id === 'trip-unsupported-currency')!
		const s = setup(unsupported.sourceText)
		expect(s.settlement.properties.transfers.get().ok)
			.toBe(false)
		s.currency.methods.convert(1, 'CHF')
		const methodDiagnostics = s.currency.methods.convert.getDiagnostics()
		const propertyDiagnostics = widgetOfType(s.runtime, 'museum', 'Expense').properties.amountBase.getDiagnostics()
		expect(methodDiagnostics.length)
			.toBeGreaterThan(0)
		expect(propertyDiagnostics.length)
			.toBeGreaterThan(0)

		s.runtime.resetState()

		expect(s.currency.methods.convert.getDiagnostics())
			.toEqual(methodDiagnostics)
		// The museum is still in a currency without a rate (that is what the document authored), so it still fails.
		expect(s.settlement.properties.transfers.get().ok)
			.toBe(false)
	})

	it('brings a Runtime back to what a fresh one would compute', () => {
		const s = setup()
		editHotel(s)
		s.runtime.resetState()
		const fresh = createTripRuntime().runtime
		expect(valueOf(s.settlement.properties.transfers.get()))
			.toEqual(valueOf(widgetOfType(fresh, 'settlement', 'Settlement').properties.transfers.get()))
	})
})
