/**
 * Structure validation — compile pipeline step 6 (consolidated handoff §10).
 *
 * Normative source: diagnostic #10 checkpoint C ("Structure validation"), amendment "callback addDiagnostic()
 * relative authoring" (COMMENT 14), amendment "synchronous core boundary and future async seams"
 * (every semantic callback here is sync-only), amendment "diagnostic-location contract" (system-level
 * `related` normalization), amendment "compile-view contract" (callbacks receive a restricted, frozen
 * facade — see `./view`'s `createCompileFacade`) and consolidated handoff §6/§7.
 *
 * Scopes run in order slot -> plugin -> system. Every resolved node runs its own slot/plugin
 * validators (in node-recovery order); the single system validator runs once, last.
 */

import type {
	BlueprintDiagnostic,
	BlueprintStructureDiagnosticLocation,
	RelativePluginStructureDiagnosticInput,
	RelativeSlotStructureDiagnosticInput,
	RelativeStructureDiagnosticLocation,
	RelativeSystemStructureDiagnosticInput,
} from '../diagnostic'
import type { InternalNodeId, ResolvedBlueprintWidgetNode } from '../internal/contract'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'
import type { WidgetMemberKey } from '../types'
import type { WorkingNode } from './recovery'
import type { CompileFacade } from './view'
import { readWidgetPluginDefinition } from '../plugin'
import { assertSyncValue } from '../runtime/sync'
import { createCollector, dedupeBy, structureDiagnostic } from './diagnostics'

function configFragment(node: WorkingNode): Record<string, unknown> {
	return node.plugin !== null && readWidgetPluginDefinition(node.plugin).config !== null
		? { config: node.config }
		: {}
}

/**
 * Declaration-order index of one slot name within a resolved node's plugin. Used only to make
 * system-level `related` ordering deterministic; `0` for a node/slot combination that cannot be
 * resolved (defensive fallback, never expected on a legitimate location).
 */
function slotDeclarationIndex(node: WorkingNode, slot: WidgetMemberKey): number {
	if (node.plugin === null)
		return 0
	const declaredSlots = readWidgetPluginDefinition(node.plugin).slots
	if (declaredSlots === null)
		return 0
	let index = 0
	for (const slotName of declaredSlots.keys()) {
		if (slotName === slot)
			return index
		index++
	}
	return 0
}

/**
 * Semantic identity key for one `related` location, used to deduplicate independently-authored
 * duplicates (same node + same discriminator) before finalizing. `location.node` is a compile-time
 * facade node (from `compileFacade.view`'s queries), resolved back to its internal node id via
 * `compileFacade.resolveNodeId`.
 */
function locationKey(
	resolveNodeId: (node: unknown) => InternalNodeId | undefined,
	location: RelativeStructureDiagnosticLocation,
): string {
	const nodeId = resolveNodeId(location.node) ?? -1
	const slot = location.type === 'widget' ? '' : location.slot
	const index = location.type === 'slot-child' ? location.index : -1
	return `${location.type}:${nodeId}:${slot}:${index}`
}

const locationRank: Record<RelativeStructureDiagnosticLocation['type'], number> = { 'widget': 0, 'slot': 1, 'slot-child': 2 }

/**
 * Orders `related` locations deterministically by semantic traversal order (the node's position in
 * `semanticOrder`), then discriminator refinement (widget -> slot -> slot-child), then slot
 * declaration order, then child index — never by authoring/hash/timing order.
 */
