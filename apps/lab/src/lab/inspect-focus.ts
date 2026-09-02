/**
 * Widget id -> shared inspector focus resolution (diagnostic #25 P2 "Preview -> semantic inspector bridge").
 *
 * `InspectorFocus.nodeId` (`src/lab/focus.ts`) is an opaque, snapshot-local
 * `@deviltea/widget-core/inspection` `InspectionNodeId` — not the widget's own semantic `id` string a
 * `useWidget()` consumer sees. An Inspect-mode click only ever has the semantic `widgetId` (projected by
 * `@deviltea/widget-vue`'s `useWidget()` identity amendment and stamped onto the DOM by
 * `useInspectAnchor()`), so this module bridges the two: it looks the resolved Blueprint node up by its
 * `id` and returns the plain widget-level focus (`{ nodeId }`, no `member`) — the same grain a bare
 * Blueprint/Runtime tree-node click already uses, never a second selection model.
 *
 * Framework-agnostic on purpose (no Vue import), matching `focus.ts`'s split.
 */

import type { WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { InspectorFocus, InspectorFocusScope } from './focus'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

/**
 * `null` when `widgetId` does not resolve to a resolved node in this Blueprint snapshot (should not
 * happen for an anchor stamped from the very Runtime this Blueprint compiled, but this stays a lookup
 * miss rather than a thrown error — the same defensive stance `InspectionNodeId`-consuming lookups
 * elsewhere in the Lab take for an out-of-domain id).
 *
 * Deliberately non-generic (`WidgetSystemBlueprint`'s own default `Plugins = AnyWidgetPluginTuple`),
 * matching `src/graph/projection.ts`'s `projectSemanticGraph(inspection: BlueprintInspection, ...)`: a
 * still-open `Plugins` type parameter here would leave `ResolvedBlueprintWidgetNode<Plugins>`'s own
 * conditional type unresolved, so `node.node.id` would not type-check even though it always exists once
 * `Plugins` is a concrete (or defaulted) plugin tuple.
 */
export function resolveWidgetFocus(
	blueprint: WidgetSystemBlueprint,
	widgetId: string,
): InspectorFocus | null {
	const inspection = inspectBlueprint(blueprint)
	for (const node of inspection.nodes) {
		if (node.resolved && node.node.id === widgetId)
			return { nodeId: node.nodeId }
	}
	return null
}

export interface PreviewInspectResolution {
	readonly focus: InspectorFocus
	readonly scope: InspectorFocusScope
	readonly targetTab: 'blueprint' | 'runtime'
}

/**
 * Resolves a Preview anchor and chooses the only safe navigation target. A linked Preview may navigate
 * to the Document-facing Blueprint; a diverged Preview must remain in the Preview/Runtime scope.
 */
export function resolvePreviewInspectResolution(
	blueprint: WidgetSystemBlueprint,
	widgetId: string,
	isLinked: boolean,
): PreviewInspectResolution | null {
	const focus = resolveWidgetFocus(blueprint, widgetId)
	return focus === null
		? null
		: { focus, scope: 'preview', targetTab: isLinked ? 'blueprint' : 'runtime' }
}
