/**
 * Shared test-only fixtures for the survey-form showcase's colocated `*.unit.test.ts` files. Not itself
 * a test file, and never imported by application code. Every test builds a real
 * `@deviltea/widget-core` Blueprint/Runtime against `surveySystem`; nothing here mocks Core.
 */

import type { RuntimeWidget, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { surveyPlugins } from './plugins'
import { defaultSurveyPreset } from './presets'
import { surveySystem } from './system'

export type SurveyRuntime = WidgetSystemRuntime<typeof surveyPlugins>
type SurveyRuntimeWidget = RuntimeWidget<typeof surveyPlugins>

/** A Runtime for a source object; throws unless the Blueprint is valid. */
export function createRuntimeFor(source: unknown): { readonly runtime: SurveyRuntime } {
	const blueprint = surveySystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics.map(({ code, message }) => ({ code, message })))}`)
	return { runtime: blueprint.createRuntime() }
}

/** A Runtime for `sourceText` (the default preset when omitted); throws unless the Blueprint is valid. */
export function createSurveyRuntime(sourceText: string = defaultSurveyPreset.sourceText): { readonly runtime: SurveyRuntime } {
	return createRuntimeFor(JSON.parse(sourceText))
}

/** The value of a successful Property or Method result; throws with the failure otherwise. */
export function valueOf<Value>(result: { readonly ok: true, readonly value: Value } | { readonly ok: false, readonly failure: unknown }): Value {
	if (!result.ok)
		throw new Error(`Expected an ok result, got ${JSON.stringify(result.failure)}`)
	return result.value
}

/** Text in both survey languages: `t('Name')` is `{ en: 'Name', 'zh-TW': 'Name (zh)' }`. */
export function t(text: string): { readonly 'en': string, readonly 'zh-TW': string } {
	return { 'en': text, 'zh-TW': `${text} (zh)` }
}

/** A `Survey` root `survey` with the given question widgets, for tests that need a small survey. */
export function surveyOf(questions: readonly unknown[], languages: readonly string[] = ['en', 'zh-TW']): unknown {
	return {
		id: 'survey',
		type: 'Survey',
		config: { title: t('Survey'), languages },
		slots: { questions },
	}
}

/** A question widget source: `question('age', 'Numeric', { min: 0 })` with label `t('age')` unless given. */
export function question(id: string, type: string, config: Record<string, unknown> = {}): unknown {
	return { id, type, config: { label: t(id), ...config } }
}

/**
 * `runtime.getWidget(id)` is typed as the union of every registered plugin's `RuntimeWidget` shape;
 * this narrows it by the `type` literal so callers get the exact `state`/`properties`/`methods`.
 */
export function widgetOfType<Type extends SurveyRuntimeWidget['type']>(runtime: SurveyRuntime, id: string, type: Type): Extract<SurveyRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<SurveyRuntimeWidget, { readonly type: Type }>
}
