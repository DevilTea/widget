/**
 * `Expense`: one expense line. The viewer's input is State: `amount`, `currency`, `paidBy` and, for an equal
 * split, `among` (who shares it). Each starts at the value the config authored, which is also what
 * `resetState()` restores.
 *
 * The chain of Properties that leads to the settlement starts here:
 *
 *   `Currency.convert` (read-only Method) -> `amountBase` -> `shares` -> `Person.owed` / `Person.paid`
 *   -> `Person.balance` -> `Settlement.balances` -> `Settlement.transfers`
 *
 * - `amountBase`: the amount in minor units of the base currency, converted by calling the Currency's
 *   read-only Method `convert`. An amount that cannot be counted is not converted at all, so the Method is
 *   not even called;
 * - `problem`, `counted`, `errors`: whether the current input can be counted (an amount, no negative
 *   amount, somebody sharing it, somebody who paid). A negative or missing amount is stored and reported,
 *   never refused, like the survey's answer errors. `counted` depends on nothing that can fail, and every
 *   consumer (`shares`, `breakdown`, `Person.paid`/`ledger`, `Settlement.total`) checks it **before** it reads
 *   `amountBase`: a failed dependency fails the consumer only when the consumer calls it, so an expense that is
 *   not counted never takes the settlement down, even when its currency has no rate;
 * - `shares`: each participant's share in cents (equal or by percent), which add up to `amountBase`;
 * - `breakdown`: how the amount was converted and split, line by line. It is only read when a viewer opens
 *   it, so it is **lazy**: the Runtime has never evaluated it until someone looks.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { ExpenseConfig, ExpenseRawConfig } from '../config'
import type { ExpenseBreakdown, ExpenseProblem, ExpenseProblemCode, RosterEntry, TripView } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkExpenseConfig, resolveExpenseConfig } from '../config'
import { CURRENCY_CODE_PATTERN, equalLeftover, expenseProblemCode, expenseProblemText, isPersonId, localize, percentLeftover, splitByPercent, splitEqually, tripText } from '../domain'
import { expenseConfigSchema } from '../schemas'
import { childIds, codesRead, currencyIdOf, isNumber, isNumberRecord, isString, languageFrom, languageReads, viewFrom, viewReads } from './reads'
import { checkInsideTrip, isPersonIn } from './structure'

export interface ExpenseInterfaces extends WidgetInterfaces {
	config: { raw: ExpenseRawConfig, resolved: ExpenseConfig }
	state: {
		amount: number | null
		currency: string
		paidBy: string | null
		among: readonly string[]
	}
	properties: {
		title: string
		view: TripView
		roster: readonly RosterEntry[]
		currencies: readonly string[]
		participants: readonly string[]
		problem: ExpenseProblemCode | null
		counted: boolean
		errors: readonly ExpenseProblem[]
		amountBase: number
		shares: Readonly<Record<string, number>>
		breakdown: ExpenseBreakdown
	}
}

export const ExpensePlugin = createWidgetPlugin('Expense')
	.description('One expense line. State: `amount`, `currency`, `paidBy` and (equal split) `among`, each starting at the authored value. Properties: `title`, `view`, `roster` (the people), `currencies` (the codes the Currency supports), `participants`, `problem`/`counted`/`errors` (whether the input can be counted), `amountBase` (cents in the base currency, converted by the Currency\'s read-only Method `convert`), `shares` (each person\'s cents) and `breakdown` (the conversion and split in detail; only evaluated when a viewer opens it).')
	.interfaces<ExpenseInterfaces>()
	.config({
		description: 'The title per language, the starting amount and currency, who paid, and how it is split: equally among some people or by percentages that add up to 100.',
		schema: expenseConfigSchema,
		validate: (input, ctx): input is ExpenseRawConfig => {
			checkExpenseConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveExpenseConfig,
	})
	.structure((ctx) => {
		checkInsideTrip(ctx, 'Expense')
		const { blueprint, addDiagnostic } = ctx
		const config = ctx.config
		// A recovered config is the fallback of a config that already has its own diagnostic.
		if (config.recovered)
			return
		if (!isPersonIn(blueprint, config.paidBy))
			addDiagnostic({ message: `config.paidBy: "${config.paidBy}" is not a Person of this trip.`, reason: 'unknown-person' })
		for (const id of config.participants) {
			if (!isPersonIn(blueprint, id))
				addDiagnostic({ message: `${config.split.mode === 'equal' ? 'config.split.among' : 'config.split.percents'}: "${id}" is not a Person of this trip.`, reason: 'unknown-person' })
		}
	})
	.state(state => state
		.amount({
			validate: (input): input is number | null => input === null || (typeof input === 'number' && Number.isFinite(input)),
			default: ({ config }) => config.recovered ? null : config.amount,
		})
		.currency({
			validate: (input): input is string => typeof input === 'string' && CURRENCY_CODE_PATTERN.test(input),
			default: ({ config }) => config.currency,
		})
		.paidBy({
			validate: (input): input is string | null => input === null || isPersonId(input),
			default: ({ config }) => config.paidBy === '' ? null : config.paidBy,
		})
		.among({
			validate: (input): input is readonly string[] => Array.isArray(input) && input.every(isPersonId) && new Set(input).size === input.length,
			default: ({ config }) => config.split.mode === 'equal' ? config.split.among : [],
		}))
	.properties(properties => properties
		.title({
			registerDeps: ({ dep, blueprint }) => languageReads(dep, blueprint),
			compute: ({ deps, config }) => localize(config.title, languageFrom(deps)),
		})
		.view({
			registerDeps: ({ dep, blueprint }) => viewReads(dep, blueprint),
			compute: ({ deps }) => viewFrom(deps),
		})
		.roster({
			registerDeps: ({ dep, blueprint }) => ({
				people: Object.fromEntries(childIds(blueprint, 'people', 'Person')
					.map(id => [id, dep.widget(id)
						.properties
						.get('name')
						.validate(isString)] as const)),
			}),
			compute: ({ deps }) => Object.entries(deps.people)
				.map(([id, name]) => {
					const result = name()
					return { id, name: result.ok ? result.value : id }
				}),
		})
		.currencies({
			registerDeps: ({ dep, blueprint }) => codesRead(dep, blueprint),
			compute: ({ deps }) => {
				const codes = deps.codes?.()
				return codes?.ok === true ? codes.value : []
			},
		})
		.participants({
			// Only an equal split reads State `among` and the roster; a percent split names its people in the config.
			registerDeps: ({ dep, config }) => ({
				...(config.split.mode === 'equal' ? { among: dep.self.state.get('among'), roster: dep.self.properties.get('roster') } : {}),
			}),
			compute: ({ deps, config }) => {
				if (config.split.mode === 'percent')
					return Object.keys(config.split.percents)
				const among = deps.among?.()
				const roster = deps.roster?.()
				if (among === undefined || roster === undefined || !among.ok || among.value === null || !roster.ok)
					return []
				// Roster order, so the person who gets a leftover cent does not depend on the order of the clicks.
				return roster.value.map(entry => entry.id)
					.filter(id => among.value!.includes(id))
			},
		})
		.problem({
			registerDeps: ({ dep }) => ({
				amount: dep.self.state.get('amount'),
				paidBy: dep.self.state.get('paidBy'),
				participants: dep.self.properties.get('participants'),
			}),
			compute: ({ deps }) => {
				const amount = deps.amount()
				const paidBy = deps.paidBy()
				const participants = deps.participants()
				return expenseProblemCode({
					amount: amount.ok ? amount.value : null,
					paidBy: paidBy.ok ? paidBy.value : null,
					participants: participants.ok ? participants.value : [],
				})
			},
		})
		.counted({
			registerDeps: ({ dep }) => ({ problem: dep.self.properties.get('problem') }),
			compute: ({ deps }) => {
				const problem = deps.problem()
				return problem.ok && problem.value === null
			},
		})
		.errors({
			registerDeps: ({ dep, blueprint }) => ({
				problem: dep.self.properties.get('problem'),
				...languageReads(dep, blueprint),
			}),
			compute: ({ deps }) => {
				const problem = deps.problem()
				return problem.ok && problem.value !== null
					? [{ code: problem.value, message: expenseProblemText(problem.value, tripText(languageFrom(deps))) }]
					: []
			},
		})
		.amountBase({
			registerDeps: ({ dep, blueprint }) => {
				const currency = currencyIdOf(blueprint)
				return {
					amount: dep.self.state.get('amount'),
					currency: dep.self.state.get('currency'),
					// The read-only Method of the trip's Currency widget. A Property may depend on a Method only if
					// it neither writes State nor emits an Event; Core checks that when the Blueprint is compiled.
					...(currency === null
						? {}
						: { convert: dep.widget(currency)
								.methods
								.invoke('convert')
								.validate(isNumber) }),
				}
			},
			compute: ({ deps }) => {
				const amount = deps.amount()
				const currency = deps.currency()
				if (!amount.ok || amount.value === null || amount.value < 0 || !currency.ok || currency.value === null || deps.convert === undefined)
					return 0
				// A failed call (a currency with no rate) is already recorded as a dependency diagnostic: this
				// Property fails with it, and so does everything that reads it.
				const converted = deps.convert(amount.value, currency.value)
				return converted.ok ? converted.value : 0
			},
		})
		.shares({
			registerDeps: ({ dep, config }) => ({
				counted: dep.self.properties.get('counted'),
				total: dep.self.properties.get('amountBase'),
				// Only an equal split reads who shares; a percent split uses the authored percentages.
				...(config.split.mode === 'equal' ? { participants: dep.self.properties.get('participants') } : {}),
			}),
			compute: ({ deps, config }) => {
				// An expense that is not counted is left out before its amount is read: its `amountBase` may
				// fail (a currency with no rate) and a consumer that never calls the failing read does not fail.
				const counted = deps.counted()
				if (!counted.ok || !counted.value)
					return {}
				const total = deps.total()
				if (!total.ok)
					return {}
				if (config.split.mode === 'percent')
					return splitByPercent(total.value, config.split.percents)
				const participants = deps.participants?.()
				return participants?.ok === true ? splitEqually(total.value, participants.value) : {}
			},
		})
		.breakdown({
			registerDeps: ({ dep, blueprint }) => {
				const currency = currencyIdOf(blueprint)
				return {
					amount: dep.self.state.get('amount'),
					currency: dep.self.state.get('currency'),
					counted: dep.self.properties.get('counted'),
					total: dep.self.properties.get('amountBase'),
					shares: dep.self.properties.get('shares'),
					roster: dep.self.properties.get('roster'),
					...(currency === null
						? {}
						: {
								base: dep.widget(currency)
									.properties
									.get('base')
									.validate(isString),
								rates: dep.widget(currency)
									.properties
									.get('rates')
									.validate(isNumberRecord),
							}),
				}
			},
			compute: ({ deps, config }): ExpenseBreakdown => {
				const empty: ExpenseBreakdown = { conversion: null, totalCents: 0, lines: [], remainderCents: 0 }
				// Not counted: nothing to explain, and nothing that can fail is read (see `shares`).
				const counted = deps.counted()
				if (!counted.ok || !counted.value)
					return empty
				const total = deps.total()
				const shares = deps.shares()
				const roster = deps.roster()
				const amount = deps.amount()
				const currency = deps.currency()
				const base = deps.base?.()
				const rates = deps.rates?.()
				if (!total.ok || !shares.ok || !roster.ok || !amount.ok || amount.value === null || !currency.ok || currency.value === null)
					return empty
				const rate = rates?.ok === true && Object.hasOwn(rates.value, currency.value) ? rates.value[currency.value] : undefined
				const conversion = base?.ok === true && base.value !== currency.value && rate !== undefined
					? { amount: amount.value, currency: currency.value, rate, baseCents: total.value }
					: null
				const names = new Map(roster.value.map(entry => [entry.id, entry.name]))
				const percents = config.split.mode === 'percent' ? config.split.percents : null
				return {
					conversion,
					totalCents: total.value,
					lines: Object.entries(shares.value)
						.map(([id, cents]) => ({ id, name: names.get(id) ?? id, cents, percent: percents !== null && Object.hasOwn(percents, id) ? percents[id]! : null })),
					remainderCents: percents === null
						? equalLeftover(total.value, Object.keys(shares.value).length)
						: percentLeftover(total.value, percents),
				}
			},
		}))
	.done()
