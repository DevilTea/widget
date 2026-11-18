/**
 * Trip-budget ("Lisbon weekend") preset source texts.
 *
 * Each preset is plain JSON source text that goes through the exact same Apply pipeline as manual editing
 * (`LabSession.applyPreset`): no bypass of `JSON.parse` or `WidgetSystem.createBlueprint`. Only Core's
 * recognized widget keys (`id`, `type`, `config`, `slots`) appear.
 *
 * - `trip-default`: valid. Four friends, five expenses in three currencies, equal and percentage splits,
 *   shares that do not divide evenly (so the leftover cents show up), and a settlement.
 *   Chain of declared dependencies, per expense and across the trip:
 *   `currency.convert` (Method) -> `<expense>.amountBase` -> `<expense>.shares` -> `<person>.owed` and
 *   `<person>.paid` -> `<person>.balance` -> `settlement.balances` -> `settlement.transfers`
 *   (which also calls `currency.roundTransfer`). Nothing reads the settlement, so the default is acyclic.
 * - `trip-invalid`: "a draft with mistakes", one per widget so the four diagnostics do not hide one another:
 *   a rate of 0, percentages that add up to 90, a negative amount and a payer who is not on the trip.
 * - `trip-unsupported-currency`: valid, but the museum tickets are in a currency with no rate. The Blueprint
 *   compiles; at run time `currency.convert` fails, and every Property that depends on it fails with it.
 *
 * There is no cycle preset: nothing in a trip reads the settlement, so a loop would have to be invented.
 */

export interface TripBudgetPreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

const DEFAULT_SOURCE = `{
  "id": "lisbon",
  "type": "Trip",
  "config": { "title": { "en": "Lisbon weekend", "zh-TW": "里斯本週末小旅行" } },
  "slots": {
    "settings": [
      {
        "id": "currency",
        "type": "Currency",
        "config": { "base": "EUR", "rates": { "USD": 0.92, "GBP": 1.17 }, "roundTransfersTo": 1 }
      }
    ],
    "people": [
      { "id": "ana", "type": "Person", "config": { "name": "Ana" } },
      { "id": "ben", "type": "Person", "config": { "name": "Ben" } },
      { "id": "chloe", "type": "Person", "config": { "name": "Chloe" } },
      { "id": "dev", "type": "Person", "config": { "name": "Dev" } }
    ],
    "expenses": [
      {
        "id": "hotel",
        "type": "Expense",
        "config": {
          "title": { "en": "Hotel, three nights", "zh-TW": "旅館三晚" },
          "amount": 420,
          "currency": "EUR",
          "paidBy": "ana",
          "split": { "mode": "equal", "among": ["ana", "ben", "chloe", "dev"] }
        }
      },
      {
        "id": "dinner",
        "type": "Expense",
        "config": {
          "title": { "en": "Seafood dinner", "zh-TW": "海鮮晚餐" },
          "amount": 96.5,
          "currency": "EUR",
          "paidBy": "ben",
          "split": { "mode": "equal", "among": ["ana", "ben", "chloe"] }
        }
      },
      {
        "id": "museum",
        "type": "Expense",
        "config": {
          "title": { "en": "Museum tickets", "zh-TW": "博物館門票" },
          "amount": 64,
          "currency": "USD",
          "paidBy": "chloe",
          "split": { "mode": "equal", "among": ["ana", "chloe", "dev"] }
        }
      },
      {
        "id": "taxi",
        "type": "Expense",
        "config": {
          "title": { "en": "Airport taxi", "zh-TW": "機場計程車" },
          "amount": 38,
          "currency": "GBP",
          "paidBy": "dev",
          "split": { "mode": "percent", "percents": { "ana": 40, "ben": 30, "chloe": 30 } }
        }
      },
      {
        "id": "market",
        "type": "Expense",
        "config": {
          "title": { "en": "Market snacks", "zh-TW": "市場小點心" },
          "amount": 31.9,
          "currency": "EUR",
          "paidBy": "dev",
          "split": { "mode": "equal", "among": ["ana", "ben", "chloe", "dev"] }
        }
      }
    ],
    "summary": [{ "id": "settlement", "type": "Settlement" }]
  }
}`

/** Replaces `search` with `replacement`, which must occur exactly once so a preset edit cannot silently miss. */
function replaceOnce(source: string, search: string, replacement: string): string {
	const index = source.indexOf(search)
	if (index === -1 || source.includes(search, index + search.length))
		throw new Error(`Expected exactly one occurrence of ${JSON.stringify(search)} in the preset source.`)
	return source.slice(0, index) + replacement + source.slice(index + search.length)
}

const INVALID_SOURCE = [
	// `currency`: a rate of 0 -> invalid-widget-config at ['rates', 'USD'].
	(source: string) => replaceOnce(source, '"USD": 0.92', '"USD": 0'),
	// `taxi`: percentages that add up to 90 -> invalid-widget-config at ['split', 'percents'].
	(source: string) => replaceOnce(source, '"ana": 40, "ben": 30, "chloe": 30', '"ana": 40, "ben": 30, "chloe": 20'),
	// `market`: a negative amount -> invalid-widget-config at ['amount'].
	(source: string) => replaceOnce(source, '"amount": 31.9', '"amount": -31.9'),
	// `dinner`: a payer who is not on the trip -> invalid-widget-structure (unknown-person).
	(source: string) => replaceOnce(source, '"paidBy": "ben"', '"paidBy": "zoe"'),
].reduce((source, edit) => edit(source), DEFAULT_SOURCE)

// The museum tickets in Swiss francs, which have no rate: valid to compile, fails at run time.
const UNSUPPORTED_CURRENCY_SOURCE = replaceOnce(DEFAULT_SOURCE, '"amount": 64,\n          "currency": "USD"', '"amount": 64,\n          "currency": "CHF"')

export const tripBudgetPresets: readonly TripBudgetPreset[] = [
	{
		id: 'trip-default',
		label: 'Default — Lisbon weekend',
		description: 'A valid trip: four friends, five expenses in euros, dollars and pounds, equal and percentage splits, and the settlement that results.',
		sourceText: DEFAULT_SOURCE,
	},
	{
		id: 'trip-invalid',
		label: 'Draft with mistakes — four problems',
		description: 'The default with four deliberate mistakes, one per widget: a rate of 0, percentages that add up to 90, a negative amount and a payer who is not on the trip. Each is a located diagnostic.',
		sourceText: INVALID_SOURCE,
	},
	{
		id: 'trip-unsupported-currency',
		label: 'Run-time failure — a currency with no rate',
		description: 'The default where the museum tickets are in Swiss francs, which the Currency has no rate for. The Blueprint is valid, but the conversion Method fails when it runs, and every Property that depends on it fails too.',
		sourceText: UNSUPPORTED_CURRENCY_SOURCE,
	},
]

export const defaultTripBudgetPreset: TripBudgetPreset = tripBudgetPresets[0]!
