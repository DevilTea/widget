/**
 * The config JSON Schemas declare exactly the keys the checkers know, and the enums agree with the domain.
 */

import { WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { CURRENCY_CONFIG_KEYS, EQUAL_SPLIT_KEYS, EXPENSE_CONFIG_KEYS, PERCENT_SPLIT_KEYS, PERSON_CONFIG_KEYS, TRIP_CONFIG_KEYS } from './config'
import { ROUND_STEPS } from './domain'
import { currencyConfigSchema, expenseConfigSchema, personConfigSchema, tripConfigSchema } from './schemas'
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
			.toBe(WIDGET_CONFIG_JSON_SCHEMA_DIALECT)
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

	it('reaches the catalog through the system, with a description, for every widget type with a config', () => {
		const byType = new Map(tripBudgetSystem.catalog.widgets.map(entry => [entry.type, entry]))
		expect([...byType.keys()])
			.toEqual(['Trip', 'Currency', 'Person', 'Expense', 'Settlement'])
		for (const type of ['Trip', 'Currency', 'Person', 'Expense']) {
			expect(byType.get(type)?.config?.schema, type).not.toBeNull()
			expect(byType.get(type)?.config?.description.length, type)
				.toBeGreaterThan(0)
		}
		expect(byType.get('Settlement')?.config)
			.toBeNull()
	})
})
