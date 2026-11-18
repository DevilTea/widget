/**
 * The pure money arithmetic and texts of the trip: splitting never loses or invents a cent, settling clears
 * every balance, and both languages cover every built-in text.
 */

import { describe, expect, it } from 'vitest'
import { equalLeftover, expenseProblemCode, expenseProblemText, fill, formatMoney, localize, percentLeftover, roundToStep, settle, splitByPercent, splitEqually, toBaseCents, tripText } from './domain'

const sum = (values: Iterable<number>): number => [...values].reduce((total, value) => total + value, 0)

describe('splitEqually', () => {
	it('shares a total that divides evenly', () => {
		expect(splitEqually(42000, ['ana', 'ben', 'chloe', 'dev']))
			.toEqual({ ana: 10500, ben: 10500, chloe: 10500, dev: 10500 })
	})

	it('hands the leftover cents one each to the first people listed, and the shares add up exactly', () => {
		const shares = splitEqually(10000, ['ana', 'ben', 'chloe'])
		expect(shares)
			.toEqual({ ana: 3334, ben: 3333, chloe: 3333 })
		expect(sum(Object.values(shares)))
			.toBe(10000)
		expect(splitEqually(10001, ['ana', 'ben', 'chloe']))
			.toEqual({ ana: 3334, ben: 3334, chloe: 3333 })
	})

	it('gives nobody anything when nobody shares', () => {
		expect(splitEqually(500, []))
			.toEqual({})
	})

	it('adds up to the total for every group size', () => {
		const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
		for (let size = 1; size <= ids.length; size++) {
			for (const total of [0, 1, 7, 99, 100, 12345]) {
				const shares = splitEqually(total, ids.slice(0, size))
				expect(sum(Object.values(shares)), `${size} people, ${total}`)
					.toBe(total)
			}
		}
	})
})

describe('splitByPercent', () => {
	it('splits by percentage and gives leftover cents to the largest fractional parts', () => {
		// 4446 * 40% = 1778.4, 30% = 1333.8 twice: floors 1778, 1333, 1333 leave 2 cents for the two .8 fractions.
		expect(splitByPercent(4446, { ana: 40, ben: 30, chloe: 30 }))
			.toEqual({ ana: 1778, ben: 1334, chloe: 1334 })
	})

	it('adds up to the total whatever the percentages are (they add up to 100)', () => {
		for (const total of [0, 1, 33, 100, 4446, 99999]) {
			const shares = splitByPercent(total, { a: 33.3, b: 33.3, c: 33.4 })
			expect(sum(Object.values(shares)), `${total}`)
				.toBe(total)
		}
		expect(splitByPercent(100, { a: 50, b: 50 }))
			.toEqual({ a: 50, b: 50 })
	})

	it('lets the earlier person win a tie', () => {
		expect(splitByPercent(1, { a: 50, b: 50 }))
			.toEqual({ a: 1, b: 0 })
	})

	it('reports how many cents were handed out one by one', () => {
		expect(equalLeftover(10000, 3))
			.toBe(1)
		expect(equalLeftover(42000, 4))
			.toBe(0)
		expect(equalLeftover(5, 0))
			.toBe(0)
		expect(percentLeftover(4446, { ana: 40, ben: 30, chloe: 30 }))
			.toBe(2)
	})
})

describe('settle', () => {
	it('lets the person who owes most pay the person who is owed most', () => {
		expect(settle([
			{ id: 'ana', cents: 23744 },
			{ id: 'ben', cents: -6199 },
			{ id: 'chloe', cents: -11922 },
			{ id: 'dev', cents: -5623 },
		]))
			.toEqual([
				{ from: 'chloe', to: 'ana', cents: 11922 },
				{ from: 'ben', to: 'ana', cents: 6199 },
				{ from: 'dev', to: 'ana', cents: 5623 },
			])
	})

	it('clears every balance, with at most one payment fewer than the number of people with a balance', () => {
		const balances = [
			{ id: 'a', cents: 5000 },
			{ id: 'b', cents: 3000 },
			{ id: 'c', cents: -2000 },
			{ id: 'd', cents: -4500 },
			{ id: 'e', cents: -1500 },
		]
		const transfers = settle(balances)
		const net = new Map(balances.map(balance => [balance.id, balance.cents]))
		for (const transfer of transfers) {
			net.set(transfer.from, net.get(transfer.from)! + transfer.cents)
			net.set(transfer.to, net.get(transfer.to)! - transfer.cents)
		}
		expect([...net.values()])
			.toEqual([0, 0, 0, 0, 0])
		expect(transfers.length)
			.toBeLessThanOrEqual(balances.length - 1)
	})

	it('has nothing to pay when everyone is even, and ignores a zero balance', () => {
		expect(settle([{ id: 'a', cents: 0 }, { id: 'b', cents: 0 }]))
			.toEqual([])
		expect(settle([]))
			.toEqual([])
	})
})

