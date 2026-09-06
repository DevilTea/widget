import type { InspectableValue } from './value'
import {
	isBlueprintNode as isWireBlueprintNode,
	isEvaluationCycle as isWireEvaluationCycle,
	isNodeId as isWireNodeId,
	isRuntimeMemberSnapshot as isWireRuntimeMemberSnapshot,
} from './validation'

export interface InspectorProtocolVersion {
	readonly major: number
	readonly minor: number
}

export const INSPECTOR_PROTOCOL_VERSION = Object.freeze({ major: 0, minor: 1 }) satisfies InspectorProtocolVersion

export interface InspectorCapabilities {
	readonly methods: readonly InspectorRequestMethod[]
	readonly events: readonly InspectorEventName[]
}

export interface WidgetRef {
	readonly runtimeId: string
	readonly nodeId: number
}

export interface InspectorMemberRef {
	readonly type: 'state' | 'property'
	readonly name: string
}

export interface InspectorBlueprintCapabilities {
	readonly config: boolean
	readonly slots: boolean
	readonly state: boolean
	readonly properties: boolean
	readonly methods: boolean
}

export interface InspectorSlot {
	readonly name: string
	readonly placement?: 'slot' | 'raw-slot'
	readonly children: readonly number[]
}

export interface InspectorDependencyReference {
	readonly target:
		| { readonly type: 'self' }
		| { readonly type: 'root' }
		| { readonly type: 'parent', readonly optional: boolean }
		| { readonly type: 'widget', readonly widgetId: string, readonly optional: boolean }
	readonly operation:
		| { readonly type: 'state-get', readonly key: string }
		| { readonly type: 'state-set', readonly key: string }
		| { readonly type: 'property-get', readonly name: string }
		| { readonly type: 'method-invoke', readonly name: string }
}

export type InspectorDependency
	= | {
		readonly status: 'resolved'
		readonly path: readonly (string | number)[]
		readonly reference: InspectorDependencyReference
		readonly target: {
			readonly nodeId: number
			readonly member: { readonly type: 'state' | 'property' | 'method', readonly name: string }
		}
	}
	| {
		readonly status: 'absent'
		readonly path: readonly (string | number)[]
		readonly reference: InspectorDependencyReference
	}
	| {
		readonly status: 'invalid'
		readonly path: readonly (string | number)[]
		readonly reference: InspectorDependencyReference
		readonly targetNodeId?: number
	}

export interface InspectorStateMember {
	readonly type: 'state'
	readonly name: string
}

export interface InspectorPropertyMember {
	readonly type: 'property'
	readonly name: string
	readonly dependencies: readonly InspectorDependency[]
}

export interface InspectorMethodMember {
	readonly type: 'method'
	readonly name: string
	readonly transitivelyWrites: boolean
	readonly dependencies: readonly InspectorDependency[]
}

export type InspectorDiagnosticLocation
	= | { readonly type: 'source' }
		| { readonly type: 'widget', readonly nodeId: number }
		| { readonly type: 'slot', readonly nodeId: number, readonly slot: string }
		| { readonly type: 'slot-child', readonly nodeId: number, readonly slot: string, readonly index: number }
		| { readonly type: 'property', readonly nodeId: number, readonly name: string }
		| { readonly type: 'method', readonly nodeId: number, readonly name: string }

export interface InspectorDiagnostic {
	readonly code: string
	readonly message: string
	readonly location: InspectorDiagnosticLocation
	readonly related?: readonly InspectorDiagnosticLocation[]
	readonly path?: readonly (string | number)[]
	readonly reason?: string
	readonly dependency?: InspectorDependencyReference
}

export interface InspectorBlueprintNode {
	readonly nodeId: number
	readonly resolved: boolean
	readonly widgetId?: string
	readonly widgetType?: string
	readonly capabilities?: InspectorBlueprintCapabilities
	readonly sourceSlots: readonly InspectorSlot[]
	readonly semanticSlots?: readonly InspectorSlot[]
	readonly state?: readonly InspectorStateMember[]
	readonly properties?: readonly InspectorPropertyMember[]
	readonly methods?: readonly InspectorMethodMember[]
	readonly diagnostics: readonly InspectorDiagnostic[]
}

export interface InspectorEvaluationCycle {
	readonly members: readonly {
		readonly nodeId: number
		readonly member: { readonly type: 'property' | 'method', readonly name: string }
	}[]
}

export interface InspectorBlueprintSnapshot {
	readonly runtimeId: string
	readonly rootNodeId: number
	readonly nodes: readonly InspectorBlueprintNode[]
	readonly invalidCycles: readonly InspectorEvaluationCycle[]
}

