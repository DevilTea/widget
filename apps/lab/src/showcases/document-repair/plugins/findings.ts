/**
 * `projectFindings`: compiles a stored draft with the INNER notice board system and projects what Core says about it into
 * plain JSON (the `SavedDraft.findings` Property, and the frame host's view of a document snapshot).
 *
 * Everything here is read from Core's public surface: `blueprint.status`, `blueprint.sourceJsonCompatible`, the diagnostics
 * with `blueprint.getSourcePath(location.node)` (the path of the diagnostic's node inside the source, usable verbatim as a
 * `SourcePatch` path), and `inspectBlueprint(...).nodes[]` for the recovered topology: resolved and unresolved nodes (with the
 * authored `id` and `type` as hints) and `sourceSlots` placements (`raw-slot` for a slot key the plugin does not declare).
 * Core never throws for a malformed source, so neither does this, whatever JSON it is given.
 *
 * Compiling another System's Blueprint inside a Property `compute` is an ordinary synchronous call: `createBlueprint` is not
 * a Runtime callback and uses none of the callback context (`plugins/saved-draft.unit.test.ts` pins that it works).
 */

import type { WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { BoardPlugins } from '../board/plugins'
import type { FindingDiagnostic, FindingNode, Findings, PathSegment } from '../domain'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { boardSystem } from '../board/system'

function plainPath(path: readonly PropertyKey[] | null | undefined): readonly PathSegment[] | null {
	return path === null || path === undefined ? null : path.map(segment => typeof segment === 'number' || typeof segment === 'string' ? segment : String(segment))
}

/** What Core says about an already compiled Blueprint of the notice board system. */
export function findingsOfBlueprint(blueprint: WidgetSystemBlueprint<BoardPlugins>): Findings {
	const diagnostics: FindingDiagnostic[] = blueprint.diagnostics.map((diagnostic) => {
		const location = diagnostic.location
		const sourcePath = 'node' in location
			? plainPath(blueprint.getSourcePath(location.node))
			: plainPath('path' in diagnostic ? diagnostic.path : null)
		const reason = 'reason' in diagnostic ? diagnostic.reason : undefined
		return reason === undefined
			? { code: diagnostic.code, message: diagnostic.message, sourcePath }
			: { code: diagnostic.code, message: diagnostic.message, sourcePath, reason }
	})
	const inspection = inspectBlueprint(blueprint)
	const nodes: FindingNode[] = inspection.nodes.map(entry => ({
		sourcePath: plainPath(entry.sourcePath) ?? [],
		resolved: entry.resolved,
		id: entry.resolved ? entry.node.id : entry.id,
		type: entry.resolved ? entry.node.type : entry.type,
		slots: entry.sourceSlots.map(slot => ({ name: slot.name, placement: slot.placement, children: slot.children.length })),
	}))
	return { status: blueprint.status, sourceJsonCompatible: blueprint.sourceJsonCompatible, diagnostics, nodes }
}

/** Compiles `source` (any value) with the notice board system and projects what Core says about it. */
export function projectFindings(source: unknown): Findings {
	return findingsOfBlueprint(boardSystem.createBlueprint(source))
}
