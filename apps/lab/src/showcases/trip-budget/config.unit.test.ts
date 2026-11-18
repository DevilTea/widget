/**
 * The config checkers report exact paths and machine-readable reasons, and every resolver has a recovery
 * fallback marked `recovered`.
 */

import type { ConfigDiagnostic } from './config'
import { describe, expect, it } from 'vitest'
import { checkCurrencyConfig, checkExpenseConfig, checkPersonConfig, checkTripConfig, formatConfigPath, isRecovered, resolveCurrencyConfig, resolveExpenseConfig, resolvePersonConfig, resolveTripConfig } from './config'

function collect(check: (input: unknown, report: (diagnostic: ConfigDiagnostic) => void) => void, input: unknown): { path: string, reason: string }[] {
	const found: ConfigDiagnostic[] = []
	check(input, diagnostic => found.push(diagnostic))
	return found.map(diagnostic => ({ path: formatConfigPath(diagnostic.path ?? []), reason: diagnostic.reason ?? '' }))
}

const validExpense = {
	title: { en: 'Hotel' },
	amount: 10,
	currency: 'EUR',
	paidBy: 'ana',
	split: { mode: 'equal', among: ['ana', 'ben'] },
}

describe('checkTripConfig and checkPersonConfig', () => {
	it('accepts a title and a name', () => {
		expect(collect(checkTripConfig, { title: { 'en': 'Trip', 'zh-TW': '旅行' } }))
			.toEqual([])
		expect(collect(checkPersonConfig, { name: 'Ana' }))
			.toEqual([])
	})

	it('reports a missing key, an unknown key, a missing English text and a wrong type', () => {
		expect(collect(checkTripConfig, {}))
			.toEqual([{ path: 'config.title', reason: 'missing-key' }])
		expect(collect(checkTripConfig, { title: { en: 'T' }, subtitle: 'x' }))
			.toEqual([{ path: 'config.subtitle', reason: 'unknown-key' }])
		expect(collect(checkTripConfig, { title: { 'zh-TW': '旅行' } }))
			.toEqual([{ path: 'config.title.en', reason: 'empty-text' }])
		expect(collect(checkTripConfig, { title: { 'en': 'T', 'zh-TW': 3 } }))
			.toEqual([{ path: 'config.title.zh-TW', reason: 'invalid-type' }])
		expect(collect(checkTripConfig, 'Trip'))
			.toEqual([{ path: 'config', reason: 'not-an-object' }])
		expect(collect(checkPersonConfig, { name: ' ' }))
			.toEqual([{ path: 'config.name', reason: 'empty-text' }])
	})
})

describe('checkCurrencyConfig', () => {
	it('accepts a base, rates and a rounding step', () => {
		expect(collect(checkCurrencyConfig, { base: 'EUR', rates: { USD: 0.92 }, roundTransfersTo: 100 }))
			.toEqual([])
		expect(collect(checkCurrencyConfig, { base: 'EUR', rates: {} }))
			.toEqual([])
	})

	it('reports a rate that is not positive, a base with a rate, a bad code and an unsupported step', () => {
		expect(collect(checkCurrencyConfig, { base: 'EUR', rates: { USD: 0 } }))
			.toEqual([{ path: 'config.rates.USD', reason: 'invalid-rate' }])
		expect(collect(checkCurrencyConfig, { base: 'EUR', rates: { EUR: 1 } }))
			.toEqual([{ path: 'config.rates.EUR', reason: 'base-has-rate' }])
		expect(collect(checkCurrencyConfig, { base: 'euro', rates: { usd: 1 } }))
			.toEqual([
				{ path: 'config.base', reason: 'invalid-currency-code' },
				{ path: 'config.rates.usd', reason: 'invalid-currency-code' },
			])
		expect(collect(checkCurrencyConfig, { base: 'EUR', rates: {}, roundTransfersTo: 7 }))
			.toEqual([{ path: 'config.roundTransfersTo', reason: 'unsupported-round-step' }])
		expect(collect(checkCurrencyConfig, { base: 'EUR' }))
			.toEqual([{ path: 'config.rates', reason: 'missing-key' }])
	})
})

