/**
 * Shared test-only fixtures for the document-repair showcase's colocated `*.unit.test.ts` files. Not itself a test file,
 * and never imported by application code. Every test builds a real `@deviltea/widget-core` Blueprint/Runtime/Document
 * against `repairSystem` and `boardSystem`; nothing here mocks Core.
 */

import type { RuntimeWidget } from '@deviltea/widget-core'
import type { RepairStep, SavedWith } from './domain'
import type { repairPlugins } from './plugins'
import type { RepairRuntime } from './system'
import { createWidgetDocument } from '@deviltea/widget-core'
import { boardSystem } from './board/system'
import { planRepair } from './domain'
import { defaultRepairPreset, repairPresets } from './presets'
import { repairSystem } from './system'

export type { RepairRuntime }
type RepairRuntimeWidget = RuntimeWidget<typeof repairPlugins>

/** A Runtime for a source object of the repair desk; throws unless the Blueprint is valid. */
export function createRuntimeFor(source: unknown): { readonly runtime: RepairRuntime } {
	const blueprint = repairSystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid Blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics.map(({ code, message }) => ({ code, message })))}`)
	return { runtime: blueprint.createRuntime() }
}

/** A Runtime for `sourceText` (the default preset when omitted); throws unless the Blueprint is valid. */
export function createRepairRuntime(sourceText: string = defaultRepairPreset.sourceText): { readonly runtime: RepairRuntime } {
	return createRuntimeFor(JSON.parse(sourceText))
}

/** A Runtime of a preset by id. */
export function createPresetRuntime(id: string): { readonly runtime: RepairRuntime } {
	const preset = repairPresets.find(candidate => candidate.id === id)
	if (preset === undefined)
		throw new Error(`Unknown preset ${id}`)
	return createRepairRuntime(preset.sourceText)
}

/** The value of a successful Property or Method result; throws with the failure otherwise. */
export function valueOf<Value>(result: { readonly ok: true, readonly value: Value } | { readonly ok: false, readonly failure: unknown }): Value {
	if (!result.ok)
		throw new Error(`Expected an ok result, got ${JSON.stringify(result.failure)}`)
	return result.value
}

/** `runtime.getWidget(id)` narrowed by the `type` literal, so callers get the exact `state`/`properties`. */
export function widgetOfType<Type extends RepairRuntimeWidget['type']>(runtime: RepairRuntime, id: string, type: Type): Extract<RepairRuntimeWidget, { readonly type: Type }> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`Expected widget "${id}" to exist and be of type "${type}".`)
	return widget as Extract<RepairRuntimeWidget, { readonly type: Type }>
}

/** The widgets of the default document, narrowed. */
export function widgetsOf(runtime: RepairRuntime) {
	return {
		desk: widgetOfType(runtime, 'desk', 'RepairDesk'),
		v1: widgetOfType(runtime, 'draft-v1', 'SavedDraft'),
		v2: widgetOfType(runtime, 'draft-v2', 'SavedDraft'),
		v3: widgetOfType(runtime, 'draft-v3', 'SavedDraft'),
		poll: widgetOfType(runtime, 'draft-poll', 'SavedDraft'),
	}
}

/**
 * Opens a `WidgetDocument` of the notice board system on a copy of `source` and applies the plan step by step, planning again
 * from the current snapshot after every commit, until there is no step left. Returns the document and the ids of the steps applied.
 */
export function repairByPlan(source: unknown, savedWith: SavedWith) {
	const document = createWidgetDocument({ system: boardSystem, source: structuredClone(source) })
	const applied: string[] = []
	for (let pass = 0; pass < 20; pass++) {
		const snapshot = document.getSnapshot()
		const plan: readonly RepairStep[] = planRepair(snapshot.blueprint.source, savedWith)
		const step = plan[0]
		if (step === undefined)
			break
		const result = document.applyPatch(step.patch, { expectedRevision: snapshot.revision })
		if (!result.ok)
			throw new Error(`Step ${step.id} failed: ${JSON.stringify(result.failure)}`)
		applied.push(step.id)
	}
	return { document, applied }
}
