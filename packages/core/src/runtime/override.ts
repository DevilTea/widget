/**
 * `overrideStateDefaults` best-effort resolution.
 *
 * `overrideStateDefaults` is an initialization-only, best-effort candidate map: malformed shape,
 * unknown widgets/keys and capability mismatches never block Runtime construction. They are recorded
 * as Runtime-level `state-override` Issues at the documented granularity, and every other usable
 * fragment still initializes independently.
 *
 * Normative source: issue #10 amendments "overrideStateDefaults is best-effort", "rename Runtime
 * override issue to state-override" and consolidated handoff §11.
 */

import type { CompiledBlueprint, InternalNodeId } from '../internal/contract'
import type { RuntimeLevelIssue } from '../issue'
import type { WidgetId, WidgetMemberKey } from '../types'
import { readWidgetPluginDefinition } from '../plugin'
import { buildKeyStateOverrideIssue, buildTopLevelStateOverrideIssue, buildWidgetStateOverrideIssue, freezeIssueSnapshot } from './issues'

export interface OverrideResolution {
	readonly runtimeLevelIssues: readonly RuntimeLevelIssue[]
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
	const runtimeLevelIssues: RuntimeLevelIssue[] = []
	const candidatesByNodeId = new Map<InternalNodeId, Map<WidgetMemberKey, unknown>>()

	if (overrideStateDefaults === undefined)
		// `runtimeLevelIssues` becomes `OverrideResolution.runtimeLevelIssues`, which the Runtime factory
		// stores as-is and later returns directly from `runtime.getIssues()`; canonicalize it here (deep
		// -freeze the array and every issue's framework-owned structure) so no caller mutation can ever
		// corrupt that shared reference after Runtime creation (issue #10 Runtime diagnostic snapshot
		// semantics).
		return { runtimeLevelIssues: freezeIssueSnapshot(runtimeLevelIssues), candidatesByNodeId }

	if (!isPlainRecord(overrideStateDefaults)) {
		runtimeLevelIssues.push(buildTopLevelStateOverrideIssue('The "overrideStateDefaults" option is not a usable override record.'))
		// `runtimeLevelIssues` becomes `OverrideResolution.runtimeLevelIssues`, which the Runtime factory
		// stores as-is and later returns directly from `runtime.getIssues()`; canonicalize it here (deep
		// -freeze the array and every issue's framework-owned structure) so no caller mutation can ever
		// corrupt that shared reference after Runtime creation (issue #10 Runtime diagnostic snapshot
		// semantics).
		return { runtimeLevelIssues: freezeIssueSnapshot(runtimeLevelIssues), candidatesByNodeId }
	}

	for (const widgetId of Object.keys(overrideStateDefaults)) {
		const fragment: unknown = overrideStateDefaults[widgetId]

		const nodeIds = compiled.nodeIdsByWidgetId.get(widgetId)
		const nodeId = nodeIds?.[0]
		const node = nodeId === undefined ? undefined : compiled.nodes[nodeId]

		if (node === undefined || !node.resolved) {
			runtimeLevelIssues.push(buildWidgetStateOverrideIssue(widgetId, `Unknown widget id "${widgetId}" in "overrideStateDefaults".`))
			continue
		}

		if (readWidgetPluginDefinition(node.plugin).state === null) {
			runtimeLevelIssues.push(buildWidgetStateOverrideIssue(widgetId, `Widget "${widgetId}" has no state capability.`))
			continue
		}

		if (!isPlainRecord(fragment)) {
			runtimeLevelIssues.push(buildWidgetStateOverrideIssue(widgetId, `The override fragment for widget "${widgetId}" is not a usable state-member record.`))
			continue
		}

		const perWidget = new Map<WidgetMemberKey, unknown>()
		for (const key of Object.keys(fragment)) {
			if (!node.state.has(key)) {
				runtimeLevelIssues.push(buildKeyStateOverrideIssue(widgetId, key, `Unknown state member "${key}" on widget "${widgetId}".`))
				continue
			}
			perWidget.set(key, fragment[key])
		}

		if (perWidget.size > 0)
			candidatesByNodeId.set(nodeId!, perWidget)
	}

	return { runtimeLevelIssues, candidatesByNodeId }
}
