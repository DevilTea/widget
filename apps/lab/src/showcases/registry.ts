/**
 * Widget Lab showcase registry.
 *
 * Normative source: diagnostic #13 comment "Checkpoint — Showcase A: Interactive Survey (ACCEPTED)"
 * (structure decisions) plus the "Source Apply lifecycle" checkpoint's "Presets / showcase changes"
 * section: "Switching showcases is a larger application-level replacement ... It detaches/disposes the
 * old Runtime, switches showcase context, loads the showcase source, and then uses the same Apply
 * pipeline." Deliberately minimal: no routing, no persistence — just an `{ id, label, system,
 * presets }` lookup table consumed by `use-lab-store.ts`'s `switchShowcase`.
 *
 * Each entry also carries what Core 0.3 no longer publishes: the plugin documentation generated from the System's
 * `Interfaces` JSDoc (`virtual:widget-docs/<id>`, served by `widgetDocs({ slim: true })`, see `../../widget-docs.ts`) and the
 * config JSON Schemas (`configSchemas`, by plugin type), which are the generated ones (`docs.plugins[type].config.schema`)
 * unless the entry overrides them.
 *
 * Shell-safe by construction: it imports no renderer, so no showcase component or stylesheet reaches the Lab shell
 * document. A showcase's renderer is loaded only inside the Preview frame, through `preview-frame-renderers.ts`.
 */

import type { AnyWidgetPluginTuple, WidgetSystem } from '@deviltea/widget-core'
import type { WidgetDocs } from '../author/widget-docs'
import type { ConfigSchemaMap, SourcesRegistry } from '../showcase-host'
import documentRepairDocs from 'virtual:widget-docs/document-repair'
import onboardingDocs from 'virtual:widget-docs/onboarding'
import quoteRulesDocs from 'virtual:widget-docs/quote-rules'
import rendererPacksDocs from 'virtual:widget-docs/renderer-packs'
import sandboxDocs from 'virtual:widget-docs/sandbox'
import surveyDocs from 'virtual:widget-docs/survey'
import tripBudgetDocs from 'virtual:widget-docs/trip-budget'
import { defaultSandboxPreset, sandboxPresets } from '../sandbox/presets'
import { sandboxSources } from '../sandbox/sources'
import { sandboxSystem } from '../sandbox/system'
import { defaultRepairPreset, repairPresets } from './document-repair/presets'
import { repairSources } from './document-repair/sources'
import { repairSystem } from './document-repair/system'
import { defaultOnboardingPreset, onboardingPresets } from './onboarding/presets'
import { onboardingSources } from './onboarding/sources'
import { onboardingSystem } from './onboarding/system'
import { defaultQuotePreset, quotePresets } from './quote-rules/presets'
import { quoteConfigSchemas } from './quote-rules/schemas'
import { quoteSources } from './quote-rules/sources'
import { quoteSystem } from './quote-rules/system'
import { defaultPacksPreset, packsPresets } from './renderer-packs/presets'
import { packsSources } from './renderer-packs/sources'
import { packsSystem } from './renderer-packs/system'
import { defaultSurveyPreset, surveyPresets } from './survey/presets'
import { surveySources } from './survey/sources'
import { surveySystem } from './survey/system'
import { defaultTripBudgetPreset, tripBudgetPresets } from './trip-budget/presets'
import { tripBudgetSources } from './trip-budget/sources'
import { tripBudgetSystem } from './trip-budget/system'

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
	 * it) but never listed in the header's Examples menu and never the default.
	 */
	readonly hidden?: boolean
	readonly system: WidgetSystem<AnyWidgetPluginTuple>
	readonly presets: readonly ShowcasePreset[]
	readonly defaultPreset: ShowcasePreset
	/**
	 * Curated Implementation-explorer registry (diagnostic #25 P3 Scope A) — metadata only (plugin type ->
	 * file descriptors with lazy `load()` thunks, see `showcase-host/sources.ts`), trivially small, so
	 * this field is safe to keep eager alongside the rest of `ShowcaseEntry` without pulling any raw
	 * source text or Shiki into the eager/shared chunk graph.
	 */
	readonly sources: SourcesRegistry
	/** The documentation generated from the plugins' `Interfaces` JSDoc (`virtual:widget-docs/<id>`). */
	readonly docs: WidgetDocs
	/**
	 * The config JSON Schema of each plugin that has one, by plugin type (Core 0.3 carries no config schema): the schemas
	 * `widgetDocs()` generates from the plugins' `Interfaces` (`generatedConfigSchemas(docs)`), or the showcase's own map
	 * where it has one (quote-rules: the Valibot schemas its validators are built from).
	 */
	readonly configSchemas: ConfigSchemaMap
}

