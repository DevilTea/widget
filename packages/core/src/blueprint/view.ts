/**
 * Read-only navigation, in two flavors:
 *
 * - {@link createNavigator} builds the real navigator over full public nodes. Used internally to
 *   assemble the *finalized* Blueprint's own navigation methods (`blueprint.getWidget`, etc.), which
 *   legitimately expose full nodes (`getIssues()` included) once compilation has finished.
 * - {@link createCompileFacade} builds a genuinely restricted, frozen runtime facade over the same
 *   underlying nodes, for compile-time callbacks (`validateStructure`, `registerDeps`) while
 *   compilation is still in progress (COMMENT 2 compile-view contract). A facade node/location never
 *   physically has `getIssues()`, a slot's children are themselves facades (recursive), and the facade
 *   navigator object itself is frozen so no callback can reassign a navigation method and corrupt the
 *   view later callbacks in the same compile pass observe. `getWidget`/`getParent`/`getLocation`/
 *   `getChildren*` accept either a facade or a real node as input, since a compile-time callback only
 *   ever holds facades but the compiler's own call sites (e.g. building a `widget:` context field)
 *   still work from real nodes.
 *
 * Navigation topology itself never changes between compile-time and the finalized Blueprint (COMMENT
 * 2): only `getIssues()` / final status / runtime machinery are compile-view exclusions.
 */

import type {
	BlueprintCompileView,
	BlueprintWidgetNode,
	BlueprintWidgetNodeView,
	InternalNodeId,
	WidgetLocation,
	WidgetLocationView,
} from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { WorkingNode } from './recovery'
import { readWidgetPluginDefinition } from '../plugin'

const EMPTY_CHILDREN: readonly BlueprintWidgetNode[] = Object.freeze([])
const EMPTY_FACADE_CHILDREN: readonly BlueprintWidgetNodeView[] = Object.freeze([])

export interface Navigator<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> extends BlueprintCompileView<Plugins> {}

/**
 * The real navigator, over full public nodes. Not exposed to plugin callbacks directly — only used to
 * assemble the finalized Blueprint's own navigation methods.
 */
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

/**
 * Bundle a compile facade exposes: the frozen public view every callback receives as `blueprint:`,
 * plus two compiler-internal accessors used to build the rest of a callback's context (`widget:`) and
 * to translate an author-supplied facade node back to its real counterpart when finalizing (e.g.
 * `related` locations authored by a system-level `validateStructure`).
 */
export interface CompileFacade<Plugins extends AnyWidgetPluginTuple = AnyWidgetPluginTuple> {
	readonly view: BlueprintCompileView<Plugins>
	/** The facade node for one internal node id, building and caching it on first access. */
	readonly facadeForNodeId: (nodeId: InternalNodeId) => BlueprintWidgetNodeView<Plugins>
	/** Resolves either a facade node (the common case) or a real node back to its internal node id. */
	readonly resolveNodeId: (node: unknown) => InternalNodeId | undefined
}

/**
 * Builds a real, restricted compile-time facade: node facades never physically carry `getIssues`, a
 * resolved facade's `.slots` children are themselves facades, `getLocation()`'s `parent` is a facade,
 * and the returned navigator object is frozen (readonly navigation, per {@link BlueprintCompileView}).
 */
