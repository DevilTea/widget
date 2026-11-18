/**
 * Dependency helpers shared by the trip-budget plugins.
 *
 * The trip's widgets reach each other only through declared dependencies (`dep.widget(id)`, `dep.root`):
 * a Property that reads another widget's Property is a Property-to-Property edge, which Core shows in
 * Relations and the Graph and reports as a `property-evaluation-cycle` if the edges ever loop.
 *
 * A plugin cannot know the other widgets' ids statically. They come from the Blueprint: the people, the
 * expenses and the Currency are the children of the root `Trip`'s slots (`childIds`, `currencyIdOf`). A
 * child that is not of the expected type, or whose id is shared (Core reports `duplicate-widget-id`), is
 * skipped, because reading it would only add dependency diagnostics on top of the one Core already reports.
 */

import type { BlueprintCompileView, DependencyBuilder, ExecutionResult, PropertyGetDepExpression, WidgetInterfaces } from '@deviltea/widget-core'
import type { TripView } from '../domain'
import { DEFAULT_TRIP_LANGUAGE, tripText } from '../domain'

/** The part of the dependency builder these helpers use; every plugin's Property builder satisfies it. */
export type TripDeps = Pick<DependencyBuilder<WidgetInterfaces, 'property'>, 'widget' | 'root'>

export type TripSlot = 'settings' | 'people' | 'expenses' | 'summary'

export function isString(input: unknown): input is string {
	return typeof input === 'string'
}

export function isBoolean(input: unknown): input is boolean {
	return typeof input === 'boolean'
}

export function isNumber(input: unknown): input is number {
	return typeof input === 'number' && Number.isFinite(input)
}

export function isNullableString(input: unknown): input is string | null {
	return input === null || typeof input === 'string'
}

export function isNullableNumber(input: unknown): input is number | null {
	return input === null || isNumber(input)
}

export function isStringArray(input: unknown): input is readonly string[] {
	return Array.isArray(input) && input.every(isString)
}

export function isNumberRecord(input: unknown): input is Readonly<Record<string, number>> {
	return typeof input === 'object' && input !== null && !Array.isArray(input) && Object.values(input)
		.every(isNumber)
}

/** The ids of the root Trip's children in `slot` that have `type`, in document order. */
export function childIds(blueprint: BlueprintCompileView, slot: TripSlot, type: string): readonly string[] {
	const root = blueprint.root
	if (!root.resolved || root.type !== 'Trip')
		return []
	return blueprint.getChildrenAt(root, slot)
		.flatMap(child => child.resolved && child.type === type && blueprint.getWidget(child.id) !== null ? [child.id] : [])
}

/** The id of the trip's one Currency, or `null` when there is none or more than one (a structure diagnostic). */
export function currencyIdOf(blueprint: BlueprintCompileView): string | null {
	const ids = childIds(blueprint, 'settings', 'Currency')
	return ids.length === 1 ? ids[0]! : null
}

export type LanguageExpression = ReturnType<typeof languageRead>
export type BaseExpression = PropertyGetDepExpression<string, false>

/** The trip language: the root's State `language`. */
export function languageRead(dep: TripDeps) {
	return dep.root.state.get('language')
		.validate(isString)
}

/** `{ language }` when the root is a `Trip`, `{}` otherwise (a widget outside a Trip is already a diagnostic). */
export function languageReads(dep: TripDeps, blueprint: BlueprintCompileView): { readonly language?: LanguageExpression } {
	const root = blueprint.root
	return root.resolved && root.type === 'Trip' ? { language: languageRead(dep) } : {}
}

/** The base currency: the trip's Currency widget's Property `base`. */
export function baseRead(dep: TripDeps, blueprint: BlueprintCompileView): { readonly base?: BaseExpression } {
	const id = currencyIdOf(blueprint)
	return id === null
		? {}
		: { base: dep.widget(id)
				.properties
				.get('base')
				.validate(isString) }
}

/** The currency codes the trip supports: the Currency widget's Property `codes`. */
export function codesRead(dep: TripDeps, blueprint: BlueprintCompileView): { readonly codes?: PropertyGetDepExpression<readonly string[], false> } {
	const id = currencyIdOf(blueprint)
	return id === null
		? {}
		: { codes: dep.widget(id)
				.properties
				.get('codes')
				.validate(isStringArray) }
}

/** `language` and `base` reads of a widget that is not the Currency itself. */
export function viewReads(dep: TripDeps, blueprint: BlueprintCompileView): { readonly language?: LanguageExpression, readonly base?: BaseExpression } {
	return { ...languageReads(dep, blueprint), ...baseRead(dep, blueprint) }
}

const FALLBACK_BASE = 'EUR'

/** The readers of `languageReads`/`viewReads`, as executed dependencies. */
export interface ViewReaders {
	readonly language?: () => ExecutionResult<string | null, unknown>
	readonly base?: () => ExecutionResult<string | null, unknown>
}

function valueOrNull(read: (() => ExecutionResult<string | null, unknown>) | undefined): string | null {
	if (read === undefined)
		return null
	const result = read()
	return result.ok ? result.value : null
}

export function languageFrom(readers: ViewReaders): string {
	return valueOrNull(readers.language) ?? DEFAULT_TRIP_LANGUAGE
}

/** The `view` of a widget from its executed reads; a failed read is already a recorded dependency diagnostic. */
export function viewFrom(readers: ViewReaders): TripView {
	const language = languageFrom(readers)
	return { language, base: valueOrNull(readers.base) ?? FALLBACK_BASE, text: tripText(language) }
}