function compareLocations(
	nodes: readonly WorkingNode[],
	semanticOrderIndex: ReadonlyMap<InternalNodeId, number>,
	resolveNodeId: (node: unknown) => InternalNodeId | undefined,
	a: RelativeStructureDiagnosticLocation,
	b: RelativeStructureDiagnosticLocation,
): number {
	const nodeIdA = resolveNodeId(a.node)
	const nodeIdB = resolveNodeId(b.node)
	const orderA = nodeIdA !== undefined ? (semanticOrderIndex.get(nodeIdA) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
	const orderB = nodeIdB !== undefined ? (semanticOrderIndex.get(nodeIdB) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
	if (orderA !== orderB)
		return orderA - orderB

	const rankA = locationRank[a.type]
	const rankB = locationRank[b.type]
	if (rankA !== rankB)
		return rankA - rankB

	if (a.type !== 'widget' && b.type !== 'widget' && nodeIdA !== undefined) {
		const slotIndexA = slotDeclarationIndex(nodes[nodeIdA]!, a.slot)
		const slotIndexB = slotDeclarationIndex(nodes[nodeIdA]!, b.slot)
		if (slotIndexA !== slotIndexB)
			return slotIndexA - slotIndexB
	}

	if (a.type === 'slot-child' && b.type === 'slot-child')
		return a.index - b.index

	return 0
}

/**
 * Deduplicates and deterministically orders a system-level `validateStructure` author's `related`
 * input, then converts it to the framework-owned finalized location shape (real nodes, not facades).
 * `undefined` in, and `undefined` out for an empty result (a `related` field is never
 * present-but-empty).
 */
function normalizeRelated(
	nodes: readonly WorkingNode[],
	semanticOrderIndex: ReadonlyMap<InternalNodeId, number>,
	resolveNodeId: (node: unknown) => InternalNodeId | undefined,
	related: readonly RelativeStructureDiagnosticLocation[] | undefined,
): readonly BlueprintStructureDiagnosticLocation[] | undefined {
	if (related === undefined || related.length === 0)
		return undefined

	const deduped = dedupeBy(related, location => locationKey(resolveNodeId, location))
	deduped.sort((a, b) => compareLocations(nodes, semanticOrderIndex, resolveNodeId, a, b))

	if (deduped.length === 0)
		return undefined

	// Convert each author-supplied facade location to the framework-owned finalized shape (real node).
	return Object.freeze(deduped.map((location) => {
		const nodeId = resolveNodeId(location.node)
		const realNode = nodeId !== undefined ? nodes[nodeId]!.publicNode as ResolvedBlueprintWidgetNode : (location.node as unknown as ResolvedBlueprintWidgetNode)
		return { ...location, node: realNode } as BlueprintStructureDiagnosticLocation
	}))
}

export function runStructureValidation(
	system: WidgetSystem<AnyWidgetPluginTuple>,
	nodes: readonly WorkingNode[],
	semanticOrder: readonly InternalNodeId[],
	compileFacade: CompileFacade<AnyWidgetPluginTuple>,
	finalDiagnostics: BlueprintDiagnostic[],
): void {
	for (const nodeId of semanticOrder) {
		const node = nodes[nodeId]!
		if (!node.resolved || node.plugin === null)
			continue

		const definition = readWidgetPluginDefinition(node.plugin)
		const publicNode = node.publicNode as ResolvedBlueprintWidgetNode
		const widgetFacade = compileFacade.facadeForNodeId(nodeId)

		if (definition.slots !== null) {
			for (const [slotName, slotDefinition] of definition.slots) {
				if (slotDefinition.validateStructure === undefined)
					continue

				const children = (node.semanticSlots.get(slotName) ?? []).map(id => compileFacade.facadeForNodeId(id))
				const { collector, items } = createCollector<RelativeSlotStructureDiagnosticInput>()

				const result: unknown = slotDefinition.validateStructure({
					widget: widgetFacade,
					slot: slotName,
					children,
					blueprint: compileFacade.view,
					...configFragment(node),
					...collector,
				})
				assertSyncValue(result, `Slot "${slotName}"'s validateStructure`)

				for (const item of items)
					finalDiagnostics.push(structureDiagnostic(publicNode, item.message, slotName, item.index))
			}
		}

		if (definition.validateStructure !== null) {
			const { collector, items } = createCollector<RelativePluginStructureDiagnosticInput>()

			const result: unknown = definition.validateStructure({
				widget: widgetFacade,
				blueprint: compileFacade.view,
				...configFragment(node),
				...collector,
			})
			assertSyncValue(result, `Plugin "${node.type}"'s validateStructure`)

			for (const item of items) {
				const slot = 'slot' in item ? item.slot : undefined
				const index = 'index' in item ? item.index : undefined
				finalDiagnostics.push(structureDiagnostic(publicNode, item.message, slot, index))
			}
		}
	}

	if (system.validateStructure !== null) {
		const { collector, items } = createCollector<RelativeSystemStructureDiagnosticInput>()

		const result: unknown = system.validateStructure({
			blueprint: compileFacade.view,
			...collector,
		})
		assertSyncValue(result, 'System-level validateStructure')

		const semanticOrderIndex = new Map<InternalNodeId, number>()
		semanticOrder.forEach((nodeId, index) => semanticOrderIndex.set(nodeId, index))

		for (const item of items) {
			const { location, related } = item
			const nodeId = compileFacade.resolveNodeId(location.node)
			const realNode = nodeId !== undefined ? nodes[nodeId]!.publicNode as ResolvedBlueprintWidgetNode : (location.node as unknown as ResolvedBlueprintWidgetNode)

			finalDiagnostics.push(structureDiagnostic(
				realNode,
				item.message,
				location.type === 'widget' ? undefined : location.slot,
				location.type === 'slot-child' ? location.index : undefined,
				normalizeRelated(nodes, semanticOrderIndex, compileFacade.resolveNodeId, related),
			))
		}
	}
}
