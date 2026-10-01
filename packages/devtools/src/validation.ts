import type {
	InspectorBlueprintCapabilities,
	InspectorBlueprintNode,
	InspectorConfigMetadata,
	InspectorDependency,
	InspectorDependencyReference,
	InspectorDiagnostic,
	InspectorDiagnosticLocation,
	InspectorEvaluationCycle,
	InspectorEventMember,
	InspectorRuntimeDiagnostic,
	InspectorRuntimeDiagnosticLocation,
	InspectorRuntimeMemberSnapshot,
	InspectorSlot,
} from './protocol'
import type { InspectableValue } from './value'

const BLUEPRINT_METADATA_PROTOCOL_MINOR: number = 2

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return true
	if (typeof value === 'number')
		return Number.isFinite(value)
	if (Array.isArray(value)) {
		if (seen.has(value))
			return false
		seen.add(value)
		const valid = value.every(item => isJsonValue(item, seen))
		seen.delete(value)
		return valid
	}
	if (!isRecord(value))
		return false
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null)
		return false
	if (seen.has(value))
		return false
	seen.add(value)
	const valid = Object.values(value)
		.every(item => isJsonValue(item, seen))
	seen.delete(value)
	return valid
}

function isConfigMetadata(value: unknown): value is InspectorConfigMetadata {
	return isRecord(value)
		&& typeof value.description === 'string'
		// A Draft 2020-12 document is an object or a boolean schema, not an arbitrary JSON scalar.
		// Validate the wire shape only; keyword and metaschema validity remain the author's responsibility.
		&& (value.schema === null
			|| typeof value.schema === 'boolean'
			|| (isRecord(value.schema) && isJsonValue(value.schema)))
}

export function isNodeId(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function isPath(value: unknown): value is readonly (string | number)[] {
	return Array.isArray(value)
		&& value.every(segment => typeof segment === 'string'
			|| (typeof segment === 'number' && Number.isInteger(segment)))
}

function readArrayLength(value: unknown[]): number | null {
	try {
		const length = value.length
		return Number.isInteger(length) && length >= 0 && length <= 0xFFFF_FFFF
			? length
			: null
	}
	catch {
		return null
	}
}

function hasArrayIndex(value: unknown[], index: number): boolean | null {
	try {
		return index in value
	}
	catch {
		return null
	}
}

function readArrayIndex(value: unknown[], index: number): { readonly ok: true, readonly value: unknown } | { readonly ok: false } {
	try {
		return { ok: true, value: value[index] }
	}
	catch {
		return { ok: false }
	}
}

type InspectableValueValidationFrame
	= | { readonly kind: 'value', readonly value: unknown }
		| {
			readonly kind: 'array'
			readonly value: object
			readonly items: unknown[]
			readonly index: number
			readonly length: number
		}
		| {
			readonly kind: 'object'
			readonly value: object
			readonly entries: unknown[]
			readonly index: number
			readonly length: number
		}

export function isInspectableValue(value: unknown): value is InspectableValue {
	const ancestors = new Set<object>()
	const stack: InspectableValueValidationFrame[] = [{ kind: 'value', value }]

	while (stack.length > 0) {
		const frame = stack.pop()!
		if (frame.kind === 'array') {
			if (frame.index >= frame.length) {
				ancestors.delete(frame.value)
				continue
			}
			const present = hasArrayIndex(frame.items, frame.index)
			if (present === null)
				return false
			stack.push({ ...frame, index: frame.index + 1 })
			if (!present)
				continue
			const item = readArrayIndex(frame.items, frame.index)
			if (!item.ok)
				return false
			stack.push({ kind: 'value', value: item.value })
			continue
		}
		if (frame.kind === 'object') {
			if (frame.index >= frame.length) {
				ancestors.delete(frame.value)
				continue
			}
			const present = hasArrayIndex(frame.entries, frame.index)
			if (present === null)
				return false
			stack.push({ ...frame, index: frame.index + 1 })
			if (!present)
				continue
			const entryResult = readArrayIndex(frame.entries, frame.index)
			if (!entryResult.ok)
				return false
			const entry = entryResult.value
			if (!isRecord(entry) || typeof entry.key !== 'string')
				return false
			stack.push({ kind: 'value', value: entry.value })
			continue
		}

		const candidate = frame.value
		if (!isRecord(candidate) || typeof candidate.type !== 'string')
			return false

		switch (candidate.type) {
			case 'null':
			case 'undefined':
				break
			case 'boolean':
				if (typeof candidate.value !== 'boolean')
					return false
				break
			case 'string':
				if (typeof candidate.value !== 'string' || typeof candidate.truncated !== 'boolean')
					return false
				break
			case 'number':
				if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value))
					return false
				break
			case 'number-special':
				if (candidate.value !== 'nan' && candidate.value !== 'positive-infinity'
					&& candidate.value !== 'negative-infinity' && candidate.value !== 'negative-zero') {
					return false
				}
				break
			case 'bigint':
				if (typeof candidate.value !== 'string')
					return false
				break
			case 'array': {
				if (!isNodeId(candidate.id) || !Array.isArray(candidate.items) || typeof candidate.truncated !== 'boolean')
					return false
				if (ancestors.has(candidate))
					return false
				const length = readArrayLength(candidate.items)
				if (length === null)
					return false
				ancestors.add(candidate)
				stack.push({
					kind: 'array',
					value: candidate,
					items: candidate.items,
					index: 0,
					length,
				})
				break
			}
			case 'object': {
				if (!isNodeId(candidate.id) || !Array.isArray(candidate.entries) || typeof candidate.truncated !== 'boolean')
					return false
				if (ancestors.has(candidate))
					return false
				const length = readArrayLength(candidate.entries)
				if (length === null)
					return false
				ancestors.add(candidate)
				stack.push({
					kind: 'object',
					value: candidate,
					entries: candidate.entries,
					index: 0,
					length,
				})
				break
			}
			case 'reference':
				if (!isNodeId(candidate.ref))
					return false
				break
			case 'opaque':
				if (candidate.kind !== 'function' && candidate.kind !== 'symbol' && candidate.kind !== 'dom-node'
					&& candidate.kind !== 'class-instance' && candidate.kind !== 'uninspectable'
					&& candidate.kind !== 'unknown-object') {
					return false
				}
				break
			case 'truncated':
				if (candidate.reason !== 'max-depth')
					return false
				break
			default:
				return false
		}
	}

	return true
}

