/** Framework-owned Runtime diagnostic construction and snapshot helpers. */

import type {
	BlueprintDependencyReference,
	RelativeValueDiagnosticInput,
	RuntimeDependencyTargetFailedDiagnostic,
	RuntimeDiagnostic,
	RuntimeDiagnosticLocation,
	RuntimeLevelDiagnostic,
	RuntimeMethodArgsDiagnostic,
	RuntimeMethodDependencyDiagnostic,
	RuntimeMethodResultDiagnostic,
	RuntimePropertyDependencyDiagnostic,
	RuntimePropertyResultDiagnostic,
	RuntimeStateDiagnostic,
} from '../diagnostic'
import type { WidgetId, WidgetMemberKey } from '../types'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'

export function toDiagnosticSnapshot<T>(diagnostics: readonly T[]): readonly T[] {
	return diagnostics.length === 0 ? EMPTY_DIAGNOSTICS : Object.freeze(diagnostics)
}

function freezeArray(value: unknown): void {
	if (Array.isArray(value))
		Object.freeze(value)
}

function freezeObject(value: unknown): void {
	if (typeof value === 'object' && value !== null)
		Object.freeze(value)
}

function freezeRelated(related: unknown): void {
	if (!Array.isArray(related))
		return
	for (const item of related)
		freezeObject(item)
	Object.freeze(related)
}

function freezeDependency(dependency: unknown): void {
	if (typeof dependency !== 'object' || dependency === null)
		return
	const record = dependency as Record<string, unknown>
	freezeObject(record.target)
	freezeObject(record.operation)
	Object.freeze(dependency)
}

/** Freeze the framework-owned diagnostic record without executing or freezing arbitrary payload objects. */
export function deepFreezeDiagnostic<T>(diagnostic: T): T {
	if (typeof diagnostic !== 'object' || diagnostic === null)
		return diagnostic

	const record = diagnostic as Record<string, unknown>
	freezeObject(record.location)
	freezeArray(record.path)
	freezeRelated(record.related)
	freezeDependency(record.dependency)
	if (record.cause !== undefined)
		deepFreezeDiagnostic(record.cause)
	Object.freeze(diagnostic)
	return diagnostic
}

export function freezeDiagnosticSnapshot<T>(diagnostics: readonly T[]): readonly T[] {
	for (const diagnostic of diagnostics)
		deepFreezeDiagnostic(diagnostic)
	return Object.freeze(diagnostics)
}

function stateLocation(widgetId: WidgetId, key: WidgetMemberKey) {
	return { type: 'state' as const, widgetId, key }
}

function propertyLocation(widgetId: WidgetId, name: WidgetMemberKey) {
	return { type: 'property' as const, widgetId, name }
}

function methodLocation(widgetId: WidgetId, name: WidgetMemberKey) {
	return { type: 'method' as const, widgetId, name }
}

export function buildStateValidationDiagnostic(widgetId: WidgetId, key: WidgetMemberKey, candidate: unknown, input: RelativeValueDiagnosticInput): RuntimeStateDiagnostic {
	return {
		code: 'invalid-state-value',
		location: stateLocation(widgetId, key),
		candidate,
		message: input.message,
		...(input.path === undefined ? {} : { path: input.path }),
		...(input.reason === undefined ? {} : { reason: input.reason }),
	}
}

export function buildDefaultStateValidationDiagnostic(widgetId: WidgetId, key: WidgetMemberKey, candidate: unknown): RuntimeStateDiagnostic {
	return buildStateValidationDiagnostic(widgetId, key, candidate, { message: 'The candidate value failed state validation.' })
}

export function buildPropertyResultDiagnostic(widgetId: WidgetId, name: WidgetMemberKey, result: unknown, input: RelativeValueDiagnosticInput): RuntimePropertyResultDiagnostic {
	return {
		code: 'invalid-property-result',
		location: propertyLocation(widgetId, name),
		result,
		message: input.message,
		...(input.path === undefined ? {} : { path: input.path }),
		...(input.reason === undefined ? {} : { reason: input.reason }),
	}
}

