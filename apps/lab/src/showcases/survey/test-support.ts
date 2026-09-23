/**
 * Shared test-only fixtures for the Interactive Survey showcase's colocated `*.unit.test.ts` files.
 * Not itself a test file, and never imported by application code — mirrors
 * `packages/vue/src/test-fixtures.ts`'s role for its own colocated tests. Every test builds a
 * real `@deviltea/widget-core` Blueprint/Runtime against `surveySystem`; nothing here mocks core.
 */

import type { RuntimeWidget, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { Component } from 'vue'
import type { surveyPlugins } from './plugins'
import { useWidget } from '@deviltea/widget-vue'
import { defineComponent, h } from 'vue'
import { ConditionalSectionPlugin, SurveySectionPlugin, TripSurveyPlugin } from './plugins'
import { defaultSurveyPreset } from './presets'
import { surveySystem } from './system'

type SurveyRuntime = WidgetSystemRuntime<typeof surveyPlugins>
type SurveyRuntimeWidget = RuntimeWidget<typeof surveyPlugins>

export function createSurveyRuntime(sourceText: string = defaultSurveyPreset.sourceText): {
	readonly runtime: SurveyRuntime
} {
	const definition: unknown = JSON.parse(sourceText)
	const blueprint = surveySystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

	return { runtime: blueprint.createRuntime() }
}

/**
 * `runtime.getWidget(id)` is typed as the union of every registered plugin's `RuntimeWidget` shape
 * (there is no id-to-type static link) — this narrows it the same way
 * `packages/core/src/runtime/deps-lazy-materialization.unit.test.ts` does, via the discriminated
 * `.type` literal, so callers get the exact `state`/`properties`/`methods` surface for `type`.
 */
export function widgetOfType<Type extends SurveyRuntimeWidget['type']>(runtime: SurveyRuntime, id: string, type: Type): Extract<SurveyRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<SurveyRuntimeWidget, { readonly type: Type }>
}

export function makeSurveySlotRenderer(plugin: typeof TripSurveyPlugin, slotName: 'form'): Component
export function makeSurveySlotRenderer(plugin: typeof SurveySectionPlugin, slotName: 'body'): Component
export function makeSurveySlotRenderer(plugin: typeof ConditionalSectionPlugin, slotName: 'body'): Component
export function makeSurveySlotRenderer(
	plugin: typeof TripSurveyPlugin | typeof SurveySectionPlugin | typeof ConditionalSectionPlugin,
	_slotName: 'form' | 'body',
): Component {
	return defineComponent({
		setup() {
			if (plugin === TripSurveyPlugin) {
				const { WidgetSlot } = useWidget(TripSurveyPlugin)
				return () => h(WidgetSlot, { name: 'form' })
			}
			if (plugin === SurveySectionPlugin) {
				const { WidgetSlot } = useWidget(SurveySectionPlugin)
				return () => h(WidgetSlot, { name: 'body' })
			}
			const { WidgetSlot } = useWidget(ConditionalSectionPlugin)
			return () => h(WidgetSlot, { name: 'body' })
		},
	})
}
