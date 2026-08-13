/**
 * Blueprint issue construction helpers.
 *
 * Normative source: issue #10 checkpoint C, amendments "Blueprint diagnostic locations and dependency
 * issue surface", "callback addIssue() relative authoring" and consolidated handoff §7.
 *
 * Plugin callbacks never build absolute `Issue.source` objects (COMMENT 14): they only add relative
 * `{ message, path? }`-shaped inputs through a local collector, and this module owns turning those into
 * the framework-owned absolute source shapes.
 */

import type { BlueprintWidgetNode, ResolvedBlueprintWidgetNode } from '../internal/contract'
import type {
	BlueprintConfigIssueSource,
	BlueprintDefinitionIssueSource,
	BlueprintDependencyIssueLocation,
	BlueprintDependencyIssueSource,
	BlueprintDependencyMember,
	BlueprintDependencyReference,
	BlueprintIssue,
	BlueprintStructureIssueLocation,
	BlueprintStructureIssueSource,
	BlueprintWidgetIssueLocation,
	IssueCollector,
	IssuePath,
} from '../issue'
import type { NonEmptyReadonlyArray, WidgetMemberKey } from '../types'

/**
 * Creates a fresh operation-local collector. `hasAnyIssue()` only ever observes issues added through
 * this exact collector instance.
 */
export function createCollector<Input>(): { readonly collector: IssueCollector<Input>, readonly items: Input[] } {
	const items: Input[] = []

	return {
		items,
		collector: {
			addIssue: issue => items.push(issue),
			hasAnyIssue: () => items.length > 0,
		},
	}
}

/**
 * Wraps a (possibly already-deduplicated) array as the `NonEmptyReadonlyArray` the public issue
 * sources require, or `undefined` when it would be empty.
 */
export function toNonEmpty<T>(items: readonly T[]): NonEmptyReadonlyArray<T> | undefined {
	return items.length > 0 ? (items as unknown as NonEmptyReadonlyArray<T>) : undefined
}

export function widgetLocation(node: BlueprintWidgetNode): BlueprintWidgetIssueLocation {
	return { type: 'widget', node }
}

export function slotLocation(node: ResolvedBlueprintWidgetNode, slot: WidgetMemberKey): BlueprintStructureIssueLocation {
	return { type: 'slot', node, slot }
}

export function slotChildLocation(node: ResolvedBlueprintWidgetNode, slot: WidgetMemberKey, index: number): BlueprintStructureIssueLocation {
	return { type: 'slot-child', node, slot, index }
}

export function propertyLocation(node: ResolvedBlueprintWidgetNode, name: WidgetMemberKey): BlueprintDependencyIssueLocation {
	return { type: 'property', node, name }
}

export function methodLocation(node: ResolvedBlueprintWidgetNode, name: WidgetMemberKey): BlueprintDependencyIssueLocation {
	return { type: 'method', node, name }
}

export function definitionIssue(
	node: BlueprintWidgetNode,
	message: string,
	path?: IssuePath,
	related?: readonly BlueprintWidgetIssueLocation[],
): BlueprintIssue {
	const source: BlueprintDefinitionIssueSource = {
		type: 'definition',
		node,
		...(path !== undefined ? { path } : {}),
		...(toNonEmpty(related ?? []) !== undefined ? { related: toNonEmpty(related ?? []) } : {}),
	}
	return { source, message }
}

export function configIssue(
	node: ResolvedBlueprintWidgetNode,
	message: string,
	input: unknown,
	path?: IssuePath,
	related?: readonly BlueprintWidgetIssueLocation[],
): BlueprintIssue {
	const source: BlueprintConfigIssueSource = {
		type: 'config',
		node,
		input,
		...(path !== undefined ? { path } : {}),
		...(toNonEmpty(related ?? []) !== undefined ? { related: toNonEmpty(related ?? []) } : {}),
	}
	return { source, message }
}

export function structureIssue(
	node: ResolvedBlueprintWidgetNode,
	message: string,
	slot?: WidgetMemberKey,
	index?: number,
	related?: readonly BlueprintStructureIssueLocation[],
): BlueprintIssue {
	const relatedField = toNonEmpty(related ?? [])

	const source = (
		slot === undefined
			? { type: 'structure' as const, node, ...(relatedField !== undefined ? { related: relatedField } : {}) }
			: index === undefined
				? { type: 'structure' as const, node, slot, ...(relatedField !== undefined ? { related: relatedField } : {}) }
				: { type: 'structure' as const, node, slot, index, ...(relatedField !== undefined ? { related: relatedField } : {}) }
	) satisfies BlueprintStructureIssueSource

	return { source, message }
}

export function dependencyIssue(
	node: ResolvedBlueprintWidgetNode,
	member: BlueprintDependencyMember,
	message: string,
	dependency?: BlueprintDependencyReference,
	related?: readonly BlueprintDependencyIssueLocation[],
): BlueprintIssue {
	const source: BlueprintDependencyIssueSource = {
		type: 'dependency',
		node,
		member,
		...(dependency !== undefined ? { dependency } : {}),
		...(toNonEmpty(related ?? []) !== undefined ? { related: toNonEmpty(related ?? []) } : {}),
	}
	return { source, message }
}

/**
 * Deduplicates locations by a caller-supplied identity key while preserving first-seen order.
 */
export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
	const seen = new Set<string>()
	const result: T[] = []
	for (const item of items) {
		const itemKey = key(item)
		if (seen.has(itemKey))
			continue
		seen.add(itemKey)
		result.push(item)
	}
	return result
}
