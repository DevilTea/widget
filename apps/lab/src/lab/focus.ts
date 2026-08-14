/**
 * Shared cross-inspector focus (Blueprint / Runtime / Graph panels).
 *
 * Normative source: issue #13 (Widget Lab Phase 4) comment "Widget Lab inspector panel interaction
 * contract". Shared focus is snapshot-local: an `InspectionNodeId` (see
 * `@deviltea/widget-core/inspection`) plus an optional State/Property/Method member. It resets to the
 * new Blueprint's root on every applied snapshot; panel-local selections (Graph edge selection,
 * Blueprint's own selected issue, Graph viewport/filters, ...) are out of scope here and stay owned by
 * each panel.
 */

import type { AnyWidgetPluginTuple, WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { LabSession } from './session'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'

export type InspectorFocusMember
	= | { readonly type: 'state', readonly name: string }
		| { readonly type: 'property', readonly name: string }
		| { readonly type: 'method', readonly name: string }

export interface InspectorFocus {
	readonly nodeId: InspectionNodeId
	readonly member?: InspectorFocusMember
}

export interface InspectorFocusStore {
	getFocus: () => InspectorFocus | null
	/** Explicit issue-navigation commands (and panel row selection) call this; ordinary tab switching never does. */
	setFocus: (focus: InspectorFocus | null) => void
	subscribe: (listener: () => void) => () => void
	/** Stops listening to the underlying `LabSession`. Call when the store itself is torn down. */
	dispose: () => void
}

function rootFocusOf<Plugins extends AnyWidgetPluginTuple>(blueprint: WidgetSystemBlueprint<Plugins>): InspectorFocus {
	return { nodeId: inspectBlueprint(blueprint).rootNodeId }
}

/**
 * Resets focus to the new Blueprint's root whenever `session.active.blueprint` identity changes (i.e.
 * after a successful Apply), and only then — `LabSession.subscribe` also fires for draft edits,
 * Apply start/end, revert, and format, none of which cross the applied-snapshot boundary.
 */
export function createInspectorFocusStore<Plugins extends AnyWidgetPluginTuple>(
	session: LabSession<Plugins>,
): InspectorFocusStore {
	const listeners = new Set<() => void>()
	let lastBlueprint = session.active.blueprint
	let focus: InspectorFocus | null = rootFocusOf(lastBlueprint)

	function emit(): void {
		for (const listener of listeners) listener()
	}

	const unsubscribeSession = session.subscribe(() => {
		const currentBlueprint = session.active.blueprint
		if (currentBlueprint !== lastBlueprint) {
			lastBlueprint = currentBlueprint
			focus = rootFocusOf(currentBlueprint)
			emit()
		}
	})

	return {
		getFocus: () => focus,
		setFocus: (next) => {
			focus = next
			emit()
		},
		subscribe: (listener) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		dispose: unsubscribeSession,
	}
}
