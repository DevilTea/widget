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

export function createCollector<Input>(): { readonly collector: DiagnosticCollector<Input>, readonly items: Input[] } {
	const items: Input[] = []
	return {
		items,
		collector: {
			addDiagnostic: diagnostic => items.push(diagnostic),
			hasAnyDiagnostic: () => items.length > 0,
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

function definitionCode(message: string, path: DiagnosticPath | undefined): BlueprintDefinitionDiagnostic['code'] {
	if (path === undefined)
		return 'invalid-widget-definition'
	const first = path[0]
	if (first === 'id')
		return 'invalid-widget-id'
	if (first === 'type')
		return message.startsWith('Unknown plugin type') ? 'unknown-widget-type' : 'invalid-widget-type'
	if (first === 'config')
		return message.includes('no config capability') ? 'unexpected-widget-config' : 'invalid-widget-definition'
	if (first === 'slots') {
		if (message.includes('not declared'))
			return 'undeclared-widget-slot'
		if (message.includes('must be an array'))
			return 'invalid-widget-slot'
		if (message.includes('no slots capability'))
			return 'unexpected-widget-slots'
		return 'invalid-widget-slots'
	}
	return 'invalid-widget-definition'
}

export function definitionDiagnostic(node: BlueprintWidgetNode, message: string, path?: DiagnosticPath, related?: readonly BlueprintWidgetDiagnosticLocation[]): BlueprintDiagnostic {
	const code = definitionCode(message, path)
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

function dependencyCode(message: string): BlueprintDependencyDiagnostic['code'] {
	if (message.includes('ambiguous'))
		return 'ambiguous-dependency-target'
	if (message.includes('could not be resolved'))
		return 'unresolved-dependency-target'
	if (message.includes('does not exist'))
		return 'missing-dependency-target'
	if (message.includes('no state capability') || message.includes('no properties capability') || message.includes('no methods capability'))
		return 'missing-dependency-capability'
	if (message.includes('no state member') || message.includes('no property') || message.includes('no method'))
		return 'missing-dependency-member'
	if (message.includes('invokes writeful'))
		return 'property-dependency-has-write-effects'
	return 'property-evaluation-cycle'
}

export function dependencyDiagnostic(node: ResolvedBlueprintWidgetNode, member: BlueprintDependencyMember, message: string, dependency?: BlueprintDependencyReference, related?: readonly BlueprintDependencyDiagnosticLocation[]): BlueprintDependencyDiagnostic {
	const location: BlueprintDependencyDiagnosticLocation = member.type === 'property'
		? propertyLocation(node, member.name)
		: methodLocation(node, member.name)
	return {
		code: dependencyCode(message),
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