export interface InspectorRuntimeStateSnapshot {
	readonly type: 'state'
	readonly name: string
	readonly value: InspectableValue
}

export type InspectorRuntimePropertyResult
	= | { readonly ok: true, readonly value: InspectableValue }
		| {
			readonly ok: false
			readonly diagnostics: readonly InspectorRuntimeDiagnostic[]
		}

export interface InspectorRuntimeDiagnosticLocation {
	readonly type: 'state' | 'property' | 'method'
	readonly widgetId: string
	readonly name: string
}

export interface InspectorRuntimeDiagnostic {
	readonly code: string
	readonly message: string
	readonly location: InspectorRuntimeDiagnosticLocation
	readonly path?: readonly (string | number)[]
	readonly reason?: string
	readonly dependency?: InspectorDependencyReference
	readonly candidate?: InspectableValue
	readonly received?: InspectableValue
	readonly result?: InspectableValue
	readonly args?: readonly InspectableValue[]
	readonly related?: readonly InspectorRuntimeDiagnosticLocation[]
	readonly cause?: InspectorRuntimeDiagnostic
}

export interface InspectorRuntimePropertySnapshot {
	readonly type: 'property'
	readonly name: string
	readonly snapshot:
		| { readonly status: 'never-evaluated' }
		| { readonly status: 'completed', readonly result: InspectorRuntimePropertyResult }
}

export type InspectorRuntimeMemberSnapshot = InspectorRuntimeStateSnapshot | InspectorRuntimePropertySnapshot

export interface InspectorRuntimeWidgetSnapshot {
	readonly ref: WidgetRef
	readonly widgetId: string
	readonly widgetType: string
	readonly members: readonly InspectorRuntimeMemberSnapshot[]
}

export interface InspectorRuntimeSummary {
	readonly runtimeId: string
	readonly rootNodeId: number
}

export interface InspectorHandshakeResult {
	readonly protocol: InspectorProtocolVersion
	readonly capabilities: InspectorCapabilities
}

export interface InspectorSubscriptionSnapshot {
	readonly subscriptionId: string
	readonly member: InspectorRuntimeMemberSnapshot
}

export interface InspectorRequestMap {
	readonly 'handshake': {
		readonly params: { readonly protocol: InspectorProtocolVersion }
		readonly result: InspectorHandshakeResult
	}
	readonly 'runtime.list': {
		readonly params: Record<string, never>
		readonly result: { readonly runtimes: readonly InspectorRuntimeSummary[] }
	}
	readonly 'blueprint.getSnapshot': {
		readonly params: { readonly runtimeId: string }
		readonly result: InspectorBlueprintSnapshot
	}
	readonly 'runtime.getWidgetSnapshot': {
		readonly params: { readonly ref: WidgetRef }
		readonly result: InspectorRuntimeWidgetSnapshot
	}
	readonly 'runtime.subscribeMember': {
		readonly params: { readonly ref: WidgetRef, readonly member: InspectorMemberRef }
		readonly result: InspectorSubscriptionSnapshot
	}
	readonly 'runtime.unsubscribeMember': {
		readonly params: { readonly subscriptionId: string }
		readonly result: { readonly removed: boolean }
	}
	readonly 'inspect.enable': {
		readonly params: Record<string, never>
		readonly result: { readonly enabled: true }
	}
	readonly 'inspect.disable': {
		readonly params: Record<string, never>
		readonly result: { readonly enabled: false }
	}
	readonly 'highlight.show': {
		readonly params: { readonly ref: WidgetRef }
		readonly result: { readonly highlighted: boolean }
	}
	readonly 'highlight.clear': {
		readonly params: Record<string, never>
		readonly result: { readonly highlighted: false }
	}
}

export type InspectorRequestMethod = keyof InspectorRequestMap
export type InspectorRequestParams<Method extends InspectorRequestMethod> = InspectorRequestMap[Method]['params']
export type InspectorRequestResult<Method extends InspectorRequestMethod> = InspectorRequestMap[Method]['result']

export interface InspectorProtocolError {
	readonly code:
		| 'invalid-message'
		| 'unsupported-version'
		| 'unknown-method'
		| 'invalid-params'
		| 'runtime-not-found'
		| 'widget-not-found'
		| 'member-not-found'
		| 'disconnected'
		| 'internal-error'
	readonly message: string
}

export type InspectorRequestMessage = {
	[Method in InspectorRequestMethod]: {
		readonly protocol: InspectorProtocolVersion
		readonly kind: 'request'
		readonly requestId: string
		readonly method: Method
		readonly params: InspectorRequestParams<Method>
	}
}[InspectorRequestMethod]

