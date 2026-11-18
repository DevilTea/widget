/**
 * The quote plugins against a REAL `@deviltea/widget-core` Runtime built from the actual `quote-default` preset.
 * Every expected number is derived by hand from the preset's own figures (not from the code under test):
 *
 *   flyers 500 x 9 + cards 250 x 14 + poster 2 x 1450 = 4500 + 3500 + 2900 = 10900 (the subtotal)
 *   total quantity 752 reaches the 300 tier: 5% of 10900 = 545 off
 *   taxable 10900 - 545 = 10355, tax 21% = 2174.55, rounded half-up to 2175
 *   total 10355 + 2175 = 12530
 */

import { describe, expect, it } from 'vitest'
import { quoteSystem } from '../system'
import { createQuoteRuntime, createRuntimeFor, parsedPreset, valueOf, widgetOf, widgetOfType } from '../test-support'

function setup(document?: unknown) {
	const { runtime } = document === undefined ? createQuoteRuntime() : createRuntimeFor(document)
	return {
		runtime,
		quote: widgetOfType(runtime, 'quote', 'Quote'),
		flyers: widgetOfType(runtime, 'flyers', 'Item'),
		cards: widgetOfType(runtime, 'cards', 'Item'),
		poster: widgetOfType(runtime, 'poster', 'Item'),
		volume: widgetOfType(runtime, 'volume', 'VolumeDiscount'),
		rush: widgetOfType(runtime, 'rush', 'RushSurcharge'),
		delivery: widgetOfType(runtime, 'delivery', 'Delivery'),
		tax: widgetOfType(runtime, 'tax', 'SalesTax'),
	}
}

function adjustmentOf(result: { adjustments: readonly { id: string, cents: number }[] }, id: string): number {
	return result.adjustments.find(adjustment => adjustment.id === id)!.cents
}

