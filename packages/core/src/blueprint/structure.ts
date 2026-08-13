/**
 * Structure validation — compile pipeline step 6 (consolidated handoff §10).
 *
 * Normative source: issue #10 checkpoint C ("Structure validation"), amendment "callback addIssue()
 * relative authoring" (COMMENT 14), amendment "synchronous core boundary and future async seams"
 * (every semantic callback here is sync-only), amendment "diagnostic-location contract" (system-level
 * `related` normalization) and consolidated handoff §6/§7.
 *
 * Scopes run in order slot -> plugin -> system. Every resolved node runs its own slot/plugin
 * validators (in node-recovery order); the single system validator runs once, last.
 */

import type { BlueprintWidgetNode, InternalNodeId, ResolvedBlueprintWidgetNode } from '../internal/contract'
import type {
	BlueprintIssue,
	BlueprintStructureIssueLocation,
	RelativePluginStructureIssueInput,
	RelativeSlotStructureIssueInput,
	RelativeStructureIssueLocation,
	RelativeSystemStructureIssueInput,
} from '../issue'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'
import type { WidgetMemberKey } from '../types'
import type { WorkingNode } from './recovery'
import type { Navigator } from './view'
import { readWidgetPluginDefinition } from '../plugin'
import { assertSyncValue } from '../runtime/sync'
import { createCollector, dedupeBy, structureIssue } from './issues'

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

function locationNodeId(
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	location: RelativeStructureIssueLocation,
): InternalNodeId | undefined {
	return nodeIdByPublicNode.get(location.node as unknown as BlueprintWidgetNode)
}

/**
 * Semantic identity key for one `related` location, used to deduplicate independently-authored
 * duplicates (same node + same discriminator) before finalizing.
 */
function locationKey(
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	location: RelativeStructureIssueLocation,
): string {
	const nodeId = locationNodeId(nodeIdByPublicNode, location) ?? -1
	const slot = location.type === 'widget' ? '' : location.slot
	const index = location.type === 'slot-child' ? location.index : -1
	return `${location.type}:${nodeId}:${slot}:${index}`
}

const locationRank: Record<RelativeStructureIssueLocation['type'], number> = { 'widget': 0, 'slot': 1, 'slot-child': 2 }

/**
 * Orders `related` locations deterministically by semantic traversal order (the node's position in
 * `semanticOrder`), then discriminator refinement (widget -> slot -> slot-child), then slot
 * declaration order, then child index — never by authoring/hash/timing order.
 */
function compareLocations(
	nodes: readonly WorkingNode[],
	semanticOrderIndex: ReadonlyMap<InternalNodeId, number>,
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	a: RelativeStructureIssueLocation,
	b: RelativeStructureIssueLocation,
): number {
	const nodeIdA = locationNodeId(nodeIdByPublicNode, a)
	const nodeIdB = locationNodeId(nodeIdByPublicNode, b)
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
 * input, then converts it to the framework-owned finalized location shape. `undefined` in, and
 * `undefined` out for an empty result (a `related` field is never present-but-empty).
 */
function normalizeRelated(
	nodes: readonly WorkingNode[],
	semanticOrderIndex: ReadonlyMap<InternalNodeId, number>,
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	related: readonly RelativeStructureIssueLocation[] | undefined,
): readonly BlueprintStructureIssueLocation[] | undefined {
	if (related === undefined || related.length === 0)
		return undefined

	const deduped = dedupeBy(related, location => locationKey(nodeIdByPublicNode, location))
	deduped.sort((a, b) => compareLocations(nodes, semanticOrderIndex, nodeIdByPublicNode, a, b))

	return deduped.length > 0
		? (deduped as unknown as readonly BlueprintStructureIssueLocation[])
		: undefined
}

export function runStructureValidation(
	system: WidgetSystem<AnyWidgetPluginTuple>,
	nodes: readonly WorkingNode[],
	semanticOrder: readonly InternalNodeId[],
	nodeIdByPublicNode: ReadonlyMap<BlueprintWidgetNode, InternalNodeId>,
	navigator: Navigator,
	finalIssues: BlueprintIssue[],
): void {
	for (const nodeId of semanticOrder) {
		const node = nodes[nodeId]!
		if (!node.resolved || node.plugin === null)
			continue

		const definition = readWidgetPluginDefinition(node.plugin)
		const publicNode = node.publicNode as ResolvedBlueprintWidgetNode

		if (definition.slots !== null) {
			for (const [slotName, slotDefinition] of definition.slots) {
				if (slotDefinition.validateStructure === undefined)
					continue

				const children = (node.semanticSlots.get(slotName) ?? []).map(id => nodes[id]!.publicNode)
				const { collector, items } = createCollector<RelativeSlotStructureIssueInput>()

				const result: unknown = slotDefinition.validateStructure({
					widget: publicNode,
					slot: slotName,
					children,
					blueprint: navigator,
					...configFragment(node),
					...collector,
				})
				assertSyncValue(result, `Slot "${slotName}"'s validateStructure`)

				for (const item of items)
					finalIssues.push(structureIssue(publicNode, item.message, slotName, item.index))
			}
		}

		if (definition.validateStructure !== null) {
			const { collector, items } = createCollector<RelativePluginStructureIssueInput>()

			const result: unknown = definition.validateStructure({
				widget: publicNode,
				blueprint: navigator,
				...configFragment(node),
				...collector,
			})
			assertSyncValue(result, `Plugin "${node.type}"'s validateStructure`)

			for (const item of items) {
				const slot = 'slot' in item ? item.slot : undefined
				const index = 'index' in item ? item.index : undefined
				finalIssues.push(structureIssue(publicNode, item.message, slot, index))
			}
		}
	}

	if (system.validateStructure !== null) {
		const { collector, items } = createCollector<RelativeSystemStructureIssueInput>()

		const result: unknown = system.validateStructure({
			blueprint: navigator,
			...collector,
		})
		assertSyncValue(result, 'System-level validateStructure')

		const semanticOrderIndex = new Map<InternalNodeId, number>()
		semanticOrder.forEach((nodeId, index) => semanticOrderIndex.set(nodeId, index))

		for (const item of items) {
			const { location, related } = item
			finalIssues.push(structureIssue(
				location.node as unknown as ResolvedBlueprintWidgetNode,
				item.message,
				location.type === 'widget' ? undefined : location.slot,
				location.type === 'slot-child' ? location.index : undefined,
				normalizeRelated(nodes, semanticOrderIndex, nodeIdByPublicNode, related),
			))
		}
	}
}
