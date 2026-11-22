/**
 * Shared test-only fixtures for the renderer-packs showcase's colocated `*.unit.test.ts` files. Not itself a test file, and
 * never imported by application code. Every test builds a real `@deviltea/widget-core` Blueprint/Runtime against `packsSystem`;
 * nothing here mocks Core.
 */

import type { RuntimeWidget } from '@deviltea/widget-core'
import type { packsPlugins } from './plugins'
import type { PacksRuntime } from './system'
import { defaultPacksPreset, packsPresets } from './presets'
import { packsSystem } from './system'

export type { PacksRuntime }
type PacksRuntimeWidget = RuntimeWidget<typeof packsPlugins>

/** A Runtime for a source object of the settings system; throws unless the Blueprint is valid. */
export function createRuntimeFor(source: unknown): { readonly runtime: PacksRuntime } {
	const blueprint = packsSystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics.map(({ code, message }) => ({ code, message })))}`)
	return { runtime: blueprint.createRuntime() }
}

/** A Runtime for `sourceText` (the default preset when omitted); throws unless the Blueprint is valid. */
export function createPacksRuntime(sourceText: string = defaultPacksPreset.sourceText): { readonly runtime: PacksRuntime } {
	return createRuntimeFor(JSON.parse(sourceText))
}

/** A Runtime of a preset by id. */
export function createPresetRuntime(id: string): { readonly runtime: PacksRuntime } {
	const preset = packsPresets.find(candidate => candidate.id === id)
	if (preset === undefined)
		throw new Error(`Unknown preset ${id}`)
	return createPacksRuntime(preset.sourceText)
}

/** The value of a successful Property or Method result; throws with the failure otherwise. */
export function valueOf<Value>(result: { readonly ok: true, readonly value: Value } | { readonly ok: false, readonly failure: unknown }): Value {
	if (!result.ok)
		throw new Error(`Expected an ok result, got ${JSON.stringify(result.failure)}`)
	return result.value
}

/** The diagnostics of a Method's latest call, as `code` and `reason`. */
export function failureOf(method: { readonly getDiagnostics: () => readonly { readonly code: string, readonly reason?: string }[] }): readonly { readonly code: string, readonly reason?: string }[] {
	return method.getDiagnostics()
		.map(({ code, reason }) => ({ code, reason }))
}

/** `runtime.getWidget(id)` narrowed by the `type` literal, so callers get the exact `state`/`properties`/`methods`. */
export function widgetOfType<Type extends PacksRuntimeWidget['type']>(runtime: PacksRuntime, id: string, type: Type): Extract<PacksRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<PacksRuntimeWidget, { readonly type: Type }>
}

/** The widgets of the default document, narrowed. */
export function widgetsOf(runtime: PacksRuntime) {
	return {
		page: widgetOfType(runtime, 'settings', 'SettingsPage'),
		appearance: widgetOfType(runtime, 'appearance', 'Appearance'),
		notifier: widgetOfType(runtime, 'notifier', 'Notifier'),
		workspaceName: widgetOfType(runtime, 'workspace-name', 'TextField'),
		tagline: widgetOfType(runtime, 'tagline', 'TextField'),
		weekStart: widgetOfType(runtime, 'week-start', 'Choice'),
		digest: widgetOfType(runtime, 'digest', 'Toggle'),
		beta: widgetOfType(runtime, 'beta', 'Toggle'),
		clearCache: widgetOfType(runtime, 'clear-cache', 'DangerAction'),
		archive: widgetOfType(runtime, 'archive-workspace', 'DangerAction'),
	}
}
