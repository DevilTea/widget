/**
 * Shared test-only fixtures for the onboarding showcase's colocated `*.unit.test.ts` files. Not itself a test file,
 * and never imported by application code. Every test builds a real `@deviltea/widget-core` Blueprint/Runtime against
 * `onboardingSystem`; nothing here mocks Core.
 */

import type { RuntimeWidget } from '@deviltea/widget-core'
import type { onboardingPlugins } from './plugins'
import type { OnboardingRuntime } from './system'
import { defaultOnboardingPreset, onboardingPresets } from './presets'
import { onboardingSystem } from './system'

export type { OnboardingRuntime }
type OnboardingRuntimeWidget = RuntimeWidget<typeof onboardingPlugins>

/** A Runtime for a source object; throws unless the Blueprint is valid. */
export function createRuntimeFor(source: unknown): { readonly runtime: OnboardingRuntime } {
	const blueprint = onboardingSystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics.map(({ code, message }) => ({ code, message })))}`)
	return { runtime: blueprint.createRuntime() }
}

/** A Runtime for `sourceText` (the default preset when omitted); throws unless the Blueprint is valid. */
export function createOnboardingRuntime(sourceText: string = defaultOnboardingPreset.sourceText): { readonly runtime: OnboardingRuntime } {
	return createRuntimeFor(JSON.parse(sourceText))
}

/** A Runtime of a preset by id. */
export function createPresetRuntime(id: string): { readonly runtime: OnboardingRuntime } {
	const preset = onboardingPresets.find(candidate => candidate.id === id)
	if (preset === undefined)
		throw new Error(`Unknown preset ${id}`)
	return createOnboardingRuntime(preset.sourceText)
}

/** The value of a successful Property or Method result; throws with the failure otherwise. */
export function valueOf<Value>(result: { readonly ok: true, readonly value: Value } | { readonly ok: false, readonly failure: unknown }): Value {
	if (!result.ok)
		throw new Error(`Expected an ok result, got ${JSON.stringify(result.failure)}`)
	return result.value
}

/** `runtime.getWidget(id)` narrowed by the `type` literal, so callers get the exact `state`/`properties`/`methods`/`events`. */
export function widgetOfType<Type extends OnboardingRuntimeWidget['type']>(runtime: OnboardingRuntime, id: string, type: Type): Extract<OnboardingRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<OnboardingRuntimeWidget, { readonly type: Type }>
}

/** The widgets of the default document, narrowed. */
export function widgetsOf(runtime: OnboardingRuntime) {
	return {
		root: widgetOfType(runtime, 'onboarding', 'Onboarding'),
		account: widgetOfType(runtime, 'account', 'AccountStep'),
		interests: widgetOfType(runtime, 'interests', 'InterestsStep'),
		safety: widgetOfType(runtime, 'safety', 'SafetyStep'),
		induction: widgetOfType(runtime, 'induction', 'InductionStep'),
	}
}

/** Fills in the first three steps of the default document through State, as a visitor does. */
export function completeFirstThreeSteps(runtime: OnboardingRuntime): void {
	const { account, interests, safety } = widgetsOf(runtime)
	account.state.name.set('Sam Rivera')
	account.state.email.set('sam@example.org')
	interests.state.selected.set(['woodwork'])
	safety.state.acknowledged.set(['shoes', 'machines', 'exits'])
}

/** The diagnostics of a Method's latest call, as `code` and `reason`. */
export function failureOf(method: { readonly getDiagnostics: () => readonly { readonly code: string, readonly reason?: string }[] }): readonly { readonly code: string, readonly reason?: string }[] {
	return method.getDiagnostics()
		.map(({ code, reason }) => ({ code, reason }))
}
