/**
 * The documentation of the trip-budget plugins' config and value types, written once and referenced from the builders
 * (`defineTypeDocs` + `ref` for a type several members use, `defineFieldDocs` for a config). Core keeps it on
 * `plugin.docs`; the widget-skills generator reads it from there.
 */

import type { TypeDocs } from '@deviltea/widget-core'
import type { CurrencyConfig, CurrencyRawConfig, ExpenseConfig, ExpenseRawConfig, PersonConfig, PersonRawConfig, TripConfig, TripRawConfig } from './config'
import type { BalanceEntry, BreakdownLine, ExpenseBreakdown, ExpenseProblem, I18nText, LedgerEntry, PersonLedger, RosterEntry, SettlementOutcome, SettlementTransfer, TripView } from './domain'
import { defineFieldDocs, defineTypeDocs } from '@deviltea/widget-core'

// -------------------------------------------------------------------------------------------------
// Shared types
// -------------------------------------------------------------------------------------------------

export const i18nTextDocs: TypeDocs<I18nText> = defineTypeDocs<I18nText>('I18nText', {
	description: 'Text per language, `{ "en": "...", "zh-TW": "..." }`. `en` is required; a missing language falls back to it.',
	values: { description: 'The text in one language. `en` is the English text, which a missing language falls back to.' },
})

export const tripViewDocs: TypeDocs<TripView> = defineTypeDocs<TripView>('TripView', {
	description: 'What every widget\'s `view` Property says: the trip language and the base currency. The built-in texts (`tripText(language)`) are a plain lookup the renderers do themselves, so the Runtime panel shows two small values instead of the whole text table.',
	fields: {
		language: { description: 'The trip language: `en` or `zh-TW`.' },
		base: { description: 'The base currency code.' },
	},
})

export const rosterEntryDocs: TypeDocs<RosterEntry> = defineTypeDocs<RosterEntry>('RosterEntry', {
	description: 'One person of the trip.',
	fields: {
		id: { description: 'The Person widget\'s id.' },
		name: { description: 'The name shown for the person.' },
	},
})

export const expenseProblemDocs: TypeDocs<ExpenseProblem> = defineTypeDocs<ExpenseProblem>('ExpenseProblem', {
	description: 'Why an expense\'s current input cannot be counted.',
	fields: {
		code: { description: 'The language-free code: `amount-missing`, `amount-negative`, `nobody-shares` or `no-payer`.' },
		message: { description: 'The problem in the trip language.' },
	},
})

export const breakdownLineDocs: TypeDocs<BreakdownLine> = defineTypeDocs<BreakdownLine>('BreakdownLine', {
	description: 'One line of an expense\'s breakdown: a person\'s share and where it came from.',
	fields: {
		id: { description: 'The Person widget\'s id.' },
		name: { description: 'The name shown for the person.' },
		cents: { description: 'The share in minor units of the base currency.' },
		percent: { description: 'The authored percentage, or `null` for an equal split.' },
	},
})

export const expenseBreakdownDocs: TypeDocs<ExpenseBreakdown> = defineTypeDocs<ExpenseBreakdown>('ExpenseBreakdown', {
	description: 'How an expense\'s amount was converted and split, line by line.',
	fields: {
		conversion: {
			description: 'The conversion, or `null` when the expense is already in the base currency.',
			fields: {
				amount: { description: 'The amount in minor units of `currency`.' },
				currency: { description: 'The expense\'s currency code.' },
				rate: { description: 'Base units per one unit of `currency`.' },
				baseCents: { description: 'The converted amount in minor units of the base currency.' },
			},
		},
		totalCents: { description: 'The amount in minor units of the base currency.' },
		lines: { description: 'Each participant\'s share.', items: { ref: breakdownLineDocs } },
		remainderCents: { description: 'Leftover cents handed out one by one so the shares add up to the total.' },
	},
})

export const ledgerEntryDocs: TypeDocs<LedgerEntry> = defineTypeDocs<LedgerEntry>('LedgerEntry', {
	description: 'One person\'s line in the ledger: what they paid and their share, for one expense.',
	fields: {
		expense: { description: 'The Expense widget\'s id.' },
		title: { description: 'The expense title in the trip language.' },
		paidCents: { description: 'What the person paid for it, in minor units of the base currency.' },
		shareCents: { description: 'The person\'s share of it, in minor units of the base currency.' },
	},
})

export const personLedgerDocs: TypeDocs<PersonLedger> = defineTypeDocs<PersonLedger>('PersonLedger', {
	description: 'A person\'s ledger: a line per counted expense.',
	fields: {
		entries: { description: 'One line per counted expense, in the order of the expenses.', items: { ref: ledgerEntryDocs } },
	},
})

export const balanceEntryDocs: TypeDocs<BalanceEntry> = defineTypeDocs<BalanceEntry>('BalanceEntry', {
	description: 'One person\'s balance.',
	fields: {
		id: { description: 'The Person widget\'s id.' },
		name: { description: 'The name shown for the person.' },
		cents: { description: 'The balance in minor units of the base currency; positive means they get money back.' },
	},
})

export const settlementTransferDocs: TypeDocs<SettlementTransfer> = defineTypeDocs<SettlementTransfer>('SettlementTransfer', {
	description: 'One payment that clears the balances: `from` pays `to`.',
	fields: {
		from: { description: 'The id of the Person who pays.' },
		fromName: { description: 'The name of the person who pays.' },
		to: { description: 'The id of the Person who is paid.' },
		toName: { description: 'The name of the person who is paid.' },
		exactCents: { description: 'The exact amount the balances ask for.' },
		cents: { description: 'The amount after rounding to the chosen step.' },
	},
})

