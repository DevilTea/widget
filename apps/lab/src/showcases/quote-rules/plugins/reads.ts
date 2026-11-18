/**
 * Dependency helpers shared by the quote plugins.
 *
 * The widgets reach each other only through declared dependencies (`dep.widget(id)`, `dep.root`), so Relations
 * and the Graph show the whole pricing chain:
 *
 *   Item.line -> Quote.subtotalCents, Quote.totalQuantity
 *   Quote.subtotalCents, Quote.totalQuantity -> VolumeDiscount / RushSurcharge / Delivery `.adjustment`
 *   those adjustments -> Quote.taxableCents -> SalesTax.adjustment
 *   everything -> Quote.quote
 *
 * The widgets are not one Property loop although Quote reads its children and they read Quote: Core's cycle check
 * is over members, and no member depends on itself (`Quote.taxableCents` reads the three pre-tax rules, never the tax).
 *
 * A plugin cannot know the other widgets' ids statically: they come from the Blueprint, as the children of the root
 * Quote's slots. A child of another type, or one whose id is shared (Core reports `duplicate-widget-id`), is skipped,
 * because reading it would only add dependency diagnostics on top of the one Core already reports.
 */

import type { BlueprintCompileView, DependencyBuilder, ExecutionResult, PropertyGetDepExpression, WidgetInterfaces } from '@deviltea/widget-core'

export type QuoteDeps = Pick<DependencyBuilder<WidgetInterfaces, 'property'>, 'widget' | 'root'>

export const PRE_TAX_RULE_TYPES = ['VolumeDiscount', 'RushSurcharge', 'Delivery'] as const
export const RULE_TYPES = [...PRE_TAX_RULE_TYPES, 'SalesTax'] as const
export type RuleType = typeof RULE_TYPES[number]

export type QuoteSlot = 'items' | 'rules'

export function isNumber(input: unknown): input is number {
	return typeof input === 'number' && Number.isFinite(input)
}

/** The ids of the root Quote's children in `slot` whose type is one of `types`, in document order. */
export function childIds(blueprint: BlueprintCompileView, slot: QuoteSlot, types: readonly string[]): readonly string[] {
	const root = blueprint.root
	if (!root.resolved || root.type !== 'Quote')
		return []
	return blueprint.getChildrenAt(root, slot)
		.flatMap(child => child.resolved && types.includes(child.type) && blueprint.getWidget(child.id) !== null ? [child.id] : [])
}

/** `true` when the root of the Blueprint is a Quote (a rule outside one is already a structure diagnostic). */
export function hasQuoteRoot(blueprint: BlueprintCompileView): boolean {
	const root = blueprint.root
	return root.resolved && root.type === 'Quote'
}

export type NumberExpression = PropertyGetDepExpression<number, false>

/** The root Quote's Property `subtotalCents`, or nothing when the root is not a Quote. */
export function subtotalReads(dep: QuoteDeps, blueprint: BlueprintCompileView): { readonly subtotalCents?: NumberExpression } {
	return hasQuoteRoot(blueprint)
		? { subtotalCents: dep.root.properties.get('subtotalCents')
				.validate(isNumber) }
		: {}
}

/** The root Quote's Property `totalQuantity`, or nothing when the root is not a Quote. */
export function quantityReads(dep: QuoteDeps, blueprint: BlueprintCompileView): { readonly totalQuantity?: NumberExpression } {
	return hasQuoteRoot(blueprint)
		? { totalQuantity: dep.root.properties.get('totalQuantity')
				.validate(isNumber) }
		: {}
}

/** The root Quote's Property `taxableCents`, or nothing when the root is not a Quote. */
export function taxableReads(dep: QuoteDeps, blueprint: BlueprintCompileView): { readonly taxableCents?: NumberExpression } {
	return hasQuoteRoot(blueprint)
		? { taxableCents: dep.root.properties.get('taxableCents')
				.validate(isNumber) }
		: {}
}

/** The value of a dependency read, or `fallback` when it failed (that failure is already a recorded diagnostic). */
export function valueOr<Value>(read: (() => ExecutionResult<Value | null, unknown>) | undefined, fallback: Value): Value {
	if (read === undefined)
		return fallback
	const result = read()
	return result.ok && result.value !== null ? result.value : fallback
}
