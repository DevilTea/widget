/**
 * The structure validators the quote plugins share.
 *
 * Only a structure validator receives the Blueprint, so every rule that looks at another widget lives here.
 * Each is an `invalid-widget-structure` diagnostic with a machine-readable `reason`:
 * - `outside-quote`: an Item or a rule must be a child of the root `Quote`;
 * - `quote-not-root`: a Quote is the root;
 * - the Quote slots: `items` holds only Items (at least one), `rules` only the four rule types, each at most once.
 *
 * What is left to Core: a missing or ambiguous dependency target and a Property loop (`missing-dependency-target`,
 * `property-evaluation-cycle`).
 */

import type { BlueprintCompileView } from '@deviltea/widget-core'

type NodeView = Parameters<BlueprintCompileView['getParent']>[0]

export interface QuoteStructureContext {
	readonly widget: NodeView
	readonly blueprint: BlueprintCompileView
	readonly addDiagnostic: (diagnostic: { readonly message: string, readonly reason?: string }) => void
}

/** A widget that must sit directly under a `Quote` (`type` names the widget for the message). */
export function checkInsideQuote({ widget, blueprint, addDiagnostic }: QuoteStructureContext, type: string): void {
	const parent = blueprint.getParent(widget)
	if (parent === null || (parent.resolved && parent.type !== 'Quote'))
		addDiagnostic({ message: `A ${type} must be placed in a Quote.`, reason: 'outside-quote' })
}