export type InspectorResponseMessage
	= | {
		readonly protocol: InspectorProtocolVersion
		readonly kind: 'response'
		readonly requestId: string
		readonly ok: true
		readonly result: unknown
	}
	| {
		readonly protocol: InspectorProtocolVersion
		readonly kind: 'response'
		readonly requestId: string
		readonly ok: false
		readonly error: InspectorProtocolError
	}

export interface InspectorEventMap {
	readonly 'runtime.memberChanged': {
		readonly subscriptionId: string
		readonly ref: WidgetRef
		readonly member: InspectorRuntimeMemberSnapshot
	}
	readonly 'inspect.hovered': {
		readonly ref: WidgetRef | null
		readonly widgetId?: string
		readonly widgetType?: string
	}
	readonly 'inspect.selected': {
		readonly ref: WidgetRef
		readonly widgetId: string
		readonly widgetType: string
	}
	readonly 'agent.status': {
		readonly inspectEnabled: boolean
	}
}

export type InspectorEventName = keyof InspectorEventMap
export type InspectorEventMessage = {
	[Event in InspectorEventName]: {
		readonly protocol: InspectorProtocolVersion
		readonly kind: 'event'
		readonly event: Event
		readonly payload: InspectorEventMap[Event]
	}
}[InspectorEventName]

export type InspectorMessage = InspectorRequestMessage | InspectorResponseMessage | InspectorEventMessage

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyEmptyRecord(value: unknown): value is Record<string, never> {
	return isRecord(value) && Object.keys(value).length === 0
}

function isProtocolVersion(value: unknown): value is InspectorProtocolVersion {
	return isRecord(value)
		&& Number.isInteger(value.major)
		&& typeof value.major === 'number'
		&& value.major >= 0
		&& Number.isInteger(value.minor)
		&& typeof value.minor === 'number'
		&& value.minor >= 0
}

function isWidgetRef(value: unknown): value is WidgetRef {
	return isRecord(value)
		&& typeof value.runtimeId === 'string'
		&& isWireNodeId(value.nodeId)
}

function isMemberRef(value: unknown): value is InspectorMemberRef {
	return isRecord(value)
		&& (value.type === 'state' || value.type === 'property')
		&& typeof value.name === 'string'
}

export function isInspectorRequestMethod(value: unknown): value is InspectorRequestMethod {
	return value === 'handshake'
		|| value === 'runtime.list'
		|| value === 'blueprint.getSnapshot'
		|| value === 'runtime.getWidgetSnapshot'
		|| value === 'runtime.subscribeMember'
		|| value === 'runtime.unsubscribeMember'
		|| value === 'inspect.enable'
		|| value === 'inspect.disable'
		|| value === 'highlight.show'
		|| value === 'highlight.clear'
}

export function isInspectorRequestParams<Method extends InspectorRequestMethod>(
	method: Method,
	value: unknown,
): value is InspectorRequestParams<Method> {
	switch (method) {
		case 'handshake':
			return isRecord(value) && isProtocolVersion(value.protocol)
		case 'runtime.list':
		case 'inspect.enable':
		case 'inspect.disable':
		case 'highlight.clear':
			return hasOnlyEmptyRecord(value)
		case 'blueprint.getSnapshot':
			return isRecord(value) && typeof value.runtimeId === 'string'
		case 'runtime.getWidgetSnapshot':
		case 'highlight.show':
			return isRecord(value) && isWidgetRef(value.ref)
		case 'runtime.subscribeMember':
			return isRecord(value) && isWidgetRef(value.ref) && isMemberRef(value.member)
		case 'runtime.unsubscribeMember':
			return isRecord(value) && typeof value.subscriptionId === 'string'
	}
}

export function parseInspectorRequestMessage(value: unknown): InspectorRequestMessage | null {
	if (!isRecord(value)
		|| value.kind !== 'request'
		|| !isProtocolVersion(value.protocol)
		|| typeof value.requestId !== 'string'
		|| !isInspectorRequestMethod(value.method)
		|| !isInspectorRequestParams(value.method, value.params)) {
		return null
	}

	return value as InspectorRequestMessage
}

function isProtocolErrorCode(value: unknown): value is InspectorProtocolError['code'] {
	return value === 'invalid-message' || value === 'unsupported-version' || value === 'unknown-method'
		|| value === 'invalid-params' || value === 'runtime-not-found' || value === 'widget-not-found'
		|| value === 'member-not-found' || value === 'disconnected' || value === 'internal-error'
}

function isProtocolError(value: unknown): value is InspectorProtocolError {
	return isRecord(value) && isProtocolErrorCode(value.code) && typeof value.message === 'string'
}

