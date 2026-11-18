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
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkCurrencyConfig, resolveCurrencyConfig } from '../config'
import { isRoundStep, roundToStep, toBaseCents } from '../domain'
import { currencyConfigSchema } from '../schemas'
import { languageReads, viewFrom } from './reads'
import { checkInsideTrip } from './structure'

export interface CurrencyInterfaces extends WidgetInterfaces {
	config: { raw: CurrencyRawConfig, resolved: CurrencyConfig }
	state: { roundStep: number }
	properties: {
		base: string
		rates: Readonly<Record<string, number>>
		codes: readonly string[]
		view: TripView
	}
	methods: {
		convert: (amount: number, currency: string) => number
		roundTransfer: (cents: number) => number
	}
}

export const CurrencyPlugin = createWidgetPlugin('Currency')
	.description('The trip\'s money settings. Config: the base currency and the rates of the others. State `roundStep` (1, 100 or 500 minor units) is how finely payments are rounded. Properties: `base`, `rates`, `codes` and `view`. Read-only Methods: `convert(amount, currency)` (an amount in minor units of the base currency; fails for a currency without a rate) and `roundTransfer(cents)` (rounded to `roundStep`). Other widgets\' Properties call both.')
	.interfaces<CurrencyInterfaces>()
	.config({
		description: 'The base currency, the rates of other currencies (base units per one unit) and the starting rounding step.',
		schema: currencyConfigSchema,
		validate: (input, ctx): input is CurrencyRawConfig => {
			checkCurrencyConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveCurrencyConfig,
	})
	.structure(ctx => checkInsideTrip(ctx, 'Currency'))
	.state(state => state.roundStep({
		validate: (input): input is number => isRoundStep(input),
		default: ({ config }) => config.roundStep,
	}))
	.properties(properties => properties
		.base({ compute: ({ config }) => config.base })
		.rates({ compute: ({ config }) => config.rates })
		.codes({ compute: ({ config }) => config.codes })
		.view({
			registerDeps: ({ dep, blueprint }) => languageReads(dep, blueprint),
			compute: ({ deps, config }) => ({ ...viewFrom(deps), base: config.base }),
		}))
	.methods(methods => methods
		.convert({
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
			validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number' && Number.isFinite(args[0]),
			registerDeps: ({ dep }) => ({ step: dep.self.state.get('roundStep') }),
			execute: ({ args: [cents], deps }) => {
				const step = deps.step()
				return roundToStep(cents, step.ok && step.value !== null ? step.value : 1)
			},
		}))
	.done()
