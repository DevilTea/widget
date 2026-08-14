/**
 * Widget Lab showcase registry.
 *
 * Normative source: issue #13 comment "Checkpoint — Showcase A: Interactive Survey (ACCEPTED)"
 * (structure decisions) plus the "Source Apply lifecycle" checkpoint's "Presets / showcase changes"
 * section: "Switching showcases is a larger application-level replacement ... It detaches/disposes the
 * old Runtime, switches showcase context, loads the showcase source, and then uses the same Apply
 * pipeline." Deliberately minimal: no routing, no persistence — just an `{ id, label, system, renderer,
 * presets }` lookup table consumed by `use-lab-store.ts`'s `switchShowcase`.
 */

import type { AnyWidgetPluginTuple, WidgetSystem } from '@deviltea/widget-core'
import type { Component } from 'vue'
import { defaultSandboxPreset, sandboxPresets } from '../sandbox/presets'
import { SandboxRenderer } from '../sandbox/renderers'
import { sandboxSystem } from '../sandbox/system'
import { crmPresets, defaultCrmPreset } from './crm/presets'
import { CrmRenderer } from './crm/renderers'
import { crmSystem } from './crm/system'
import { defaultSurveyPreset, surveyPresets } from './survey/presets'
import { SurveyRenderer } from './survey/renderers'
import { surveySystem } from './survey/system'

export interface ShowcasePreset {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly sourceText: string
}

export interface ShowcaseEntry {
	readonly id: string
	readonly label: string
	readonly system: WidgetSystem<AnyWidgetPluginTuple>
	/** The component `createWidgetVueRenderer` returned for this showcase's system. */
	readonly renderer: Component
	readonly presets: readonly ShowcasePreset[]
	readonly defaultPreset: ShowcasePreset
}

/**
 * `WidgetSystem<Plugins>` is erased to `WidgetSystem<AnyWidgetPluginTuple>` here on purpose: the
 * registry is a runtime lookup table across showcases with different plugin universes, and every
 * consumer (`LabSession`, `createWidgetVueRenderer`'s own `runtime.blueprint.system === system`
 * identity check) only ever needs object identity, never the precise literal-type union.
 */
export const showcases: readonly ShowcaseEntry[] = [
	{
		id: 'sandbox',
		label: 'Sandbox',
		system: sandboxSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		renderer: SandboxRenderer as unknown as Component,
		presets: sandboxPresets,
		defaultPreset: defaultSandboxPreset,
	},
	{
		id: 'survey',
		label: 'Interactive Survey',
		system: surveySystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		renderer: SurveyRenderer as unknown as Component,
		presets: surveyPresets,
		defaultPreset: defaultSurveyPreset,
	},
	{
		id: 'crm',
		label: 'Product Prototype',
		system: crmSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		renderer: CrmRenderer as unknown as Component,
		presets: crmPresets,
		defaultPreset: defaultCrmPreset,
	},
]

export const defaultShowcase: ShowcaseEntry = showcases[0]!

export function getShowcase(id: string): ShowcaseEntry | undefined {
	return showcases.find(showcase => showcase.id === id)
}