export function parseInspectorResponseMessage(value: unknown): InspectorResponseMessage | null {
	if (!isRecord(value)
		|| value.kind !== 'response'
		|| !isProtocolVersion(value.protocol)
		|| typeof value.requestId !== 'string'
		|| typeof value.ok !== 'boolean') {
		return null
	}

	if (value.ok)
		return 'result' in value ? value as InspectorResponseMessage : null
	return isProtocolError(value.error) ? value as InspectorResponseMessage : null
}

function isRuntimeMemberSnapshot(value: unknown): value is InspectorRuntimeMemberSnapshot {
	return isWireRuntimeMemberSnapshot(value)
}

function isRuntimeSummary(value: unknown): value is InspectorRuntimeSummary {
	return isRecord(value)
		&& typeof value.runtimeId === 'string'
		&& isWireNodeId(value.rootNodeId)
}

function isBlueprintSnapshot(value: unknown): value is InspectorBlueprintSnapshot {
	return isRecord(value)
		&& typeof value.runtimeId === 'string'
		&& isWireNodeId(value.rootNodeId)
		&& Array.isArray(value.nodes)
		&& value.nodes.every(isWireBlueprintNode)
		&& Array.isArray(value.invalidCycles)
		&& value.invalidCycles.every(isWireEvaluationCycle)
}

export function isInspectorRequestResult<Method extends InspectorRequestMethod>(
	method: Method,
	value: unknown,
): value is InspectorRequestResult<Method> {
	switch (method) {
		case 'handshake':
			return isRecord(value)
				&& isProtocolVersion(value.protocol)
				&& isRecord(value.capabilities)
				&& Array.isArray(value.capabilities.methods)
				&& value.capabilities.methods.every(isInspectorRequestMethod)
				&& Array.isArray(value.capabilities.events)
				&& value.capabilities.events.every(isInspectorEventName)
		case 'runtime.list':
			return isRecord(value) && Array.isArray(value.runtimes) && value.runtimes.every(isRuntimeSummary)
		case 'blueprint.getSnapshot':
			return isBlueprintSnapshot(value)
		case 'runtime.getWidgetSnapshot':
			return isRecord(value)
				&& isWidgetRef(value.ref)
				&& typeof value.widgetId === 'string'
				&& typeof value.widgetType === 'string'
				&& Array.isArray(value.members)
				&& value.members.every(isRuntimeMemberSnapshot)
		case 'runtime.subscribeMember':
			return isRecord(value)
				&& typeof value.subscriptionId === 'string'
				&& isRuntimeMemberSnapshot(value.member)
		case 'runtime.unsubscribeMember':
			return isRecord(value) && typeof value.removed === 'boolean'
		case 'inspect.enable':
			return isRecord(value) && value.enabled === true
		case 'inspect.disable':
			return isRecord(value) && value.enabled === false
		case 'highlight.show':
			return isRecord(value) && typeof value.highlighted === 'boolean'
		case 'highlight.clear':
			return isRecord(value) && value.highlighted === false
	}
}

function isInspectorEventName(value: unknown): value is InspectorEventName {
	return value === 'runtime.memberChanged'
		|| value === 'inspect.hovered'
		|| value === 'inspect.selected'
		|| value === 'agent.status'
}

export function parseInspectorEventMessage(value: unknown): InspectorEventMessage | null {
	if (!isRecord(value)
		|| value.kind !== 'event'
		|| !isProtocolVersion(value.protocol)
		|| !isInspectorEventName(value.event)
		|| !isRecord(value.payload)) {
		return null
	}

	switch (value.event) {
		case 'runtime.memberChanged':
			return typeof value.payload.subscriptionId === 'string'
				&& isWidgetRef(value.payload.ref)
				&& isRuntimeMemberSnapshot(value.payload.member)
				? value as InspectorEventMessage
				: null
		case 'inspect.hovered':
			return (value.payload.ref === null || isWidgetRef(value.payload.ref))
				&& (value.payload.widgetId === undefined || typeof value.payload.widgetId === 'string')
				&& (value.payload.widgetType === undefined || typeof value.payload.widgetType === 'string')
				? value as InspectorEventMessage
				: null
		case 'inspect.selected':
			return isWidgetRef(value.payload.ref)
				&& typeof value.payload.widgetId === 'string'
				&& typeof value.payload.widgetType === 'string'
				? value as InspectorEventMessage
				: null
		case 'agent.status':
			return typeof value.payload.inspectEnabled === 'boolean' ? value as InspectorEventMessage : null
	}
}

export function isCompatibleProtocolVersion(remote: InspectorProtocolVersion): boolean {
	return remote.major === INSPECTOR_PROTOCOL_VERSION.major
}
