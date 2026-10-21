/** Framework-owned Blueprint diagnostic construction helpers. */

import type {
	BlueprintConfigDiagnostic,
	BlueprintDefinitionDiagnostic,
	BlueprintDependencyDiagnostic,
	BlueprintDependencyDiagnosticLocation,
	BlueprintDependencyMember,
	BlueprintDependencyReference,
	BlueprintDiagnostic,
	BlueprintStructureDiagnostic,
	BlueprintStructureDiagnosticLocation,
	BlueprintWidgetDiagnosticLocation,
	DiagnosticCollector,
	DiagnosticPath,
} from '../diagnostic'
import type { BlueprintWidgetNode, ResolvedBlueprintWidgetNode } from '../internal/contract'
import type { NonEmptyReadonlyArray, WidgetMemberKey } from '../types'
import { throwClosedCollector } from '../runtime/sync'

/**
 * A compile-time callback's collector. `close()` ends its plugin-facing lifetime once the callback has
 * returned or thrown; a later `addDiagnostic` / `hasAnyDiagnostic` call then throws.
 */
export function createCollector<Input>(): { readonly collector: DiagnosticCollector<Input>, readonly items: Input[], readonly close: () => void } {
	const items: Input[] = []
	let closed = false
	return {
		items,
		collector: {
			addDiagnostic: (diagnostic) => {
				if (closed)
					throwClosedCollector('addDiagnostic')
				items.push(diagnostic)
			},
			hasAnyDiagnostic: () => {
				if (closed)
					throwClosedCollector('hasAnyDiagnostic')
				return items.length > 0
			},
		},
		close: () => {
			closed = true
		},
	}
}

export function toNonEmpty<T>(items: readonly T[]): NonEmptyReadonlyArray<T> | undefined {
	return items.length === 0 ? undefined : items as NonEmptyReadonlyArray<T>
}

export function widgetLocation(node: BlueprintWidgetNode): BlueprintWidgetDiagnosticLocation {
	return { type: 'widget', node }
}

export function slotLocation(node: ResolvedBlueprintWidgetNode, slot: WidgetMemberKey): BlueprintStructureDiagnosticLocation {
	return { type: 'slot', node, slot }
}

export function slotChildLocation(node: ResolvedBlueprintWidgetNode, slot: WidgetMemberKey, index: number): BlueprintStructureDiagnosticLocation {
	return { type: 'slot-child', node, slot, index }
}

export function propertyLocation(node: ResolvedBlueprintWidgetNode, name: WidgetMemberKey): BlueprintDependencyDiagnosticLocation {
	return { type: 'property', node, name }
}

export function methodLocation(node: ResolvedBlueprintWidgetNode, name: WidgetMemberKey): BlueprintDependencyDiagnosticLocation {
	return { type: 'method', node, name }
}

export function definitionDiagnostic(node: BlueprintWidgetNode, code: BlueprintDefinitionDiagnostic['code'], message: string, path?: DiagnosticPath, related?: readonly BlueprintWidgetDiagnosticLocation[]): BlueprintDiagnostic {
	const location = widgetLocation(node)
	return {
		code,
		location,
		message,
		...(path === undefined ? {} : { path }),
		...(toNonEmpty(related ?? []) === undefined ? {} : { related: toNonEmpty(related ?? []) }),
	} as BlueprintDiagnostic
}

export function configDiagnostic(node: ResolvedBlueprintWidgetNode, message: string, path?: DiagnosticPath, reason?: string): BlueprintConfigDiagnostic {
	return {
		code: 'invalid-widget-config',
		location: widgetLocation(node),
		message,
		...(path === undefined ? {} : { path }),
		...(reason === undefined ? {} : { reason }),
	}
}

export function structureDiagnostic(node: ResolvedBlueprintWidgetNode, message: string, slot?: WidgetMemberKey, index?: number, related?: readonly BlueprintStructureDiagnosticLocation[], reason?: string): BlueprintStructureDiagnostic {
	const location: BlueprintStructureDiagnosticLocation = slot === undefined
		? widgetLocation(node)
		: index === undefined ? slotLocation(node, slot) : slotChildLocation(node, slot, index)
	return {
		code: 'invalid-widget-structure',
		location,
		message,
		...(toNonEmpty(related ?? []) === undefined ? {} : { related: toNonEmpty(related ?? []) }),
		...(reason === undefined ? {} : { reason }),
	}
}

export function dependencyDiagnostic(node: ResolvedBlueprintWidgetNode, member: BlueprintDependencyMember, code: BlueprintDependencyDiagnostic['code'], message: string, dependency?: BlueprintDependencyReference, related?: readonly BlueprintDependencyDiagnosticLocation[]): BlueprintDependencyDiagnostic {
	const location: BlueprintDependencyDiagnosticLocation = member.type === 'property'
		? propertyLocation(node, member.name)
		: methodLocation(node, member.name)
	return {
		code,
		location,
		message,
		...(dependency === undefined ? {} : { dependency }),
		...(toNonEmpty(related ?? []) === undefined ? {} : { related: toNonEmpty(related ?? []) }),
	} as BlueprintDependencyDiagnostic
}

export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
	const seen = new Set<string>()
	const result: T[] = []
	for (const item of items) {
		const itemKey = key(item)
		if (!seen.has(itemKey)) {
			seen.add(itemKey)
			result.push(item)
		}
	}
	return result
}
