/**
 * The five trip-budget plugins as one tuple for `createWidgetSystem` (see `../system.ts`). `Trip` is first:
 * the Implementation catalog marks the first type as the current one.
 */

import { CurrencyPlugin } from './currency'
import { ExpensePlugin } from './expense'
import { PersonPlugin } from './person'
import { SettlementPlugin } from './settlement'
import { TripPlugin } from './trip'

export * from './currency'
export * from './expense'
export * from './person'
export * from './settlement'
export * from './trip'

export const tripBudgetPlugins = [
	TripPlugin,
	CurrencyPlugin,
	PersonPlugin,
	ExpensePlugin,
	SettlementPlugin,
] as const

export type TripBudgetPlugins = typeof tripBudgetPlugins