export function isBlueprintCapabilities(
	value: unknown,
	protocolMinor = BLUEPRINT_METADATA_PROTOCOL_MINOR,
): value is InspectorBlueprintCapabilities {
	return isRecord(value)
		&& typeof value.config === 'boolean'
		&& typeof value.slots === 'boolean'
		&& typeof value.state === 'boolean'
		&& typeof value.properties === 'boolean'
		&& typeof value.methods === 'boolean'
		&& (protocolMinor < BLUEPRINT_METADATA_PROTOCOL_MINOR
			? (value.events === undefined || typeof value.events === 'boolean')
			: typeof value.events === 'boolean')
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

function isEventMember(value: unknown): value is InspectorEventMember {
	return isRecord(value) && value.type === 'event' && typeof value.name === 'string' && typeof value.description === 'string'
}

function isMethodMember(value: unknown): boolean {
	return isRecord(value) && value.type === 'method' && typeof value.name === 'string'
		&& typeof value.transitivelyWrites === 'boolean'
		&& Array.isArray(value.dependencies) && value.dependencies.every(isDependency)
}

export function isBlueprintNode(
	value: unknown,
	protocolMinor = BLUEPRINT_METADATA_PROTOCOL_MINOR,
): value is InspectorBlueprintNode {
	if (!isRecord(value) || !isNodeId(value.nodeId) || typeof value.resolved !== 'boolean'
		|| !Array.isArray(value.sourceSlots) || !value.sourceSlots.every(isSlot)
		|| !Array.isArray(value.diagnostics) || !value.diagnostics.every(isDiagnostic)) {
		return false
	}
	if (!value.resolved)
		return true
	return typeof value.widgetId === 'string' && typeof value.widgetType === 'string'
		&& isBlueprintCapabilities(value.capabilities, protocolMinor)
		&& (protocolMinor < BLUEPRINT_METADATA_PROTOCOL_MINOR
			? (value.config === undefined || value.config === null || isConfigMetadata(value.config))
			: (value.config === null || isConfigMetadata(value.config)))
		&& Array.isArray(value.semanticSlots) && value.semanticSlots.every(isSlot)
		&& Array.isArray(value.state) && value.state.every(isStateMember)
		&& Array.isArray(value.properties) && value.properties.every(isPropertyMember)
		&& Array.isArray(value.methods) && value.methods.every(isMethodMember)
		&& (protocolMinor < BLUEPRINT_METADATA_PROTOCOL_MINOR
			? (value.events === undefined || (Array.isArray(value.events) && value.events.every(isEventMember)))
			: (Array.isArray(value.events) && value.events.every(isEventMember)))
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
