/**
 * Applied-instance extraction (diagnostic #25 P3 Scope B). Given the APPLIED Document Blueprint — always
 * `LabStore.documentState.value.blueprint`, never the unapplied draft (the P1 gate review's "Applied
 * instance ... always derives from the applied snapshot — never the unapplied draft — so the two
 * identities cannot blur") — and the focused inspection node, returns that widget's own authored JSON
 * fragment pretty-printed.
 *
 * Framework-agnostic, pure — no Vue import, matching `src/lab/`'s split. The fragment is read through Core's
 * Blueprint inspection (`getNode(...).node.source`), which already is the authored object of exactly that
 * node: the Lab keeps no second copy of the authored grammar and never searches by widget id, so duplicate
 * ids cannot select the wrong widget.
 */

import type { WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

export type AppliedInstanceResult
	= | { readonly status: 'found', readonly json: string }
		| { readonly status: 'not-found' }

export function extractAppliedInstance(blueprint: WidgetSystemBlueprint, nodeId: InspectionNodeId): AppliedInstanceResult {
	const node = inspectBlueprint(blueprint)
		.getNode(nodeId)
	// A fragment outside the JSON domain (possible only for an invalid Blueprint) is not displayable.
	if (node === null || !blueprint.sourceJsonCompatible)
		return { status: 'not-found' }

	return { status: 'found', json: JSON.stringify(node.node.source, null, 2) }
}
