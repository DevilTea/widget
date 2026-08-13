/**
 * Structure validation — compile pipeline step 6 (consolidated handoff §10).
 *
 * Normative source: issue #10 checkpoint C ("Structure validation"), amendment "callback addIssue()
 * relative authoring" (COMMENT 14) and consolidated handoff §6/§7.
 *
 * Scopes run in order slot -> plugin -> system. Every resolved node runs its own slot/plugin
 * validators (in node-recovery order); the single system validator runs once, last.
 */

import type { InternalNodeId, ResolvedBlueprintWidgetNode } from '../internal/contract'
import type { BlueprintIssue, RelativePluginStructureIssueInput, RelativeSlotStructureIssueInput, RelativeSystemStructureIssueInput } from '../issue'
import type { AnyWidgetPluginTuple } from '../plugin'
import type { WidgetSystem } from '../system'
import type { WorkingNode } from './recovery'
import type { Navigator } from './view'
import { readWidgetPluginDefinition } from '../plugin'
import { createCollector, structureIssue } from './issues'

function configFragment(node: WorkingNode): Record<string, unknown> {
	return node.plugin !== null && readWidgetPluginDefinition(node.plugin).config !== null
		? { config: node.config }
		: {}
}

export function runStructureValidation(
	system: WidgetSystem<AnyWidgetPluginTuple>,
	nodes: readonly WorkingNode[],
	semanticOrder: readonly InternalNodeId[],
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

				slotDefinition.validateStructure({
					widget: publicNode,
					slot: slotName,
					children,
					blueprint: navigator,
					...configFragment(node),
					...collector,
				})

				for (const item of items)
					finalIssues.push(structureIssue(publicNode, item.message, slotName, item.index))
			}
		}

		if (definition.validateStructure !== null) {
			const { collector, items } = createCollector<RelativePluginStructureIssueInput>()

			definition.validateStructure({
				widget: publicNode,
				blueprint: navigator,
				...configFragment(node),
				...collector,
			})

			for (const item of items) {
				const slot = 'slot' in item ? item.slot : undefined
				const index = 'index' in item ? item.index : undefined
				finalIssues.push(structureIssue(publicNode, item.message, slot, index))
			}
		}
	}

	if (system.validateStructure !== null) {
		const { collector, items } = createCollector<RelativeSystemStructureIssueInput>()

		system.validateStructure({
			blueprint: navigator,
			...collector,
		})

		for (const item of items) {
			const { location, related } = item
			finalIssues.push(structureIssue(
				location.node as ResolvedBlueprintWidgetNode,
				item.message,
				location.type === 'widget' ? undefined : location.slot,
				location.type === 'slot-child' ? location.index : undefined,
				related,
			))
		}
	}
}
