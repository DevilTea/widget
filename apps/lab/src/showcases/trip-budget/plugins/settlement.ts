/**
 * `Settlement`: the end of the chain. It has no State and no config; its Properties read the Persons and
 * the Currency:
 *
 * - `balances`: every person's `balance` (cents; positive means they get money back);
 * - `total`: what the trip cost, the sum of every counted expense's `amountBase`;
 * - `transfers`: who pays whom to clear the balances. The exact payments come from `settle()`, and each one
 *   is then rounded by calling the Currency's read-only Method `roundTransfer`, so changing the Currency's
 *   `roundStep` changes the payments. `roundingGapCents` says how far the rounded payments are from the
 *   exact ones, so rounding is visible and never silent.
 *
 * Because every number here is a Property of a widget it depends on, Relations and the Graph show the whole
 * chain, and an edit anywhere upstream reaches the summary without any code in a renderer.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { BalanceEntry, SettlementOutcome, TripView } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { balanceEntryDocs, settlementOutcomeDocs, tripViewDocs } from '../docs'
import { settle } from '../domain'
import { childIds, currencyIdOf, isBoolean, isNumber, isString, viewFrom, viewReads } from './reads'
import { checkInsideTrip } from './structure'

export interface SettlementInterfaces extends WidgetInterfaces {
	properties: {
		view: TripView
		balances: readonly BalanceEntry[]
		total: number
		transfers: SettlementOutcome
	}
}

export const SettlementPlugin = createWidgetPlugin('Settlement')
	.description('The settlement summary. Properties: `view`, `balances` (every person\'s balance in cents), `total` (what the trip cost) and `transfers` (who pays whom, rounded to the Currency\'s `roundStep` by calling its read-only Method `roundTransfer`, with the rounding gap).')
	.interfaces<SettlementInterfaces>()
	.structure(ctx => checkInsideTrip(ctx, 'Settlement'))
	.properties(properties => properties
		.view({
			description: 'The trip language and the base currency, derived from the root Trip and the Currency.',
			ref: tripViewDocs,
			registerDeps: ({ dep, blueprint }) => viewReads(dep, blueprint),
			compute: ({ deps }) => viewFrom(deps),
		})
		.balances({
			description: 'Every person\'s balance in cents; positive means they get money back.',
			items: { ref: balanceEntryDocs },
			registerDeps: ({ dep, blueprint }) => ({
				people: Object.fromEntries(childIds(blueprint, 'people', 'Person')
					.map((id) => {
						const person = dep.widget(id)
						return [id, {
							name: person.properties.get('name')
								.validate(isString),
							balance: person.properties.get('balance')
								.validate(isNumber),
						}] as const
					})),
			}),
			compute: ({ deps }) => Object.entries(deps.people)
				.map(([id, read]) => {
					const name = read.name()
					const balance = read.balance()
					return { id, name: name.ok ? name.value : id, cents: balance.ok ? balance.value : 0 }
				}),
		})
		.total({
			description: 'What the trip cost: the sum of every counted expense\'s `amountBase`.',
			registerDeps: ({ dep, blueprint }) => ({
				expenses: Object.fromEntries(childIds(blueprint, 'expenses', 'Expense')
					.map((id) => {
						const expense = dep.widget(id)
						return [id, {
							counted: expense.properties.get('counted')
								.validate(isBoolean),
							cents: expense.properties.get('amountBase')
								.validate(isNumber),
						}] as const
					})),
			}),
			compute: ({ deps }) => Object.values(deps.expenses)
				.reduce((sum, read) => {
					// `counted` first: an expense that is not counted is never asked for an `amountBase` that may fail.
					const counted = read.counted()
					if (!counted.ok || !counted.value)
						return sum
					const cents = read.cents()
					return cents.ok ? sum + cents.value : sum
				}, 0),
		})
		.transfers({
			description: 'Who pays whom to clear the balances, each payment rounded to the Currency\'s `roundStep`, with the rounding gap.',
			ref: settlementOutcomeDocs,
			registerDeps: ({ dep, blueprint }) => {
				const currency = currencyIdOf(blueprint)
				return {
					balances: dep.self.properties.get('balances'),
					// The Currency's read-only Method, called once per payment inside `compute`.
					...(currency === null
						? {}
						: { round: dep.widget(currency)
								.methods
								.invoke('roundTransfer')
								.validate(isNumber) }),
				}
			},
			compute: ({ deps }): SettlementOutcome => {
				const balances = deps.balances()
				if (!balances.ok)
					return { transfers: [], roundingGapCents: 0 }
				const names = new Map(balances.value.map(entry => [entry.id, entry.name]))
				const rounded = settle(balances.value)
					.map((transfer) => {
						const result = deps.round === undefined ? undefined : deps.round(transfer.cents)
						return {
							from: transfer.from,
							fromName: names.get(transfer.from) ?? transfer.from,
							to: transfer.to,
							toName: names.get(transfer.to) ?? transfer.to,
							exactCents: transfer.cents,
							cents: result?.ok === true ? result.value : transfer.cents,
						}
					})
				// A payment that rounds to nothing is not listed, but what it left over still counts in the gap.
				return {
					transfers: rounded.filter(transfer => transfer.cents > 0),
					roundingGapCents: rounded.reduce((sum, transfer) => sum + transfer.exactCents - transfer.cents, 0),
				}
			},
		}))
	.done()
