/**
 * The structure validators the trip-budget plugins share.
 *
 * Only a structure validator receives the Blueprint, so every rule that looks at another widget lives here;
 * each is an `invalid-widget-structure` diagnostic with a machine-readable `reason` (structure diagnostics
 * carry no config `path`, so the path is in the message):
 * - `outside-trip`: a Person, Expense, Currency or Settlement must be a child of the root `Trip`;
 * - `person-id-format`: person ids are keys of `shares` and `percents`, so they stay boring;
 * - `unknown-person`: `paidBy` and every participant of an Expense must be the id of a Person;
 * - `trip-not-root`: a Trip is the root;
 * - the Trip slots: `settings` has exactly one Currency, `people` only Persons, `expenses` only Expenses,
 *   `summary` at most one Settlement.
 *
 * What is deliberately left to Core: a missing or ambiguous dependency target and a Property loop are
 * dependency diagnostics (`missing-dependency-target`, `property-evaluation-cycle`).
 */

import type { BlueprintCompileView } from '@deviltea/widget-core'
import { PERSON_ID_PATTERN } from '../domain'

type NodeView = Parameters<BlueprintCompileView['getParent']>[0]

export interface TripStructureContext {
	readonly widget: NodeView
	readonly blueprint: BlueprintCompileView
	readonly addDiagnostic: (diagnostic: { readonly message: string, readonly reason?: string }) => void
}

/** A widget that must sit directly under a `Trip` (`type` names the widget for the message). */
export function checkInsideTrip({ widget, blueprint, addDiagnostic }: TripStructureContext, type: string): void {
	const parent = blueprint.getParent(widget)
	if (parent === null || (parent.resolved && parent.type !== 'Trip'))
		addDiagnostic({ message: `A ${type} must be placed in a Trip.`, reason: 'outside-trip' })
}

export function checkPersonId({ widget, addDiagnostic }: TripStructureContext): void {
	const id = widget.id ?? ''
	if (!PERSON_ID_PATTERN.test(id))
		addDiagnostic({ message: `Person id "${id}" must start with a lowercase letter and use only a-z, 0-9 and "-".`, reason: 'person-id-format' })
}

/** `true` when `id` is the id of a Person in this Blueprint. */
export function isPersonIn(blueprint: BlueprintCompileView, id: string): boolean {
	const target = blueprint.getWidget(id)
	return target !== null && target.resolved && target.type === 'Person'
}
