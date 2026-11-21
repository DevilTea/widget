/**
 * The money arithmetic and formatting of the quote (`domain.ts`).
 */

import { describe, expect, it } from 'vitest'
import { formatMoney, formatSignedMoney, localize, percentOf } from './domain'

describe('percentOf (half-up on integers)', () => {
	it('rounds an exact half up, also when the percentage is not an integer', () => {
		// 375 x 9.2% = 34.5 exactly: half-up is 35 (Math.round(375 * 9.2 / 100) is 34 in floating point).
		expect(percentOf(375, 9.2))
			.toBe(35)
		expect(percentOf(10900, 5))
			.toBe(545)
		expect(percentOf(10355, 21))
			.toBe(2175)
		expect(percentOf(1, 50))
			.toBe(1)
		expect(percentOf(1, 49.99))
			.toBe(0)
		expect(percentOf(0, 21))
			.toBe(0)
		expect(percentOf(-1, 49.99))
			.toBe(0)
		expect(percentOf(-375, 9.2))
			.toBe(-35)
	})

	it('stays exact when the product passes 2^53 (a large subtotal with a percentage multiplier)', () => {
		// 20_692_906_949_961 x 150% = 31_039_360_424_941.5 -> 31_039_360_424_942 (half-up). As a Number the product
		// (about 3.1e17, past 2^53) was already rounded and gave ...941; the same for the other two.
		expect(percentOf(20_692_906_949_961, 150))
			.toBe(31_039_360_424_942)
		expect(percentOf(101_343_456_945_247, 299.99))
			.toBe(304_020_236_490_046)
		expect(percentOf(59_651_647_545_650, 21))
			.toBe(12_526_845_984_587)
		expect(percentOf(-20_692_906_949_961, 150))
			.toBe(-31_039_360_424_942)
	})

	it('counts a percentage to two decimals', () => {
		// 8.25% of 12345 = 1018.4625 -> 1018
		expect(percentOf(12345, 8.25))
			.toBe(1018)
		// 9.215 is read as 9.22 (hundredths of a percent): 1000 x 9.22% = 92.2 -> 92
		expect(percentOf(1000, 9.215))
			.toBe(92)
	})

	it('is within half a unit of the exact value, and rounds an exact half up, over a grid of amounts and percentages', () => {
		const wrong: string[] = []
		for (let cents = 0; cents <= 1000; cents++) {
			for (let hundredths = 0; hundredths <= 3000; hundredths += 7) {
				const result = percentOf(cents, hundredths / 100)
				// exact value is cents x hundredths / 10000; half-up means -0.5 <= exact - result < 0.5
				const doubledGap = 2 * cents * hundredths - 20000 * result
				if (!(doubledGap >= -10000 && doubledGap < 10000))
					wrong.push(`${cents} x ${hundredths / 100}%`)
			}
		}
		expect(wrong)
			.toEqual([])
	})
})

describe('formatMoney', () => {
	it('uses the currency\'s own number of decimals', () => {
		expect(formatMoney(12530, 'EUR', 'en'))
			.toBe('€125.30')
		expect(formatMoney(500, 'JPY', 'en'))
			.toBe('¥500')
		expect(formatMoney(12345, 'KWD', 'en'))
			.toBe('KWD 12.345')
	})

	it('formats in the viewer\'s language and signs an amount', () => {
		expect(formatMoney(123456, 'EUR', 'zh-TW'))
			.toBe('€1,234.56')
		expect(formatSignedMoney(545, 'EUR', 'en'))
			.toBe('+€5.45')
		expect(formatSignedMoney(-545, 'EUR', 'en'))
			.toBe('−€5.45')
		expect(formatSignedMoney(0, 'EUR', 'en'))
			.toBe('€0.00')
		expect(formatSignedMoney(-500, 'JPY', 'en'))
			.toBe('−¥500')
	})
})

describe('localize', () => {
	it('falls back to English for a language the text does not have, and ignores inherited keys', () => {
		expect(localize({ 'en': 'Flyers', 'zh-TW': '傳單' }, 'zh-TW'))
			.toBe('傳單')
		expect(localize({ en: 'Flyers' }, 'zh-TW'))
			.toBe('Flyers')
		expect(localize({ en: 'Flyers' }, 'toString'))
			.toBe('Flyers')
	})
})
