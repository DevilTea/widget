/**
 * Shared test-only fixtures for the trip-budget showcase's colocated `*.unit.test.ts` files. Not itself a
 * test file, and never imported by application code. Every test builds a real `@deviltea/widget-core`
 * Blueprint/Runtime against `tripBudgetSystem`; nothing here mocks Core.
 */

import type { RuntimeWidget } from '@deviltea/widget-core'
import type { tripBudgetPlugins } from './plugins'
import type { TripRuntime } from './system'
import { defaultTripBudgetPreset } from './presets'
import { tripBudgetSystem } from './system'

export type { TripRuntime }
type TripRuntimeWidget = RuntimeWidget<typeof tripBudgetPlugins>

/** A Runtime for a source object; throws unless the Blueprint is valid. */
export function createRuntimeFor(source: unknown): { readonly runtime: TripRuntime } {
	const blueprint = tripBudgetSystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics.map(({ code, message }) => ({ code, message })))}`)
	return { runtime: blueprint.createRuntime() }
}

/** A Runtime for `sourceText` (the default preset when omitted); throws unless the Blueprint is valid. */
export function createTripRuntime(sourceText: string = defaultTripBudgetPreset.sourceText): { readonly runtime: TripRuntime } {
	return createRuntimeFor(JSON.parse(sourceText))
}

/** The value of a successful Property or Method result; throws with the failure otherwise. */
export function valueOf<Value>(result: { readonly ok: true, readonly value: Value } | { readonly ok: false, readonly failure: unknown }): Value {
	if (!result.ok)
		throw new Error(`Expected an ok result, got ${JSON.stringify(result.failure)}`)
	return result.value
}

/**
 * `runtime.getWidget(id)` is typed as the union of every registered plugin's `RuntimeWidget` shape; this
 * narrows it by the `type` literal so callers get the exact `state`/`properties`/`methods`.
 */
export function widgetOfType<Type extends TripRuntimeWidget['type']>(runtime: TripRuntime, id: string, type: Type): Extract<TripRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<TripRuntimeWidget, { readonly type: Type }>
}

/** The default preset's definition, parsed so a test can change one part and re-serialize it. */
export function defaultDocument(): any {
	return JSON.parse(defaultTripBudgetPreset.sourceText)
}

/** One expense of a parsed document. */
export function expenseOf(document: any, id: string): any {
	return document.slots.expenses.find((candidate: { id: string }) => candidate.id === id)
}
