/**
 * Shared read-only navigation shared by the compile-time semantic view (`BlueprintCompileView`) and
 * the finalized public Blueprint. Navigation itself never changes between compile-time and the
 * finalized Blueprint (COMMENT 2): only `getIssues()` / status / runtime machinery are compile-view
 * exclusions.
 */

import type { BlueprintCompileView, BlueprintWidgetNode, InternalNodeId, WidgetLocation } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { WorkingNode } from './recovery'

const EMPTY_CHILDREN: readonly BlueprintWidgetNode[] = Object.freeze([])

export interface Navigator<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends BlueprintCompileView<Plugins> {}

export function createNavigator<Plugins extends AnyWidgetPluginTuple>(
	nodes: readonly WorkingNode[],
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	nodeIdsByWidgetId: ReadonlyMap<WidgetId, readonly InternalNodeId[]>,
	rootNodeId: InternalNodeId,
): Navigator<Plugins> {
	return {
		get root() {
			return nodes[rootNodeId]!.publicNode as BlueprintWidgetNode<Plugins>
		},

		getWidget(id) {
			const ids = nodeIdsByWidgetId.get(id)
			if (ids === undefined || ids.length !== 1)
				return null
			return nodes[ids[0]!]!.publicNode as BlueprintWidgetNode<Plugins>
		},

		getParent(node) {
			const nodeId = nodeIdByPublicNode.get(node as BlueprintWidgetNode)
			if (nodeId === undefined)
				return null
			const parentNodeId = nodes[nodeId]!.parentNodeId
			return parentNodeId === null ? null : (nodes[parentNodeId]!.publicNode as BlueprintWidgetNode<Plugins>)
		},

		getLocation(node) {
			const nodeId = nodeIdByPublicNode.get(node as BlueprintWidgetNode)
			if (nodeId === undefined)
				return null
			return nodes[nodeId]!.location as WidgetLocation<Plugins>
		},

		getChildren(node) {
			const nodeId = nodeIdByPublicNode.get(node as BlueprintWidgetNode)
			if (nodeId === undefined)
				return EMPTY_CHILDREN as readonly BlueprintWidgetNode<Plugins>[]
			const working = nodes[nodeId]!
			const children: BlueprintWidgetNode[] = []
			for (const rawSlot of working.rawSlots) {
				for (const childId of rawSlot.childNodeIds)
					children.push(nodes[childId]!.publicNode)
			}
			return Object.freeze(children) as readonly BlueprintWidgetNode<Plugins>[]
		},

		getChildrenAt(node, slot: WidgetMemberKey) {
			const nodeId = nodeIdByPublicNode.get(node as BlueprintWidgetNode)
			if (nodeId === undefined)
				return EMPTY_CHILDREN as readonly BlueprintWidgetNode<Plugins>[]
			const working = nodes[nodeId]!
			const entry = working.rawSlots.find(rawSlot => rawSlot.slot === slot)
			if (entry === undefined)
				return EMPTY_CHILDREN as readonly BlueprintWidgetNode<Plugins>[]
			return Object.freeze(entry.childNodeIds.map(childId => nodes[childId]!.publicNode)) as readonly BlueprintWidgetNode<Plugins>[]
		},
	}
}