export const settlementOutcomeDocs: TypeDocs<SettlementOutcome> = defineTypeDocs<SettlementOutcome>('SettlementOutcome', {
	description: 'What the Settlement Property computes: the transfers and how they compare with the exact balances.',
	fields: {
		transfers: { description: 'Who pays whom, largest debts first.', items: { ref: settlementTransferDocs } },
		roundingGapCents: { description: 'Exact amount to move minus the rounded amount actually moved, in minor units (can be negative).' },
	},
})

// -------------------------------------------------------------------------------------------------
// Configs
// -------------------------------------------------------------------------------------------------

export const tripRawConfigDocs = defineFieldDocs<TripRawConfig>()({
	description: 'The authored config of a Trip.',
	fields: {
		title: { description: 'The trip title. "en" is required; "zh-TW" is optional.', ref: i18nTextDocs },
	},
})

export const tripConfigDocs = defineFieldDocs<TripConfig>()({
	description: 'The resolved config of a Trip.',
	fields: {
		title: { description: 'The trip title per language.', ref: i18nTextDocs },
		recovered: { description: 'Whether this is the fallback of a config that failed validation.' },
	},
})

export const currencyRawConfigDocs = defineFieldDocs<CurrencyRawConfig>()({
	description: 'The authored config of a Currency.',
	fields: {
		base: { description: 'The currency the settlement is computed and shown in, a three-letter capital code such as `"EUR"` (it matches `^[A-Z]{3}$`). It is always worth 1 and must not appear in `rates`.' },
		rates: { description: 'How many base-currency units one unit of each other currency is worth, such as `{ "USD": 0.92 }`. Each key is a three-letter capital code (`^[A-Z]{3}$`) and each rate is greater than 0. An expense in a currency that is neither the base nor listed here cannot be converted: the conversion Method fails and the settlement fails with it.' },
		roundTransfersTo: { description: 'The starting "round transfers to" step in minor units: 1 = the cent, 100 = a whole unit, 500 = the nearest 5 units. A viewer can change it; Start over restores this value. Defaults to 1.' },
	},
})

export const currencyConfigDocs = defineFieldDocs<CurrencyConfig>()({
	description: 'The resolved config of a Currency.',
	fields: {
		base: { description: 'The base currency code.' },
		rates: { description: 'The other currencies\' rates (the base is not in it): base units per one unit.' },
		codes: { description: 'The base first, then every other code in the order written.' },
		roundStep: { description: 'The starting rounding step in minor units: 1, 100 or 500.' },
		recovered: { description: 'Whether this is the fallback of a config that failed validation.' },
	},
})

export const personRawConfigDocs = defineFieldDocs<PersonRawConfig>()({
	description: 'The authored config of a Person.',
	fields: {
		name: { description: 'The name shown for this person: at least one character. The widget id (not the name) is what expenses refer to.' },
	},
})

export const personConfigDocs = defineFieldDocs<PersonConfig>()({
	description: 'The resolved config of a Person.',
	fields: {
		name: { description: 'The name shown for this person.' },
		recovered: { description: 'Whether this is the fallback of a config that failed validation.' },
	},
})

export const expenseRawConfigDocs = defineFieldDocs<ExpenseRawConfig>()({
	description: 'The authored config of an Expense.',
	fields: {
		title: { description: 'What the money was spent on.', ref: i18nTextDocs },
		amount: { description: 'The starting amount, in `currency`; at least 0. A viewer can change the amount, the payer and (for an equal split) who shares; "Reset this expense" restores these starting values.' },
		currency: { description: 'The currency of the amount: the Currency widget\'s base or one of its rates (a three-letter capital code, `^[A-Z]{3}$`).' },
		paidBy: { description: 'The id of the Person who paid at the start (a person id, `^[a-z][a-z0-9-]*$`). It must exist in the same trip.' },
		split: {
			description: 'How the amount is shared: equally among some people (`mode: "equal"`; the leftover cents go to the first people listed), or by percentages that add up to 100 (`mode: "percent"`).',
			fields: {
				mode: { description: '`equal` or `percent`.' },
				among: { description: 'Equal split: the ids of the Persons sharing the expense at the start (a viewer can tick and untick them). At least one, each once, each a person id (`^[a-z][a-z0-9-]*$`).' },
				percents: { description: 'Percent split: Person id -> percentage. Each key is a person id (`^[a-z][a-z0-9-]*$`) and each percentage is from 0 to 100. The percentages must add up to 100 (the compiler reports a located diagnostic otherwise).' },
			},
		},
	},
})

export const expenseConfigDocs = defineFieldDocs<ExpenseConfig>()({
	description: 'The resolved config of an Expense.',
	fields: {
		title: { description: 'What the money was spent on.', ref: i18nTextDocs },
		amount: { description: 'The starting amount, in `currency`.' },
		currency: { description: 'The currency of the amount.' },
		paidBy: { description: 'The id of the Person who paid at the start.' },
		split: {
			description: 'How the amount is shared.',
			fields: {
				mode: { description: '`equal` or `percent`.' },
				among: { description: 'Equal split: the ids of the Persons sharing the expense at the start.' },
				percents: { description: 'Percent split: Person id -> percentage.' },
			},
		},
		participants: { description: 'The people this expense names as sharing it: `among`, or the keys of `percents`.' },
		recovered: { description: 'Whether this is the fallback of a config that failed validation.' },
	},
})