/** The generated config JSON Schema (Draft 2020-12, `$ref`/`$defs`) of each plugin with a config, by plugin type. */
export function generatedConfigSchemas(docs: WidgetDocs): ConfigSchemaMap {
	return Object.fromEntries(Object.entries(docs.plugins)
		.flatMap(([type, plugin]) => plugin.config === null ? [] : [[type, plugin.config.schema] as const]))
}

/**
 * `WidgetSystem<Plugins>` is erased to `WidgetSystem<AnyWidgetPluginTuple>` here on purpose: the
 * registry is a runtime lookup table across showcases with different plugin universes, and every
 * consumer (`LabSession`, `createWidgetVueRenderer`'s own `runtime.blueprint.system === system`
 * identity check) only ever needs object identity, never the precise literal-type union.
 *
 * `survey` is the default; `trip-budget`, `quote-rules`, `onboarding`, `document-repair` and `renderer-packs` are listed after it in the Examples menu. `sandbox` is a hidden, test-only
 * fixture (minimal Counter/Text/... widgets plus the invalid/raw-slot recovery presets): it is not listed
 * in the Examples menu and is reachable only through `?showcase=sandbox` (see `resolveInitialShowcase`).
 */
export const showcases: readonly ShowcaseEntry[] = [
	{
		id: 'survey',
		label: 'Interactive Survey',
		system: surveySystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		presets: surveyPresets,
		defaultPreset: defaultSurveyPreset,
		sources: surveySources,
		docs: surveyDocs,
		configSchemas: generatedConfigSchemas(surveyDocs),
	},
	{
		id: 'trip-budget',
		label: 'Trip budget splitter',
		system: tripBudgetSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		presets: tripBudgetPresets,
		defaultPreset: defaultTripBudgetPreset,
		sources: tripBudgetSources,
		docs: tripBudgetDocs,
		configSchemas: generatedConfigSchemas(tripBudgetDocs),
	},
	{
		id: 'quote-rules',
		label: 'Quote rules shared by browser and backend',
		system: quoteSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		presets: quotePresets,
		defaultPreset: defaultQuotePreset,
		sources: quoteSources,
		docs: quoteRulesDocs,
		// quote-rules keeps the JSON Schemas of its Valibot validators (`quote-rules/schemas.ts`).
		configSchemas: quoteConfigSchemas,
	},
	{
		id: 'onboarding',
		label: 'Onboarding wizard with an Events log',
		system: onboardingSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		presets: onboardingPresets,
		defaultPreset: defaultOnboardingPreset,
		sources: onboardingSources,
		docs: onboardingDocs,
		configSchemas: generatedConfigSchemas(onboardingDocs),
	},
	{
		id: 'document-repair',
		label: 'Legacy document repair',
		system: repairSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		presets: repairPresets,
		defaultPreset: defaultRepairPreset,
		sources: repairSources,
		docs: documentRepairDocs,
		configSchemas: generatedConfigSchemas(documentRepairDocs),
	},
	{
		id: 'renderer-packs',
		label: 'One document, two renderer packs',
		system: packsSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		presets: packsPresets,
		defaultPreset: defaultPacksPreset,
		sources: packsSources,
		docs: rendererPacksDocs,
		configSchemas: generatedConfigSchemas(rendererPacksDocs),
	},
	{
		id: 'sandbox',
		label: 'Sandbox',
		hidden: true,
		system: sandboxSystem as unknown as WidgetSystem<AnyWidgetPluginTuple>,
		presets: sandboxPresets,
		defaultPreset: defaultSandboxPreset,
		sources: sandboxSources,
		docs: sandboxDocs,
		configSchemas: {},
	},
]

/** The showcases the header's Examples menu lists: every registered showcase that is not a hidden fixture. */
export const listedShowcases: readonly ShowcaseEntry[] = showcases.filter(showcase => showcase.hidden !== true)

export const defaultShowcase: ShowcaseEntry = listedShowcases[0]!

export function getShowcase(id: string): ShowcaseEntry | undefined {
	return showcases.find(showcase => showcase.id === id)
}

/**
 * The URL (path, query and hash) with `?showcase=<id>` set, every other parameter kept as is. Used to keep
 * the address bar in sync with the active showcase through `history.replaceState`, so a reload restores it
 * (the id is written even for the default showcase: the URL always says what is open).
 */
export function urlWithShowcase(href: string, id: string): string {
	const url = new URL(href)
	url.searchParams.set('showcase', id)
	return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The showcase the Lab starts in: the `?showcase=<id>` URL parameter selects any registered showcase
 * (listed or hidden), so e2e can open the hidden `sandbox` fixture without UI. A missing, empty or
 * unknown id falls back to `defaultShowcase`. Read once at startup; `App.vue` then keeps the parameter in sync
 * with the active showcase (`urlWithShowcase`).
 */
export function resolveInitialShowcase(search: string): ShowcaseEntry {
	const id = new URLSearchParams(search)
		.get('showcase')
	return (id === null ? undefined : getShowcase(id)) ?? defaultShowcase
}