describe('the default quote', () => {
	it('prices the three lines, applies the volume tier and the tax, and adds up to 12530', () => {
		const { quote } = setup()
		const result = valueOf(quote.properties.quote.get())
		expect(result.currency)
			.toBe('EUR')
		expect(result.lines.map(line => ({ id: line.id, quantity: line.quantity, paper: line.paper, unitCents: line.unitCents, cents: line.cents })))
			.toEqual([
				{ id: 'flyers', quantity: 500, paper: 'standard', unitCents: 9, cents: 4500 },
				{ id: 'cards', quantity: 250, paper: 'standard', unitCents: 14, cents: 3500 },
				{ id: 'poster', quantity: 2, paper: 'matt', unitCents: 1450, cents: 2900 },
			])
		expect(result.subtotalCents)
			.toBe(10900)
		expect(result.adjustments.map(({ id, type, kind, applied, percent, cents, reason }) => ({ id, type, kind, applied, percent, cents, reason })))
			.toEqual([
				{ id: 'volume', type: 'VolumeDiscount', kind: 'discount', applied: true, percent: 5, cents: -545, reason: null },
				{ id: 'rush', type: 'RushSurcharge', kind: 'surcharge', applied: false, percent: null, cents: 0, reason: null },
				{ id: 'delivery', type: 'Delivery', kind: 'fee', applied: false, percent: null, cents: 0, reason: null },
				{ id: 'tax', type: 'SalesTax', kind: 'tax', applied: true, percent: 21, cents: 2175, reason: null },
			])
		expect(result.taxableCents)
			.toBe(10355)
		expect(result.totalCents)
			.toBe(12530)
	})

	it('is a valid Blueprint with no Property loop although the root reads its children and they read the root', () => {
		const blueprint = quoteSystem.createBlueprint(parsedPreset())
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('collects every answer by widget id and State name: the request half of a JSON-in call', () => {
		const { quote } = setup()
		expect(valueOf(quote.properties.answers.get()))
			.toEqual({
				flyers: { quantity: 500, paper: 'standard' },
				cards: { quantity: 250, paper: 'standard' },
				poster: { quantity: 2, paper: 'matt' },
				rush: { enabled: false },
				delivery: { method: 'pickup' },
			})
	})
})

describe('the rules', () => {
	it('adds the rush surcharge on the subtotal, before the tax: 25% of 10900 = 2725', () => {
		const { quote, rush } = setup()
		expect(rush.state.enabled.set(true).ok)
			.toBe(true)
		const result = valueOr(quote)
		expect(adjustmentOf(result, 'rush'))
			.toBe(2725)
		// taxable 10900 - 545 + 2725 = 13080; tax 21% = 2746.8 -> 2747; total 15827
		expect(result.taxableCents)
			.toBe(13080)
		expect(adjustmentOf(result, 'tax'))
			.toBe(2747)
		expect(result.totalCents)
			.toBe(15827)
	})

	it('adds the courier fee (900) and taxes it: delivery is part of the taxable amount', () => {
		const { quote, delivery } = setup()
		expect(delivery.state.method.set('courier').ok)
			.toBe(true)
		const result = valueOr(quote)
		expect(adjustmentOf(result, 'delivery'))
			.toBe(900)
		// taxable 10900 - 545 + 900 = 11255; tax 21% = 2363.55 -> 2364; total 13619
		expect(result.taxableCents)
			.toBe(11255)
		expect(result.totalCents)
			.toBe(13619)
	})

	it('waives the courier fee from a subtotal of 200.00 on and says why', () => {
		const { quote, delivery, poster } = setup()
		delivery.state.method.set('courier')
		// 14 posters: 4500 + 3500 + 14 x 1450 (20300) = 28300 >= 20000
		poster.state.quantity.set(14)
		const result = valueOr(quote)
		expect(result.subtotalCents)
			.toBe(28300)
		expect(result.adjustments.find(adjustment => adjustment.id === 'delivery'))
			.toMatchObject({ applied: true, cents: 0, reason: 'free-over-threshold' })
		// 764 pieces: 5% of 28300 = 1415 off; taxable 26885; tax 21% = 5645.85 -> 5646; total 32531
		expect(adjustmentOf(result, 'volume'))
			.toBe(-1415)
		expect(result.totalCents)
			.toBe(32531)
	})

	it('picks the tier by the total quantity of all items, at the boundaries 299 / 300 / 1000', () => {
		const { quote, flyers } = setup()
		// cards 250 + poster 2 = 252: flyers 47 -> 299 (no tier above the 0% one), 48 -> 300 (5%), 748 -> 1000 (10%)
		flyers.state.quantity.set(47)
		expect(valueOr(quote).adjustments[0])
			.toMatchObject({ applied: false, percent: null, cents: 0 })
		flyers.state.quantity.set(48)
		expect(valueOr(quote).adjustments[0])
			.toMatchObject({ applied: true, percent: 5 })
		flyers.state.quantity.set(748)
		// subtotal 748 x 9 + 3500 + 2900 = 13132; 10% = 1313.2 -> 1313
		expect(valueOr(quote).adjustments[0])
			.toMatchObject({ applied: true, percent: 10, cents: -1313 })
	})

	it('prices a dearer paper: gloss flyers cost 12 each, so the flyers line is 6000 and the subtotal 12400', () => {
		const { quote, flyers } = setup()
		expect(flyers.state.paper.set('gloss').ok)
			.toBe(true)
		const result = valueOr(quote)
		expect(result.lines[0])
			.toMatchObject({ paper: 'gloss', unitCents: 12, cents: 6000 })
		expect(result.subtotalCents)
			.toBe(12400)
	})
})

describe('what the customer may write (a Standard Schema guard on State)', () => {
	it('refuses a quantity of 0, 2.5 or 100001 with the library\'s own message and keeps the old value', () => {
		const { flyers } = setup()
		for (const [candidate, message] of [
			[0, 'Invalid value: Expected >=1 but received 0'],
			[2.5, 'Invalid integer: Received 2.5'],
			[100001, 'Invalid value: Expected <=100000 but received 100001'],
		] as const) {
			const result = flyers.state.quantity.set(candidate)
			expect(result.ok, String(candidate))
				.toBe(false)
			if (!result.ok) {
				expect(result.failure.diagnostics.map(diagnostic => diagnostic.message), String(candidate))
					.toEqual([message])
			}
			expect(flyers.state.quantity.get(), String(candidate))
				.toBe(500)
		}
	})

	it('refuses a delivery method that is not offered', () => {
		const { delivery } = setup()
		const result = delivery.state.method.set('drone' as never)
		expect(result.ok)
			.toBe(false)
		expect(delivery.state.method.get())
			.toBe('pickup')
	})

	it('stores a paper the item does not offer and makes `line` and the quote fail with the item\'s own diagnostic', () => {
		const { quote, flyers } = setup()
		expect(flyers.state.paper.set('velvet').ok)
			.toBe(true)
		const line = flyers.properties.line.get()
		expect(line.ok)
			.toBe(false)
		if (!line.ok) {
			expect(line.failure.diagnostics.map(diagnostic => ({ message: diagnostic.message, reason: 'reason' in diagnostic ? diagnostic.reason : undefined })))
				.toEqual([{ message: 'There is no paper "velvet" on this item: choose one of standard, recycled, gloss.', reason: 'unknown-paper' }])
		}
		expect(quote.properties.quote.get().ok)
			.toBe(false)
	})

	it('restores every answer with resetState(), whole Runtime and one widget', () => {
		const { runtime, quote, flyers, rush, delivery } = setup()
		flyers.state.quantity.set(7)
		rush.state.enabled.set(true)
		delivery.state.method.set('courier')
		flyers.resetState()
		expect(flyers.state.quantity.get())
			.toBe(500)
		expect(rush.state.enabled.get())
			.toBe(true)
		runtime.resetState()
		expect(valueOf(quote.properties.answers.get()).rush)
			.toEqual({ enabled: false })
		expect(valueOf(quote.properties.quote.get()).totalCents)
			.toBe(12530)
	})

	it('starts from the answers the document authors: rush on, courier, 7 flyers', () => {
		const document = parsedPreset()
		widgetOf(document, 'rush').config.enabled = true
		widgetOf(document, 'delivery').config.method = 'courier'
		widgetOf(document, 'flyers').config.quantity = 7
		const { quote } = setup(document)
		expect(valueOf(quote.properties.answers.get()))
			.toMatchObject({ flyers: { quantity: 7 }, rush: { enabled: true }, delivery: { method: 'courier' } })
	})
})

describe('structure', () => {
	function structureReasons(document: unknown): string[] {
		const blueprint = quoteSystem.createBlueprint(document)
		return blueprint.diagnostics.map(diagnostic => (diagnostic as { reason?: string }).reason ?? diagnostic.code)
	}

	it('wants at least one item', () => {
		const document = parsedPreset()
		document.slots.items = []
		expect(structureReasons(document))
			.toEqual(['needs-an-item'])
	})

	it('allows each rule type once', () => {
		const document = parsedPreset()
		document.slots.rules.push({ id: 'tax-2', type: 'SalesTax', config: { label: { en: 'Again' }, percent: 5 } })
		expect(structureReasons(document))
			.toEqual(['duplicate-rule-type'])
	})

	it('keeps an Item out of the rules slot and a rule out of the items slot', () => {
		const document = parsedPreset()
		document.slots.rules.push({ id: 'misplaced', type: 'Item', config: { title: { en: 'X' }, unitCents: 1, papers: { a: { label: { en: 'A' }, extraCents: 0 } } } })
		document.slots.items.push(document.slots.rules[0])
		const reasons = structureReasons(document)
		expect(reasons)
			.toContain('not-a-rule')
		expect(reasons)
			.toContain('not-an-item')
	})

	it('does not let a rule be the root of a document', () => {
		const blueprint = quoteSystem.createBlueprint({ id: 'tax', type: 'SalesTax', config: { label: { en: 'Tax' }, percent: 5 } })
		expect(blueprint.diagnostics.map(diagnostic => (diagnostic as { reason?: string }).reason))
			.toContain('outside-quote')
	})
})

function valueOr(quote: { properties: { quote: { get: () => { ok: true, value: any } | { ok: false, failure: unknown } } } }) {
	return valueOf(quote.properties.quote.get()) as {
		readonly subtotalCents: number
		readonly taxableCents: number
		readonly totalCents: number
		readonly lines: readonly { id: string, quantity: number, paper: string, unitCents: number, cents: number }[]
		readonly adjustments: readonly { id: string, applied: boolean, percent: number | null, cents: number, reason: string | null }[]
	}
}
