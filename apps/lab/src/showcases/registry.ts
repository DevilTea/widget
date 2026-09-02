/**
 * Widget Lab showcase registry.
 *
 * Normative source: diagnostic #13 comment "Checkpoint — Showcase A: Interactive Survey (ACCEPTED)"
 * (structure decisions) plus the "Source Apply lifecycle" checkpoint's "Presets / showcase changes"
 * section: "Switching showcases is a larger application-level replacement ... It detaches/disposes the
 * old Runtime, switches showcase context, loads the showcase source, and then uses the same Apply
 * pipeline." Deliberately minimal: no routing, no persistence — just an `{ id, label, system, renderer,
 * presets }` lookup table consumed by `use-lab-store.ts`'s `switchShowcase`.
 */

import type { AnyWidgetPluginTuple, WidgetSystem } from '@deviltea/widget-core'
import type { Component } from 'vue'
import type { SourcesRegistry } from '../implementation/types'
import { defaultSandboxPreset, sandboxPresets } from '../sandbox/presets'
import { SandboxRenderer } from '../sandbox/renderers'
import { sandboxSources } from '../sandbox/sources'
import { sandboxSystem } from '../sandbox/system'
import { crmPresets, defaultCrmPreset } from './crm/presets'
import { CrmRenderer } from './crm/renderers'
import { crmSources } from './crm/sources'
import { crmSystem } from './crm/system'
import { defaultSurveyPreset, surveyPresets } from './survey/presets'
import { SurveyRenderer } from './survey/renderers'
import { surveySources } from './survey/sources'
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
	/**
	 * Curated Implementation-explorer registry (diagnostic #25 P3 Scope A) — metadata only (plugin type ->
	 * file descriptors with lazy `load()` thunks, see `implementation/types.ts`), trivially small, so
	 * this field is safe to keep eager alongside the rest of `ShowcaseEntry` without pulling any raw
	 * source text or Shiki into the eager/shared chunk graph.
	 */
	readonly sources: SourcesRegistry
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
		sources: sandboxSources,
	},
	{
		id: 'survey',
		label: 'Interactive Survey',
		system: surveySystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		renderer: SurveyRenderer as unknown as Component,
		presets: surveyPresets,
		defaultPreset: defaultSurveyPreset,
		sources: surveySources,
	},
	{
		id: 'crm',
		label: 'Product Prototype',
		system: crmSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		renderer: CrmRenderer as unknown as Component,
		presets: crmPresets,
		defaultPreset: defaultCrmPreset,
		sources: crmSources,
	},
]

export const defaultShowcase: ShowcaseEntry = showcases[0]!

export function getShowcase(id: string): ShowcaseEntry | undefined {
	return showcases.find(showcase => showcase.id === id)
}
