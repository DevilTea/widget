/**
 * `overrideStateDefaults` best-effort resolution.
 *
 * `overrideStateDefaults` is an initialization-only, best-effort candidate map: malformed shape,
 * unknown widgets/keys and capability mismatches never block Runtime construction. They are recorded
 * as Runtime-level `state-override` Diagnostics at the documented granularity, and every other usable
 * fragment still initializes independently.
 *
 * Normative source: diagnostic #10 amendments "overrideStateDefaults is best-effort", "rename Runtime
 * override diagnostic to state-override" and consolidated handoff §11.
 */

import type { RuntimeLevelDiagnostic } from '../diagnostic'
import type { CompiledBlueprint, InternalNodeId } from '../internal/contract'
import type { WidgetId, WidgetMemberKey } from '../types'
import { readWidgetPluginDefinition } from '../plugin'
import { buildInvalidStateOverrideFragmentDiagnostic, buildKeyStateOverrideDiagnostic, buildTopLevelStateOverrideDiagnostic, buildUnsupportedStateOverrideDiagnostic, buildWidgetStateOverrideDiagnostic, freezeDiagnosticSnapshot } from './diagnostics'

export interface OverrideResolution {
	readonly runtimeLevelDiagnostics: readonly RuntimeLevelDiagnostic[]
	/** Per-node, per-key explicit override candidates that passed topology checks. */
	readonly candidatesByNodeId: ReadonlyMap<InternalNodeId, ReadonlyMap<WidgetMemberKey, unknown>>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveStateOverrides(
	compiled: CompiledBlueprint,
	overrideStateDefaults: Readonly<Record<WidgetId, Readonly<Record<WidgetMemberKey, unknown>>>> | undefined,
): OverrideResolution {
	const runtimeLevelDiagnostics: RuntimeLevelDiagnostic[] = []
	const candidatesByNodeId = new Map<InternalNodeId, Map<WidgetMemberKey, unknown>>()

	if (overrideStateDefaults === undefined)
		// `runtimeLevelDiagnostics` becomes `OverrideResolution.runtimeLevelDiagnostics`, which the Runtime factory
		// stores as-is and later returns directly from `runtime.getDiagnostics()`; canonicalize it here (deep
		// -freeze the array and every diagnostic's framework-owned structure) so no caller mutation can ever
		// corrupt that shared reference after Runtime creation (diagnostic #10 Runtime diagnostic snapshot
		// semantics).
		return { runtimeLevelDiagnostics: freezeDiagnosticSnapshot(runtimeLevelDiagnostics), candidatesByNodeId }

	if (!isPlainRecord(overrideStateDefaults)) {
		runtimeLevelDiagnostics.push(buildTopLevelStateOverrideDiagnostic('The "overrideStateDefaults" option is not a usable override record.'))
		// `runtimeLevelDiagnostics` becomes `OverrideResolution.runtimeLevelDiagnostics`, which the Runtime factory
		// stores as-is and later returns directly from `runtime.getDiagnostics()`; canonicalize it here (deep
		// -freeze the array and every diagnostic's framework-owned structure) so no caller mutation can ever
		// corrupt that shared reference after Runtime creation (diagnostic #10 Runtime diagnostic snapshot
		// semantics).
		return { runtimeLevelDiagnostics: freezeDiagnosticSnapshot(runtimeLevelDiagnostics), candidatesByNodeId }
	}

	for (const widgetId of Object.keys(overrideStateDefaults)) {
		const fragment: unknown = overrideStateDefaults[widgetId]

		const nodeIds = compiled.nodeIdsByWidgetId.get(widgetId)
		const nodeId = nodeIds?.[0]
		const node = nodeId === undefined ? undefined : compiled.nodes[nodeId]

		if (node === undefined || !node.resolved) {
			runtimeLevelDiagnostics.push(buildWidgetStateOverrideDiagnostic(widgetId, `Unknown widget id "${widgetId}" in "overrideStateDefaults".`))
			continue
		}

		if (readWidgetPluginDefinition(node.plugin).state === null) {
			runtimeLevelDiagnostics.push(buildUnsupportedStateOverrideDiagnostic(widgetId, `Widget "${widgetId}" has no state capability.`))
			continue
		}

		if (!isPlainRecord(fragment)) {
			runtimeLevelDiagnostics.push(buildInvalidStateOverrideFragmentDiagnostic(widgetId, `The override fragment for widget "${widgetId}" is not a usable state-member record.`))
			continue
		}

		const perWidget = new Map<WidgetMemberKey, unknown>()
		for (const key of Object.keys(fragment)) {
			if (!node.state.has(key)) {
				runtimeLevelDiagnostics.push(buildKeyStateOverrideDiagnostic(widgetId, key, `Unknown state member "${key}" on widget "${widgetId}".`))
				continue
			}
			perWidget.set(key, fragment[key])
		}

		if (perWidget.size > 0)
			candidatesByNodeId.set(nodeId!, perWidget)
	}

	// Same canonicalization as the two early returns above: this is the normal best-effort path (an
	// unknown widget/key, malformed per-widget fragment, or a valid record with no problems at all) and
	// was previously left unfrozen here, so `runtime.getDiagnostics()` still exposed a mutable array for
	// every "normal" `overrideStateDefaults` shape (diagnostic #10 Runtime diagnostic snapshot semantics).
	return { runtimeLevelDiagnostics: freezeDiagnosticSnapshot(runtimeLevelDiagnostics), candidatesByNodeId }
}
