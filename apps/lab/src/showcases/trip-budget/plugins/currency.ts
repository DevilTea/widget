/**
 * `Currency`: the trip's money settings. It holds the base currency and the rates (config), the viewer's
 * choice of how finely to round a payment (State `roundStep`), and two **read-only Methods** that other
 * widgets' Properties call:
 *
 * - `convert(amount, currency)`: an amount in any listed currency, in minor units of the base currency.
 *   A currency with no rate is a Method diagnostic (`reason: 'unknown-currency'`), so the call fails and
 *   every Property that depends on it fails with it.
 * - `roundTransfer(cents)`: a payment rounded to the current `roundStep`. It reads State, so a change of
 *   `roundStep` changes what the Methods return, and the Properties that call it recompute.
 *
 * "Read-only" is a fact Core derives, not something declared: neither Method writes State or emits an
 * Event, so Core allows a Property to depend on them. A Method that wrote State or emitted would make the
 * Blueprint invalid (`property-dependency-has-side-effects`).
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { CurrencyConfig, CurrencyRawConfig } from '../config'
import type { TripView } from '../domain'
import { createWidgetPlugin, undocumented } from '@deviltea/widget-core'
import { checkCurrencyConfig, resolveCurrencyConfig } from '../config'
import { isRoundStep, roundToStep, toBaseCents } from '../domain'
import { languageReads, viewFrom } from './reads'
import { checkInsideTrip } from './structure'

/**
 * The trip's money settings. Config: the base currency and the rates of the others. State `roundStep` (1, 100 or 500 minor
 * units) is how finely payments are rounded. Properties: `base`, `rates`, `codes` and `view`. Read-only Methods:
 * `convert(amount, currency)` (an amount in minor units of the base currency; fails for a currency without a rate) and
 * `roundTransfer(cents)` (rounded to `roundStep`). Other widgets' Properties call both.
 */
export interface CurrencyInterfaces extends WidgetInterfaces {
	/** The base currency, the rates of other currencies (base units per one unit) and the starting rounding step. */
	config: { raw: CurrencyRawConfig, resolved: CurrencyConfig }
	state: {
		/** How finely payments are rounded, in minor units: 1, 100 or 500. */
		roundStep: number
	}
	properties: {
		/** The base currency code. */
		base: string
		/** The rate of each other currency: base units per one unit. */
		rates: Readonly<Record<string, number>>
		/** Every currency code the trip supports: the base first, then the rated ones. */
		codes: readonly string[]
		/** The trip language and the base currency, derived from the root Trip and the Currency. */
		view: TripView
	}
	methods: {
		/**
		 * Converts an amount into minor units of the base currency. Read-only. Fails (`unknown-currency`) for a currency
		 * without a rate.
		 *
		 * @param amount - The amount in minor units of `currency`.
		 * @param currency - A currency code the trip lists.
		 * @returns The amount in minor units of the base currency.
		 */
		convert: (amount: number, currency: string) => number
		/**
		 * Rounds a payment to the current `roundStep`. Read-only.
		 *
		 * @param cents - The exact payment in minor units of the base currency.
		 * @returns The rounded payment.
		 */
		roundTransfer: (cents: number) => number
	}
}

export const CurrencyPlugin = createWidgetPlugin('Currency')
	.description(undocumented)
	.interfaces<CurrencyInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is CurrencyRawConfig => {
			checkCurrencyConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveCurrencyConfig,
	})
	.structure(ctx => checkInsideTrip(ctx, 'Currency'))
	.state(state => state.roundStep({
		description: undocumented,
		validate: (input): input is number => isRoundStep(input),
		default: ({ config }) => config.roundStep,
	}))
	.properties(properties => properties
		.base({ description: undocumented, compute: ({ config }) => config.base })
		.rates({ description: undocumented, compute: ({ config }) => config.rates })
		.codes({ description: undocumented, compute: ({ config }) => config.codes })
		.view({
			description: undocumented,
			registerDeps: ({ dep, blueprint }) => languageReads(dep, blueprint),
			compute: ({ deps, config }) => ({ ...viewFrom(deps), base: config.base }),
		}))
	.methods(methods => methods
		.convert({
			description: undocumented,
			validateArgs: (args): args is [number, string] => args.length === 2 && typeof args[0] === 'number' && Number.isFinite(args[0]) && typeof args[1] === 'string',
			execute: ({ args: [amount, currency], config, addDiagnostic }) => {
				if (currency === config.base)
					return toBaseCents(amount, 1)
				const rate = Object.hasOwn(config.rates, currency) ? config.rates[currency] : undefined
				if (rate === undefined) {
					addDiagnostic({ message: `There is no rate for ${currency}: add it to the Currency rates or use ${config.base}.`, reason: 'unknown-currency' })
					return 0
				}
				return toBaseCents(amount, rate)
			},
		})
		.roundTransfer({
			description: undocumented,
			validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number' && Number.isFinite(args[0]),
			registerDeps: ({ dep }) => ({ step: dep.self.state.get('roundStep') }),
			execute: ({ args: [cents], deps }) => {
				const step = deps.step()
				return roundToStep(cents, step.ok && step.value !== null ? step.value : 1)
			},
		}))
	.done()
