/**
 * Shared test-only fixtures for the Product Prototype showcase's colocated `*.unit.test.ts` files. Not
 * itself a test file, and never imported by application code — mirrors
 * `../survey/test-support.ts`'s role for its own colocated tests. Every test builds a real
 * `@deviltea/widget-core` Blueprint/Runtime against `crmSystem`; nothing here mocks core.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { defaultCrmPreset } from './presets'
import { crmSystem } from './system'

export function createCrmRuntime(sourceText: string = defaultCrmPreset.sourceText): {
	readonly runtime: WidgetSystemRuntime
} {
	const definition: unknown = JSON.parse(sourceText)
	const blueprint = crmSystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	return { runtime: blueprint.createRuntime() }
}

/**
 * `runtime.getWidget(id)` is typed as the union of every registered plugin's `RuntimeWidget` shape
 * (there is no id-to-type static link) — this narrows it the same way
 * `../survey/test-support.ts`'s `widgetOfType` does, via the discriminated `.type` literal, so callers
 * get the exact `state`/`properties`/`methods` surface for `type`.
 */
export function widgetOfType<Type extends string>(runtime: WidgetSystemRuntime, id: string, type: Type) {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<NonNullable<ReturnType<WidgetSystemRuntime['getWidget']>>, { readonly type: Type }>
}