export function createCompileFacade<Plugins extends AnyWidgetPluginTuple>(
	nodes: readonly WorkingNode[],
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	nodeIdsByWidgetId: ReadonlyMap<WidgetId, readonly InternalNodeId[]>,
	rootNodeId: InternalNodeId,
): CompileFacade<Plugins> {
	const facadeByNodeId = new Map<InternalNodeId, BlueprintWidgetNodeView>()
	const nodeIdByFacade = new Map<BlueprintWidgetNodeView, InternalNodeId>()
	const facadeLocationByNodeId = new Map<InternalNodeId, WidgetLocationView | null>()

	function facadeForNodeId(nodeId: InternalNodeId): BlueprintWidgetNodeView {
		const cached = facadeByNodeId.get(nodeId)
		if (cached !== undefined)
			return cached

		const working = nodes[nodeId]!

		// A null-prototype shell, same rationale as `recovery.ts`'s public-node shell and
		// `blueprint/deps.ts`'s `walkDeps`: member/slot names are arbitrary plugin-authored strings and
		// must stay prototype-safe.
		const shell: Record<string, unknown> = Object.create(null)
		shell.rawDefinition = working.rawDefinition
		shell.resolved = working.resolved
		// Deliberately no `getIssues`: compilation is still in progress (COMMENT 2 compile-view contract).

		if (working.resolved) {
			shell.id = working.id
			shell.type = working.type
			shell.plugin = working.plugin
			if (working.plugin !== null && readWidgetPluginDefinition(working.plugin).config !== null) {
				shell.rawConfig = working.rawConfig
				shell.config = working.config
			}

			const slots: Record<string, readonly BlueprintWidgetNodeView[]> = Object.create(null)
			for (const [slotName, childIds] of working.semanticSlots)
				slots[slotName] = Object.freeze(childIds.map(childId => facadeForNodeId(childId)))
			shell.slots = Object.freeze(slots)
		}

		const facade = Object.freeze(shell) as unknown as BlueprintWidgetNodeView
		facadeByNodeId.set(nodeId, facade)
		nodeIdByFacade.set(facade, nodeId)
		return facade
	}

	function resolveNodeId(node: unknown): InternalNodeId | undefined {
		const viaFacade = nodeIdByFacade.get(node as BlueprintWidgetNodeView)
		if (viaFacade !== undefined)
			return viaFacade
		return nodeIdByPublicNode.get(node as BlueprintWidgetNode)
	}

	function facadeLocationForNodeId(nodeId: InternalNodeId): WidgetLocationView | null {
		const cached = facadeLocationByNodeId.get(nodeId)
		if (cached !== undefined)
			return cached

		const location = nodes[nodeId]!.location
		let facadeLocation: WidgetLocationView | null

		if (location.type === 'root') {
			facadeLocation = Object.freeze({ type: 'root' })
		}
		else {
			const parentNodeId = nodeIdByPublicNode.get(location.parent as BlueprintWidgetNode)
			facadeLocation = parentNodeId === undefined
				? null
				: Object.freeze({
					type: location.type,
					parent: facadeForNodeId(parentNodeId),
					slot: location.slot,
					index: location.index,
				}) as WidgetLocationView
		}

		facadeLocationByNodeId.set(nodeId, facadeLocation)
		return facadeLocation
	}

	const view: BlueprintCompileView<Plugins> = {
		get root() {
			return facadeForNodeId(rootNodeId) as BlueprintWidgetNodeView<Plugins>
		},

		getWidget(id) {
			const ids = nodeIdsByWidgetId.get(id)
			if (ids === undefined || ids.length !== 1)
				return null
			return facadeForNodeId(ids[0]!) as BlueprintWidgetNodeView<Plugins>
		},

		getParent(node) {
			const nodeId = resolveNodeId(node)
			if (nodeId === undefined)
				return null
			const parentNodeId = nodes[nodeId]!.parentNodeId
			return parentNodeId === null ? null : (facadeForNodeId(parentNodeId) as BlueprintWidgetNodeView<Plugins>)
		},

		getLocation(node) {
			const nodeId = resolveNodeId(node)
			if (nodeId === undefined)
				return null
			return facadeLocationForNodeId(nodeId) as WidgetLocationView<Plugins> | null
		},

		getChildren(node) {
			const nodeId = resolveNodeId(node)
			if (nodeId === undefined)
				return EMPTY_FACADE_CHILDREN as readonly BlueprintWidgetNodeView<Plugins>[]
			const working = nodes[nodeId]!
			const children: BlueprintWidgetNodeView[] = []
			for (const rawSlot of working.rawSlots) {
				for (const childId of rawSlot.childNodeIds)
					children.push(facadeForNodeId(childId))
			}
			return Object.freeze(children) as readonly BlueprintWidgetNodeView<Plugins>[]
		},

		getChildrenAt(node, slot: WidgetMemberKey) {
			const nodeId = resolveNodeId(node)
			if (nodeId === undefined)
				return EMPTY_FACADE_CHILDREN as readonly BlueprintWidgetNodeView<Plugins>[]
			const working = nodes[nodeId]!
			const entry = working.rawSlots.find(rawSlot => rawSlot.slot === slot)
			if (entry === undefined)
				return EMPTY_FACADE_CHILDREN as readonly BlueprintWidgetNodeView<Plugins>[]
			return Object.freeze(entry.childNodeIds.map(childId => facadeForNodeId(childId))) as readonly BlueprintWidgetNodeView<Plugins>[]
		},
	}
	Object.freeze(view)

	return {
		view,
		facadeForNodeId: nodeId => facadeForNodeId(nodeId) as BlueprintWidgetNodeView<Plugins>,
		resolveNodeId,
	}
}
