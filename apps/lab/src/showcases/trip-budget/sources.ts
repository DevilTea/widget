/**
 * Trip-budget curated Implementation-explorer registry: one entry per `tripBudgetPlugins` type
 * (`./plugins/index.ts`) with the plugin file, the Vue renderer file(s) and `domain.ts`, where the money
 * arithmetic (splitting, settling, rounding) and the built-in texts live. The widgets that read other
 * widgets also list `plugins/reads.ts`, where the cross-widget dependencies are declared, and the
 * lazily-read Properties list the renderer component that is the only place they are read. Every file is a
 * lazy `?raw` thunk (see `../../implementation/types.ts`), so this module stays small and pulls no source
 * text into the shell's initial chunks.
 */

import type { SourcesRegistry } from '../../implementation/types'

const ROOT = 'apps/lab/src/showcases/trip-budget'

const domain = {
	kind: 'domain',
	title: 'domain.ts',
	path: `${ROOT}/domain.ts`,
	load: () => import('./domain.ts?raw').then(module => module.default),
} as const

const reads = {
	kind: 'domain',
	title: 'reads.ts',
	path: `${ROOT}/plugins/reads.ts`,
	load: () => import('./plugins/reads.ts?raw').then(module => module.default),
} as const

const structure = {
	kind: 'domain',
	title: 'structure.ts',
	path: `${ROOT}/plugins/structure.ts`,
	load: () => import('./plugins/structure.ts?raw').then(module => module.default),
} as const

const resetHost = {
	kind: 'renderer',
	title: 'reset-host.ts',
	path: `${ROOT}/renderers/reset-host.ts`,
	load: () => import('./renderers/reset-host.ts?raw').then(module => module.default),
} as const

export const tripBudgetSources: SourcesRegistry = {
	Trip: {
		files: [
			{ kind: 'plugin', title: 'trip.ts', path: `${ROOT}/plugins/trip.ts`, load: () => import('./plugins/trip.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'TripRootRenderer.vue', path: `${ROOT}/renderers/TripRootRenderer.vue`, load: () => import('./renderers/TripRootRenderer.vue?raw').then(m => m.default) },
			resetHost,
			{ kind: 'renderer', title: 'index.ts', path: `${ROOT}/renderers/index.ts`, load: () => import('./renderers/index.ts?raw').then(m => m.default) },
			reads,
			domain,
		],
	},
	Currency: {
		files: [
			{ kind: 'plugin', title: 'currency.ts', path: `${ROOT}/plugins/currency.ts`, load: () => import('./plugins/currency.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'CurrencyRenderer.vue', path: `${ROOT}/renderers/CurrencyRenderer.vue`, load: () => import('./renderers/CurrencyRenderer.vue?raw').then(m => m.default) },
			structure,
			domain,
		],
	},
	Person: {
		files: [
			{ kind: 'plugin', title: 'person.ts', path: `${ROOT}/plugins/person.ts`, load: () => import('./plugins/person.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'PersonRenderer.vue', path: `${ROOT}/renderers/PersonRenderer.vue`, load: () => import('./renderers/PersonRenderer.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'PersonLedgerView.vue', path: `${ROOT}/renderers/PersonLedgerView.vue`, load: () => import('./renderers/PersonLedgerView.vue?raw').then(m => m.default) },
			reads,
			structure,
			domain,
		],
	},
	Expense: {
		files: [
			{ kind: 'plugin', title: 'expense.ts', path: `${ROOT}/plugins/expense.ts`, load: () => import('./plugins/expense.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'ExpenseRenderer.vue', path: `${ROOT}/renderers/ExpenseRenderer.vue`, load: () => import('./renderers/ExpenseRenderer.vue?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'ExpenseBreakdownView.vue', path: `${ROOT}/renderers/ExpenseBreakdownView.vue`, load: () => import('./renderers/ExpenseBreakdownView.vue?raw').then(m => m.default) },
			resetHost,
			reads,
			structure,
			domain,
		],
	},
	Settlement: {
		files: [
			{ kind: 'plugin', title: 'settlement.ts', path: `${ROOT}/plugins/settlement.ts`, load: () => import('./plugins/settlement.ts?raw').then(m => m.default) },
			{ kind: 'renderer', title: 'SettlementRenderer.vue', path: `${ROOT}/renderers/SettlementRenderer.vue`, load: () => import('./renderers/SettlementRenderer.vue?raw').then(m => m.default) },
			reads,
			structure,
			domain,
		],
	},
}
