/** Test-only helpers for the Vuetify task showcase. */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import { defaultVuetifyTaskPreset } from './presets'
import { vuetifyTaskSystem } from './system'

export function createVuetifyTaskRuntime(sourceText: string = defaultVuetifyTaskPreset.sourceText): { readonly runtime: WidgetSystemRuntime } {
	const blueprint = vuetifyTaskSystem.createBlueprint(JSON.parse(sourceText))
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)
	return { runtime: blueprint.createRuntime() }
}

export function widgetOfType<Type extends string>(runtime: WidgetSystemRuntime, id: string, type: Type) {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<NonNullable<ReturnType<WidgetSystemRuntime['getWidget']>>, { readonly type: Type }>
}
