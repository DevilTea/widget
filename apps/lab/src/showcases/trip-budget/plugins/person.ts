/**
 * `Person`: one member of the trip. A Person has no State of its own: everything about them is derived
 * from the expenses, through declared dependencies on every Expense widget of the trip.
 *
 * - `paid`: the base-currency cents this person paid (the `amountBase` of every counted expense they paid);
 * - `owed`: their share of every counted expense (`shares[their id]`);
 * - `balance`: `paid - owed`. Positive: they get money back, negative: they owe money. This is the link in
 *   the chain from expense lines to the settlement;
 * - `ledger`: a line per expense with what they paid and their share. It is only read when a viewer opens
 *   the ledger, so it is **lazy**: until then the Runtime has never evaluated it.
 *
 * An expense that is not counted (see `Expense.counted`) is left out of all of these.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { PersonConfig, PersonRawConfig } from '../config'
import type { LedgerEntry, PersonLedger, TripView } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkPersonConfig, resolvePersonConfig } from '../config'
import { personConfigSchema } from '../schemas'
import { childIds, isBoolean, isNullableString, isNumber, isNumberRecord, isString, viewFrom, viewReads } from './reads'
import { checkInsideTrip, checkPersonId } from './structure'

export interface PersonInterfaces extends WidgetInterfaces {
	config: { raw: PersonRawConfig, resolved: PersonConfig }
	properties: {
		name: string
		view: TripView
		paid: number
		owed: number
		balance: number
		ledger: PersonLedger
	}
}

export const PersonPlugin = createWidgetPlugin('Person')
	.description('One member of the trip. Properties (all derived from the Expense widgets): `name`, `view`, `paid` (cents they paid), `owed` (their share of the costs), `balance` (`paid - owed`: positive means they get money back) and `ledger` (one line per expense; only evaluated when a viewer opens it).')
	.interfaces<PersonInterfaces>()
	.config({
		description: 'The name shown for this person.',
		schema: personConfigSchema,
		validate: (input, ctx): input is PersonRawConfig => {
			checkPersonConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolvePersonConfig,
	})
	.structure((ctx) => {
		checkInsideTrip(ctx, 'Person')
		checkPersonId(ctx)
	})
	.properties(properties => properties
		.name({ compute: ({ config }) => config.name })
		.view({
			registerDeps: ({ dep, blueprint }) => viewReads(dep, blueprint),
			compute: ({ deps }) => viewFrom(deps),
		})
		.paid({
			registerDeps: ({ dep, blueprint }) => ({
				expenses: Object.fromEntries(childIds(blueprint, 'expenses', 'Expense')
					.map((id) => {
						const expense = dep.widget(id)
						return [id, {
							counted: expense.properties.get('counted')
								.validate(isBoolean),
							paidBy: expense.state.get('paidBy')
								.validate(isNullableString),
							cents: expense.properties.get('amountBase')
								.validate(isNumber),
						}] as const
					})),
			}),
			compute: ({ deps, widget }) => Object.values(deps.expenses)
				.reduce((sum, read) => {
					// `counted` first, then the payer, and the amount only for this person's own expense: an expense
					// that is not counted (or paid by somebody else) is never asked for an `amountBase` that may fail.
					const counted = read.counted()
					if (!counted.ok || !counted.value)
						return sum
					const paidBy = read.paidBy()
					if (!paidBy.ok || paidBy.value !== widget.id)
						return sum
					const cents = read.cents()
					return cents.ok ? sum + cents.value : sum
				}, 0),
		})
		.owed({
			registerDeps: ({ dep, blueprint }) => ({
				expenses: Object.fromEntries(childIds(blueprint, 'expenses', 'Expense')
					.map((id) => {
						const expense = dep.widget(id)
						return [id, {
							shares: expense.properties.get('shares')
								.validate(isNumberRecord),
						}] as const
					})),
			}),
			compute: ({ deps, widget }) => Object.values(deps.expenses)
				.reduce((sum, read) => {
					const shares = read.shares()
					return shares.ok && Object.hasOwn(shares.value, widget.id) ? sum + shares.value[widget.id]! : sum
				}, 0),
		})
		.balance({
			registerDeps: ({ dep }) => ({
				paid: dep.self.properties.get('paid'),
				owed: dep.self.properties.get('owed'),
			}),
			compute: ({ deps }) => {
				const paid = deps.paid()
				const owed = deps.owed()
				return (paid.ok ? paid.value : 0) - (owed.ok ? owed.value : 0)
			},
		})
		.ledger({
			registerDeps: ({ dep, blueprint }) => ({
				expenses: Object.fromEntries(childIds(blueprint, 'expenses', 'Expense')
					.map((id) => {
						const expense = dep.widget(id)
						return [id, {
							title: expense.properties.get('title')
								.validate(isString),
							counted: expense.properties.get('counted')
								.validate(isBoolean),
							paidBy: expense.state.get('paidBy')
								.validate(isNullableString),
							cents: expense.properties.get('amountBase')
								.validate(isNumber),
							shares: expense.properties.get('shares')
								.validate(isNumberRecord),
						}] as const
					})),
			}),
			compute: ({ deps, widget }) => ({
				entries: Object.entries(deps.expenses)
					.flatMap(([expense, read]): LedgerEntry[] => {
						const counted = read.counted()
						if (!counted.ok || !counted.value)
							return []
						const title = read.title()
						const paidBy = read.paidBy()
						// The amount only for an expense this person paid (see `paid`).
						let paidCents = 0
						if (paidBy.ok && paidBy.value === widget.id) {
							const cents = read.cents()
							paidCents = cents.ok ? cents.value : 0
						}
						const shares = read.shares()
						const shareCents = shares.ok && Object.hasOwn(shares.value, widget.id) ? shares.value[widget.id]! : 0
						return paidCents === 0 && shareCents === 0
							? []
							: [{ expense, title: title.ok ? title.value : expense, paidCents, shareCents }]
					}),
			}),
		}))
	.done()
