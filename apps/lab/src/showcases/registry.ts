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
	/**
	 * Test-only fixture: registered (so `?showcase=<id>`, `switchShowcase()` and the Preview frame resolve
	 * it) but never listed in the header's showcase selector and never the default.
	 */
	readonly hidden?: boolean
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
 *
 * `survey` is the default and the only showcase listed in the UI. `sandbox` is a hidden, test-only
 * fixture (minimal Counter/Text/... widgets plus the invalid/raw-slot recovery presets): it is not listed
 * in the showcase selector and is reachable only through `?showcase=sandbox` (see `resolveInitialShowcase`).
 */
export const showcases: readonly ShowcaseEntry[] = [
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
		id: 'sandbox',
		label: 'Sandbox',
		hidden: true,
		system: sandboxSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		renderer: SandboxRenderer as unknown as Component,
		presets: sandboxPresets,
		defaultPreset: defaultSandboxPreset,
		sources: sandboxSources,
	},
]

/** The showcases the header's selector lists: every registered showcase that is not a hidden fixture. */
export const listedShowcases: readonly ShowcaseEntry[] = showcases.filter(showcase => showcase.hidden !== true)

export const defaultShowcase: ShowcaseEntry = listedShowcases[0]!

export function getShowcase(id: string): ShowcaseEntry | undefined {
	return showcases.find(showcase => showcase.id === id)
}

/**
 * The showcase the Lab starts in: the `?showcase=<id>` URL parameter selects any registered showcase
 * (listed or hidden), so e2e can open the hidden `sandbox` fixture without UI. A missing, empty or
 * unknown id falls back to `defaultShowcase`. Read once at startup; the selector does not write the URL.
 */
export function resolveInitialShowcase(search: string): ShowcaseEntry {
	const id = new URLSearchParams(search)
		.get('showcase')
	return (id === null ? undefined : getShowcase(id)) ?? defaultShowcase
}
