import type {
	InspectorBlueprintCapabilities,
	InspectorBlueprintNode,
	InspectorDependency,
	InspectorDependencyReference,
	InspectorDiagnostic,
	InspectorDiagnosticLocation,
	InspectorEvaluationCycle,
	InspectorRuntimeDiagnostic,
	InspectorRuntimeDiagnosticLocation,
	InspectorRuntimeMemberSnapshot,
	InspectorSlot,
} from './protocol'
import type { InspectableValue } from './value'

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNodeId(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function isPath(value: unknown): value is readonly (string | number)[] {
	return Array.isArray(value)
		&& value.every(segment => typeof segment === 'string'
			|| (typeof segment === 'number' && Number.isInteger(segment)))
}

export function isInspectableValue(value: unknown): value is InspectableValue {
	if (!isRecord(value) || typeof value.type !== 'string')
		return false
	switch (value.type) {
		case 'null':
		case 'undefined':
			return true
		case 'boolean':
			return typeof value.value === 'boolean'
		case 'string':
			return typeof value.value === 'string' && typeof value.truncated === 'boolean'
		case 'number':
			return typeof value.value === 'number' && Number.isFinite(value.value)
		case 'number-special':
			return value.value === 'nan' || value.value === 'positive-infinity'
				|| value.value === 'negative-infinity' || value.value === 'negative-zero'
		case 'bigint':
			return typeof value.value === 'string'
		case 'array':
			return isNodeId(value.id) && Array.isArray(value.items)
				&& value.items.every(isInspectableValue) && typeof value.truncated === 'boolean'
		case 'object':
			return isNodeId(value.id) && Array.isArray(value.entries)
				&& value.entries.every(entry => isRecord(entry)
					&& typeof entry.key === 'string' && isInspectableValue(entry.value))
				&& typeof value.truncated === 'boolean'
		case 'reference':
			return isNodeId(value.ref)
		case 'opaque':
			return value.kind === 'function' || value.kind === 'symbol' || value.kind === 'dom-node'
				|| value.kind === 'class-instance' || value.kind === 'uninspectable' || value.kind === 'unknown-object'
		case 'truncated':
			return value.reason === 'max-depth'
		default:
			return false
	}
}

export function isBlueprintCapabilities(value: unknown): value is InspectorBlueprintCapabilities {
	return isRecord(value)
		&& typeof value.config === 'boolean'
		&& typeof value.slots === 'boolean'
		&& typeof value.state === 'boolean'
		&& typeof value.properties === 'boolean'
		&& typeof value.methods === 'boolean'
}

export function isSlot(value: unknown): value is InspectorSlot {
	return isRecord(value)
		&& typeof value.name === 'string'
		&& (value.placement === undefined || value.placement === 'slot' || value.placement === 'raw-slot')
		&& Array.isArray(value.children)
		&& value.children.every(isNodeId)
}

export function isDependencyReference(value: unknown): value is InspectorDependencyReference {
	if (!isRecord(value) || !isRecord(value.target) || !isRecord(value.operation))
		return false
	const target = value.target
	const targetOk = target.type === 'self'
		|| target.type === 'root'
		|| (target.type === 'parent' && typeof target.optional === 'boolean')
		|| (target.type === 'widget' && typeof target.widgetId === 'string' && typeof target.optional === 'boolean')
	if (!targetOk)
		return false
	const operation = value.operation
	return (operation.type === 'state-get' && typeof operation.key === 'string')
		|| (operation.type === 'state-set' && typeof operation.key === 'string')
		|| (operation.type === 'property-get' && typeof operation.name === 'string')
		|| (operation.type === 'method-invoke' && typeof operation.name === 'string')
}

function isDependencyMember(value: unknown): boolean {
	return isRecord(value)
		&& (value.type === 'state' || value.type === 'property' || value.type === 'method')
		&& typeof value.name === 'string'
}

export function isDependency(value: unknown): value is InspectorDependency {
	if (!isRecord(value) || !isPath(value.path) || !isDependencyReference(value.reference))
		return false
	if (value.status === 'absent')
		return true
	if (value.status === 'invalid')
		return value.targetNodeId === undefined || isNodeId(value.targetNodeId)
	return value.status === 'resolved'
		&& isRecord(value.target)
		&& isNodeId(value.target.nodeId)
		&& isDependencyMember(value.target.member)
}

export function isDiagnosticLocation(value: unknown): value is InspectorDiagnosticLocation {
	if (!isRecord(value) || typeof value.type !== 'string')
		return false
	switch (value.type) {
		case 'source':
			return true
		case 'widget':
			return isNodeId(value.nodeId)
		case 'slot':
			return isNodeId(value.nodeId) && typeof value.slot === 'string'
		case 'slot-child':
			return isNodeId(value.nodeId) && typeof value.slot === 'string' && isNodeId(value.index)
		case 'property':
		case 'method':
			return isNodeId(value.nodeId) && typeof value.name === 'string'
		default:
			return false
	}
}

export function isDiagnostic(value: unknown): value is InspectorDiagnostic {
	return isRecord(value)
		&& typeof value.code === 'string'
		&& typeof value.message === 'string'
		&& isDiagnosticLocation(value.location)
		&& (value.related === undefined || (Array.isArray(value.related) && value.related.every(isDiagnosticLocation)))
		&& (value.path === undefined || isPath(value.path))
		&& (value.reason === undefined || typeof value.reason === 'string')
		&& (value.dependency === undefined || isDependencyReference(value.dependency))
}

function isStateMember(value: unknown): boolean {
	return isRecord(value) && value.type === 'state' && typeof value.name === 'string'
}

function isPropertyMember(value: unknown): boolean {
	return isRecord(value) && value.type === 'property' && typeof value.name === 'string'
		&& Array.isArray(value.dependencies) && value.dependencies.every(isDependency)
}

function isMethodMember(value: unknown): boolean {
	return isRecord(value) && value.type === 'method' && typeof value.name === 'string'
		&& typeof value.transitivelyWrites === 'boolean'
		&& Array.isArray(value.dependencies) && value.dependencies.every(isDependency)
}

export function isBlueprintNode(value: unknown): value is InspectorBlueprintNode {
	if (!isRecord(value) || !isNodeId(value.nodeId) || typeof value.resolved !== 'boolean'
		|| !Array.isArray(value.sourceSlots) || !value.sourceSlots.every(isSlot)
		|| !Array.isArray(value.diagnostics) || !value.diagnostics.every(isDiagnostic)) {
		return false
	}
	if (!value.resolved)
		return true
	return typeof value.widgetId === 'string' && typeof value.widgetType === 'string'
		&& isBlueprintCapabilities(value.capabilities)
		&& Array.isArray(value.semanticSlots) && value.semanticSlots.every(isSlot)
		&& Array.isArray(value.state) && value.state.every(isStateMember)
		&& Array.isArray(value.properties) && value.properties.every(isPropertyMember)
		&& Array.isArray(value.methods) && value.methods.every(isMethodMember)
}

export function isEvaluationCycle(value: unknown): value is InspectorEvaluationCycle {
	return isRecord(value) && Array.isArray(value.members)
		&& value.members.every(item => isRecord(item) && isNodeId(item.nodeId)
			&& isRecord(item.member)
			&& (item.member.type === 'property' || item.member.type === 'method')
			&& typeof item.member.name === 'string')
}

export function isRuntimeDiagnosticLocation(value: unknown): value is InspectorRuntimeDiagnosticLocation {
	return isRecord(value)
		&& (value.type === 'state' || value.type === 'property' || value.type === 'method')
		&& typeof value.widgetId === 'string'
		&& typeof value.name === 'string'
}

export function isRuntimeDiagnostic(value: unknown): value is InspectorRuntimeDiagnostic {
	return isRecord(value)
		&& typeof value.code === 'string'
		&& typeof value.message === 'string'
		&& isRuntimeDiagnosticLocation(value.location)
		&& (value.path === undefined || isPath(value.path))
		&& (value.reason === undefined || typeof value.reason === 'string')
		&& (value.dependency === undefined || isDependencyReference(value.dependency))
		&& (value.candidate === undefined || isInspectableValue(value.candidate))
		&& (value.received === undefined || isInspectableValue(value.received))
		&& (value.result === undefined || isInspectableValue(value.result))
		&& (value.args === undefined || (Array.isArray(value.args) && value.args.every(isInspectableValue)))
		&& (value.related === undefined || (Array.isArray(value.related) && value.related.every(isRuntimeDiagnosticLocation)))
		&& (value.cause === undefined || isRuntimeDiagnostic(value.cause))
}

export function isRuntimeMemberSnapshot(value: unknown): value is InspectorRuntimeMemberSnapshot {
	if (!isRecord(value) || typeof value.name !== 'string')
		return false
	if (value.type === 'state')
		return isInspectableValue(value.value)
	if (value.type !== 'property' || !isRecord(value.snapshot))
		return false
	if (value.snapshot.status === 'never-evaluated')
		return true
	if (value.snapshot.status !== 'completed' || !isRecord(value.snapshot.result) || typeof value.snapshot.result.ok !== 'boolean')
		return false
	if (value.snapshot.result.ok)
		return isInspectableValue(value.snapshot.result.value)
	return Array.isArray(value.snapshot.result.diagnostics)
		&& value.snapshot.result.diagnostics.every(isRuntimeDiagnostic)
}
