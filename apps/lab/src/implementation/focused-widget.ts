/**
 * Resolves the shared cross-inspector focus (`src/lab/focus.ts`) down to the plain widget id/type pair
 * the Implementation explorer (and its entry-point "View implementation" affordances) key off of.
 * Framework-agnostic, pure — no Vue import, matching `src/lab/inspect-focus.ts`'s split. `null`
 * whenever there is no focus, or the focused node is unresolved (an unresolved Blueprint node has no
 * `type` to curate against).
 */

import type { WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { InspectorFocus } from '../lab/focus'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

export interface FocusedWidget {
	readonly id: string
	readonly type: string
}

export function resolveFocusedWidget(
	blueprint: WidgetSystemBlueprint,
	focus: InspectorFocus | null,
): FocusedWidget | null {
	if (focus === null)
		return null

	const node = inspectBlueprint(blueprint)
		.getNode(focus.nodeId)
	if (node === null || !node.resolved)
		return null

	return { id: node.node.id, type: node.node.type }
}