describe('money helpers', () => {
	it('converts into base cents with half a cent rounding up', () => {
		expect(toBaseCents(64, 0.92))
			.toBe(5888)
		expect(toBaseCents(38, 1.17))
			.toBe(4446)
		expect(toBaseCents(0.01, 0.5))
			.toBe(1)
		expect(toBaseCents(12.5, 1))
			.toBe(1250)
	})

	it('rounds to the nearest multiple of a step', () => {
		expect(roundToStep(11922, 1))
			.toBe(11922)
		expect(roundToStep(11922, 100))
			.toBe(11900)
		expect(roundToStep(6199, 100))
			.toBe(6200)
		expect(roundToStep(6250, 500))
			.toBe(6500)
		expect(roundToStep(6249, 500))
			.toBe(6000)
	})

	it('formats cents as money in a language, and survives a code Intl does not know', () => {
		expect(formatMoney(1234, 'EUR', 'en'))
			.toBe('€12.34')
		expect(formatMoney(1234, 'ZZZ_', 'en'))
			.toBe('12.34 ZZZ_')
	})
})

describe('text', () => {
	it('falls back to the English text when a language is missing', () => {
		expect(localize({ 'en': 'Hotel', 'zh-TW': '旅館' }, 'zh-TW'))
			.toBe('旅館')
		expect(localize({ en: 'Hotel' }, 'zh-TW'))
			.toBe('Hotel')
		expect(localize({ 'en': 'Hotel', 'zh-TW': '' }, 'zh-TW'))
			.toBe('Hotel')
		expect(localize({ en: 'Hotel' }, '__proto__'))
			.toBe('Hotel')
	})

	it('has a zh-TW text for every built-in key, with the same placeholders as English', () => {
		const en = tripText('en')
		const zh = tripText('zh-TW')
		expect(Object.keys(zh))
			.toEqual(Object.keys(en))
		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!)
				.sort()
			expect(placeholders(zh[key]), key)
				.toEqual(placeholders(en[key]))
			expect(zh[key], key)
				.not
				.toBe('')
		}
		expect(tripText('fr'))
			.toBe(en)
	})

	it('fills placeholders and leaves an unknown one as written', () => {
		expect(fill('{from} pays {to}', { from: 'Ben', to: 'Ana' }))
			.toBe('Ben pays Ana')
		expect(fill('{x} {y}', { x: 1 }))
			.toBe('1 {y}')
	})
})

describe('expense problems', () => {
	const ok = { amount: 10, paidBy: 'ana', participants: ['ana'] }

	it('names the first problem of the current input, in order', () => {
		expect(expenseProblemCode(ok))
			.toBeNull()
		expect(expenseProblemCode({ ...ok, amount: null, participants: [] }))
			.toBe('amount-missing')
		expect(expenseProblemCode({ ...ok, amount: -1, participants: [] }))
			.toBe('amount-negative')
		expect(expenseProblemCode({ ...ok, participants: [], paidBy: null }))
			.toBe('nobody-shares')
		expect(expenseProblemCode({ ...ok, paidBy: null }))
			.toBe('no-payer')
		expect(expenseProblemCode({ ...ok, amount: 0 }))
			.toBeNull()
	})

	it('says each problem in both languages', () => {
		for (const language of ['en', 'zh-TW']) {
			const text = tripText(language)
			for (const code of ['amount-missing', 'amount-negative', 'nobody-shares', 'no-payer'] as const) {
				expect(expenseProblemText(code, text).length)
					.toBeGreaterThan(0)
			}
		}
	})
})