describe('checkExpenseConfig', () => {
	it('accepts an equal split and a percent split', () => {
		expect(collect(checkExpenseConfig, validExpense))
			.toEqual([])
		expect(collect(checkExpenseConfig, { ...validExpense, split: { mode: 'percent', percents: { ana: 60, ben: 40 } } }))
			.toEqual([])
		expect(collect(checkExpenseConfig, { ...validExpense, amount: 0 }))
			.toEqual([])
	})

	it('reports a negative amount, a bad currency and a bad payer id', () => {
		expect(collect(checkExpenseConfig, { ...validExpense, amount: -5 }))
			.toEqual([{ path: 'config.amount', reason: 'out-of-range' }])
		expect(collect(checkExpenseConfig, { ...validExpense, currency: 'eur' }))
			.toEqual([{ path: 'config.currency', reason: 'invalid-currency-code' }])
		expect(collect(checkExpenseConfig, { ...validExpense, paidBy: 'Ana' }))
			.toEqual([{ path: 'config.paidBy', reason: 'invalid-person-id' }])
	})

	it('reports percentages that do not add up to 100, once, at the percents', () => {
		expect(collect(checkExpenseConfig, { ...validExpense, split: { mode: 'percent', percents: { ana: 40, ben: 30, chloe: 20 } } }))
			.toEqual([{ path: 'config.split.percents', reason: 'percent-total' }])
		expect(collect(checkExpenseConfig, { ...validExpense, split: { mode: 'percent', percents: { ana: 33.3, ben: 33.3, chloe: 33.4 } } }))
			.toEqual([])
	})

	it('reports an out-of-range percentage without also reporting the total', () => {
		expect(collect(checkExpenseConfig, { ...validExpense, split: { mode: 'percent', percents: { ana: 150, ben: -50 } } }))
			.toEqual([
				{ path: 'config.split.percents.ana', reason: 'out-of-range' },
				{ path: 'config.split.percents.ben', reason: 'out-of-range' },
			])
	})

	it('reports an empty or repeated participant list, an unknown mode and missing keys', () => {
		expect(collect(checkExpenseConfig, { ...validExpense, split: { mode: 'equal', among: [] } }))
			.toEqual([{ path: 'config.split.among', reason: 'empty-participants' }])
		expect(collect(checkExpenseConfig, { ...validExpense, split: { mode: 'equal', among: ['ana', 'ana'] } }))
			.toEqual([{ path: 'config.split.among.1', reason: 'duplicate-participant' }])
		expect(collect(checkExpenseConfig, { ...validExpense, split: { mode: 'shares' } }))
			.toEqual([{ path: 'config.split.mode', reason: 'unknown-split-mode' }])
		expect(collect(checkExpenseConfig, { title: { en: 'x' } }))
			.toEqual([
				{ path: 'config.amount', reason: 'missing-key' },
				{ path: 'config.currency', reason: 'missing-key' },
				{ path: 'config.paidBy', reason: 'missing-key' },
				{ path: 'config.split', reason: 'missing-key' },
			])
	})
})

describe('resolve', () => {
	it('resolves a valid config and keeps the order of the people', () => {
		expect(resolveExpenseConfig({ ...validExpense, split: { mode: 'percent', percents: { ben: 60, ana: 40 } } } as never).participants)
			.toEqual(['ben', 'ana'])
		expect(resolveExpenseConfig(validExpense as never).participants)
			.toEqual(['ana', 'ben'])
		expect(resolveCurrencyConfig({ base: 'EUR', rates: { USD: 0.92, GBP: 1.17 } }))
			.toMatchObject({ codes: ['EUR', 'USD', 'GBP'], roundStep: 1, recovered: false })
		expect(resolveCurrencyConfig({ base: 'EUR', rates: {}, roundTransfersTo: 500 }).roundStep)
			.toBe(500)
	})

	it('resolves the recovery input to a fallback that says it was recovered', () => {
		expect(resolveTripConfig(null).recovered)
			.toBe(true)
		expect(resolvePersonConfig(null).recovered)
			.toBe(true)
		expect(resolveCurrencyConfig(null).recovered)
			.toBe(true)
		expect(resolveExpenseConfig(null).recovered)
			.toBe(true)
		expect(isRecovered({ config: resolveExpenseConfig(null) }))
			.toBe(true)
		expect(isRecovered({ config: resolveExpenseConfig(validExpense as never) }))
			.toBe(false)
		expect(isRecovered({}))
			.toBe(false)
	})
})
