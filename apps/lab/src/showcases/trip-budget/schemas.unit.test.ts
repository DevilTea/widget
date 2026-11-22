/**
 * The config JSON Schemas declare exactly the keys the checkers know, and the enums agree with the domain.
 */

import { describe, expect, it } from 'vitest'
import { CONFIG_JSON_SCHEMA_DIALECT } from '../../showcase-host'
import { CURRENCY_CONFIG_KEYS, EQUAL_SPLIT_KEYS, EXPENSE_CONFIG_KEYS, PERCENT_SPLIT_KEYS, PERSON_CONFIG_KEYS, TRIP_CONFIG_KEYS } from './config'
import { ROUND_STEPS } from './domain'
import { currencyConfigSchema, expenseConfigSchema, personConfigSchema, tripBudgetConfigSchemas, tripConfigSchema } from './schemas'
import { tripBudgetSystem } from './system'

describe('trip-budget config schemas', () => {
	const cases = [
		['Trip', tripConfigSchema, TRIP_CONFIG_KEYS],
		['Person', personConfigSchema, PERSON_CONFIG_KEYS],
		['Currency', currencyConfigSchema, CURRENCY_CONFIG_KEYS],
		['Expense', expenseConfigSchema, EXPENSE_CONFIG_KEYS],
	] as const

	it.each(cases)('%s declares exactly the keys its checker accepts, in Draft 2020-12', (_type, schema, keys) => {
		expect(schema.$schema)
			.toBe(CONFIG_JSON_SCHEMA_DIALECT)
		expect(Object.keys(schema.properties)
			.sort())
			.toEqual([...keys].sort())
		expect(schema.additionalProperties)
			.toBe(false)
	})

	it('lists the rounding steps and the split keys the domain and the checker use', () => {
		expect(currencyConfigSchema.properties.roundTransfersTo.enum)
			.toEqual([...ROUND_STEPS])
		const [equal, percent] = expenseConfigSchema.properties.split.oneOf
		expect(Object.keys(equal.properties)
			.sort())
			.toEqual([...EQUAL_SPLIT_KEYS].sort())
		expect(Object.keys(percent.properties)
			.sort())
			.toEqual([...PERCENT_SPLIT_KEYS].sort())
	})

	it('reaches the Lab through the showcase\'s schema map for every widget type with a config (its documentation: `registry.unit.test.ts`)', () => {
		const byType = new Map(tripBudgetSystem.catalog.widgets.map(entry => [entry.type, entry]))
		expect([...byType.keys()])
			.toEqual(['Trip', 'Currency', 'Person', 'Expense', 'Settlement'])
		for (const [type, schema] of cases) {
			expect(byType.get(type)?.capabilities.config, type)
				.toBe(true)
			expect(tripBudgetConfigSchemas[type], type)
				.toBe(schema)
		}
		expect(byType.get('Settlement')?.capabilities.config)
			.toBe(false)
		expect(Object.keys(tripBudgetConfigSchemas))
			.not
			.toContain('Settlement')
	})
})
