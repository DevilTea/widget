/** Test-only helpers for the Vuetify task showcase. */

import type { RuntimeWidget, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { vuetifyTaskPlugins } from './plugins'
import { defaultVuetifyTaskPreset } from './presets'
import { vuetifyTaskSystem } from './system'

type VuetifyTaskRuntime = WidgetSystemRuntime<typeof vuetifyTaskPlugins>
type VuetifyTaskRuntimeWidget = RuntimeWidget<typeof vuetifyTaskPlugins>

export function createVuetifyTaskRuntime(sourceText: string = defaultVuetifyTaskPreset.sourceText): { readonly runtime: VuetifyTaskRuntime } {
	const blueprint = vuetifyTaskSystem.createBlueprint(JSON.parse(sourceText))
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)
	return { runtime: blueprint.createRuntime() }
}

export function widgetOfType<Type extends VuetifyTaskRuntimeWidget['type']>(runtime: VuetifyTaskRuntime, id: string, type: Type): Extract<VuetifyTaskRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<VuetifyTaskRuntimeWidget, { readonly type: Type }>
}
