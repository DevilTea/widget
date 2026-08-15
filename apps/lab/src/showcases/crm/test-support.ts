/**
 * Shared test-only fixtures for the Product Prototype showcase's colocated `*.unit.test.ts` files. Not
 * itself a test file, and never imported by application code — mirrors
 * `../survey/test-support.ts`'s role for its own colocated tests. Every test builds a real
 * `@deviltea/widget-core` Blueprint/Runtime against `crmSystem`; nothing here mocks core.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { Component } from 'vue'
import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { defineComponent, h } from 'vue'
import { AppShellPlugin, CardPlugin, ToolbarPlugin } from './plugins/structural'
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

const NoopRenderer = defineComponent({ setup: () => () => null })

/**
 * Renders every named slot of `plugin` in sequence — the shape `AppShell`/`Toolbar`/`Card` need to stay
 * real (never `Noop`) so anything nested under them still mounts (mirrors the single-slot
 * `makeSlotRenderer` helper each survey renderer test defines locally, generalized to N slots).
 */
function makeMultiSlotRenderer(plugin: any, slotNames: readonly string[]): Component {
	return defineComponent({
		setup() {
			// `useWidget<Plugin>`'s return type is built from several nested conditional types keyed off
			// `Plugin`; called with a `plugin: any` argument (this helper is test-only structural glue,
			// not a renderer that types against one exact plugin), TypeScript's "conditional types checked
			// against `any` distribute over every branch" rule surfaces a union that does not uniformly
			// have `WidgetSlot` — hence the extra `as any` here, discarding that inferred union rather
			// than fighting it.
			const { WidgetSlot } = useWidget(plugin) as any
			return () => slotNames.map(name => h(WidgetSlot, { name, key: name }))
		},
	})
}

/**
 * Full-registry-coverage component overrides for {@link createCrmHarness}. Every field is optional; an
 * omitted field falls back to a no-op renderer (or, for `AppShell`/`Toolbar`/`Card`, a slot-forwarding
 * stand-in — see {@link makeMultiSlotRenderer}).
 */
export interface CrmHarnessOverrides {
	readonly AppShell?: Component
	readonly Toolbar?: Component
	readonly Card?: Component
	readonly TextInput?: Component
	readonly SelectInput?: Component
	readonly MetricCard?: Component
	readonly Table?: Component
	readonly DetailPanel?: Component
	readonly BarChart?: Component
	readonly Button?: Component
	readonly Modal?: Component
	readonly DealStore?: Component
	readonly DealQuery?: Component
	readonly DealStageForm?: Component
}

/**
 * Full-coverage `@deviltea/widget-vue` renderer harness for CRM colocated renderer tests. Mirrors the
 * per-file harness pattern `../survey/renderers/TripMetricsRenderer.unit.test.ts` defines locally, but
 * centralized here: `crmSystem` has fourteen plugin types (`createWidgetVueRenderer` requires
 * exactly-once coverage of every one), so duplicating the full registration list per test file would be
 * pure boilerplate. Pass the real renderer under test as the matching override; everything else stays a
 * harmless stand-in.
 */
export function createCrmHarness(overrides: CrmHarnessOverrides = {}) {
	return createWidgetVueRenderer(crmSystem, renderers =>
		renderers
			.AppShell(overrides.AppShell ?? makeMultiSlotRenderer(AppShellPlugin, ['header', 'main', 'overlay']))
			.Toolbar(overrides.Toolbar ?? makeMultiSlotRenderer(ToolbarPlugin, ['start', 'end']))
			.Card(overrides.Card ?? makeMultiSlotRenderer(CardPlugin, ['body']))
			.TextInput(overrides.TextInput ?? NoopRenderer)
			.SelectInput(overrides.SelectInput ?? NoopRenderer)
			.MetricCard(overrides.MetricCard ?? NoopRenderer)
			.Table(overrides.Table ?? NoopRenderer)
			.DetailPanel(overrides.DetailPanel ?? NoopRenderer)
			.BarChart(overrides.BarChart ?? NoopRenderer)
			.Button(overrides.Button ?? NoopRenderer)
			.Modal(overrides.Modal ?? NoopRenderer)
			.DealStore(overrides.DealStore ?? NoopRenderer)
			.DealQuery(overrides.DealQuery ?? NoopRenderer)
			.DealStageForm(overrides.DealStageForm ?? NoopRenderer))
}