export function buildMethodArgsDiagnostic(widgetId: WidgetId, name: WidgetMemberKey, args: readonly unknown[], input: RelativeValueDiagnosticInput): RuntimeMethodArgsDiagnostic {
	return {
		code: 'invalid-method-arguments',
		location: methodLocation(widgetId, name),
		args,
		message: input.message,
		...(input.path === undefined ? {} : { path: input.path }),
		...(input.reason === undefined ? {} : { reason: input.reason }),
	}
}

export function buildDefaultMethodArgsDiagnostic(widgetId: WidgetId, name: WidgetMemberKey, args: readonly unknown[]): RuntimeMethodArgsDiagnostic {
	return buildMethodArgsDiagnostic(widgetId, name, args, { message: 'The method arguments failed validation.' })
}

export function buildMethodResultDiagnostic(widgetId: WidgetId, name: WidgetMemberKey, result: unknown, input: RelativeValueDiagnosticInput): RuntimeMethodResultDiagnostic {
	return {
		code: 'invalid-method-result',
		location: methodLocation(widgetId, name),
		result,
		message: input.message,
		...(input.path === undefined ? {} : { path: input.path }),
		...(input.reason === undefined ? {} : { reason: input.reason }),
	}
}

export interface ReceivedBox { readonly value: unknown }

export interface DependencyDiagnosticParams {
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly dependency: BlueprintDependencyReference
	readonly message: string
	readonly received?: ReceivedBox
	readonly cause?: RuntimeDiagnostic
	readonly related: RuntimeDiagnosticLocation
}

export function buildPropertyDependencyDiagnostic(params: DependencyDiagnosticParams): RuntimePropertyDependencyDiagnostic {
	const base = {
		location: propertyLocation(params.widgetId, params.name),
		dependency: params.dependency,
		related: [params.related] as const,
		message: params.message,
	}
	if (params.received !== undefined)
		return { ...base, code: 'dependency-value-rejected', received: params.received.value } as RuntimePropertyDependencyDiagnostic
	return { ...base, code: 'dependency-target-failed', cause: params.cause! } as RuntimeDependencyTargetFailedDiagnostic & { location: { type: 'property', widgetId: WidgetId, name: WidgetMemberKey } }
}

export function buildMethodDependencyDiagnostic(params: DependencyDiagnosticParams): RuntimeMethodDependencyDiagnostic {
	const base = {
		location: methodLocation(params.widgetId, params.name),
		dependency: params.dependency,
		related: [params.related] as const,
		message: params.message,
	}
	if (params.received !== undefined)
		return { ...base, code: 'dependency-value-rejected', received: params.received.value } as RuntimeMethodDependencyDiagnostic
	return { ...base, code: 'dependency-target-failed', cause: params.cause! } as RuntimeDependencyTargetFailedDiagnostic & { location: { type: 'method', widgetId: WidgetId, name: WidgetMemberKey } }
}

export function buildTopLevelStateOverrideDiagnostic(message: string): RuntimeLevelDiagnostic {
	return { code: 'invalid-state-overrides', location: { type: 'runtime' }, message }
}

export function buildWidgetStateOverrideDiagnostic(widgetId: WidgetId, message: string): RuntimeLevelDiagnostic {
	return { code: 'unknown-state-override-widget', location: { type: 'runtime' }, path: [widgetId], message }
}

export function buildUnsupportedStateOverrideDiagnostic(widgetId: WidgetId, message: string): RuntimeLevelDiagnostic {
	return { code: 'unsupported-state-override-target', location: { type: 'runtime' }, path: [widgetId], message }
}

export function buildInvalidStateOverrideFragmentDiagnostic(widgetId: WidgetId, message: string): RuntimeLevelDiagnostic {
	return { code: 'invalid-state-override-fragment', location: { type: 'runtime' }, path: [widgetId], message }
}

export function buildKeyStateOverrideDiagnostic(widgetId: WidgetId, key: WidgetMemberKey, message: string): RuntimeLevelDiagnostic {
	return { code: 'unknown-state-override-member', location: { type: 'runtime' }, path: [widgetId, key], message }
}
