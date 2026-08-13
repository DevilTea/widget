/**
 * Runtime Issue construction helpers.
 *
 * Framework code is the only thing that ever builds an absolute Runtime Issue; plugin callbacks only
 * author `RelativeValueIssueInput`. This module centralizes the field-injection rules of issue #10
 * consolidated handoff §12 so every call site stays consistent (semantic payload field names,
 * `related` restricted to the direct target primitive, canonical `EMPTY_ISSUES` reuse on success).
 */

import type { BlueprintDependencyReference, RelativeValueIssueInput, RuntimeIssueLocation, RuntimeLevelIssue, RuntimeMethodArgsIssueSource, RuntimeMethodDependencyIssue, RuntimeMethodDependencyIssueSource, RuntimeMethodIssue, RuntimeMethodResultIssueSource, RuntimePropertyDependencyIssue, RuntimePropertyDependencyIssueSource, RuntimePropertyIssue, RuntimePropertyResultIssueSource, RuntimeStateIssue, RuntimeStateOverrideIssueSource, RuntimeStateValidationIssueSource } from '../issue'
import type { WidgetId, WidgetMemberKey } from '../types'
import { EMPTY_ISSUES } from '../issue'

/**
 * Picks the canonical empty snapshot on success so `alien-signals` strict-inequality change
 * detection sees success -> success as unchanged, and returns a fresh finalized array otherwise.
 */
export function toIssueSnapshot<Issue>(issues: readonly Issue[]): readonly Issue[] {
	return issues.length > 0 ? issues : EMPTY_ISSUES
}

// -------------------------------------------------------------------------------------------------
// Shared issue-snapshot immutability helpers
//
// A completed non-empty issue snapshot is an immutable final artifact (issue #10 issue-snapshot
// contract): it is stored as a primitive's latest `getIssues()` state *and* returned as
// `ExecutionResult.failure.issues` for the very same call (Runtime side), or as a node's diagnostic
// snapshot (Blueprint side), so an external mutation through one view must not silently corrupt the
// other. `deepFreezeIssue`/`freezeIssueSnapshot` are intentionally generic (`unknown`-shaped, no
// Runtime-only or Blueprint-only type) so both the Runtime issue-construction path (this module) and
// the Blueprint issue-finalization path can share one canonical implementation.
// -------------------------------------------------------------------------------------------------

/** Freezes `value` in place when it is an array; a no-op otherwise (including `undefined`). */
function freezeIfArray(value: unknown): void {
	if (Array.isArray(value))
		Object.freeze(value)
}

/** Freezes `value` in place when it is a non-null object; a no-op otherwise. */
function freezeIfObject(value: unknown): void {
	if (typeof value === 'object' && value !== null)
		Object.freeze(value)
}

/**
 * Freezes the `related` array itself and each location/reference wrapper object inside it (shallowly —
 * a wrapper's own further-nested fields, e.g. a Blueprint node a location wrapper merely references,
 * belong to whichever layer owns that object and are left untouched here).
 */
function freezeRelatedField(related: unknown): void {
	if (!Array.isArray(related))
		return
	for (const location of related)
		freezeIfObject(location)
	Object.freeze(related)
}

/**
 * Freezes a compiled `BlueprintDependencyReference` structural wrapper: the reference object itself
 * plus its nested `target`/`operation` wrapper objects. Never touches anything beyond that shape.
 */
function freezeDependencyField(dependency: unknown): void {
	if (typeof dependency !== 'object' || dependency === null)
		return
	const record = dependency as Record<string, unknown>
	freezeIfObject(record.target)
	freezeIfObject(record.operation)
	Object.freeze(dependency)
}

/**
 * Recursively freezes the framework-owned *diagnostic structure* of one Issue: the issue object
 * itself, its `source` object, and the known framework-owned structural wrapper fields inside
 * `source` — `path` (an array of `PropertyKey`s), `related` (an array of location/reference wrapper
 * objects) and `dependency` (a compiled dependency reference, plus its nested `target`/`operation`
 * wrappers).
 *
 * Deliberately does **not** freeze arbitrary caller/plugin-owned payload values carried purely for
 * diagnostic display — `candidate`, `result`, `args`, `input`, `received` — nor any object a
 * structural wrapper merely *references* but does not own (e.g. a Blueprint node embedded in a
 * location wrapper, or a Blueprint node stored directly on a `source`). Idempotent: freezing an
 * already-frozen value is a safe no-op, so this may be called more than once on the same issue.
 */
export function deepFreezeIssue<T>(issue: T): T {
	if (typeof issue !== 'object' || issue === null)
		return issue

	const source = (issue as { source?: unknown }).source
	if (typeof source === 'object' && source !== null) {
		const sourceRecord = source as Record<string, unknown>
		freezeIfArray(sourceRecord.path)
		freezeRelatedField(sourceRecord.related)
		freezeDependencyField(sourceRecord.dependency)
		Object.freeze(source)
	}

	return Object.freeze(issue)
}

/**
 * Freezes an entire completed issue snapshot in place: every issue via {@link deepFreezeIssue}, then
 * the array itself. Returns the very same array reference (never a copy), since callers rely on that
 * identity (e.g. `getIssues()` returning the exact array stored in a signal / the exact array also
 * returned as `ExecutionResult.failure.issues`).
 */
export function freezeIssueSnapshot<T>(issues: readonly T[]): readonly T[] {
	for (const issue of issues)
		deepFreezeIssue(issue)
	return Object.freeze(issues)
}

export function buildStateValidationIssue(
	widgetId: WidgetId,
	key: WidgetMemberKey,
	candidate: unknown,
	input: RelativeValueIssueInput,
): RuntimeStateIssue {
	const source: RuntimeStateValidationIssueSource = {
		type: 'state-validation',
		widgetId,
		key,
		candidate,
		...(input.path === undefined ? {} : { path: input.path }),
	}
	return { source, message: input.message }
}

/**
 * The fallback issue committed when a boolean-guarded callback (`state.validate` /
 * `method.validateArgs`) rejects its candidate without recording any issue of its own.
 *
 * [INTERPRETATION] issue #10 does not specify this case explicitly; ExecutionResult failures require
 * a non-empty issues array, so an implicit rejection still needs one diagnostic.
 */
export function buildDefaultStateValidationIssue(widgetId: WidgetId, key: WidgetMemberKey, candidate: unknown): RuntimeStateIssue {
	return buildStateValidationIssue(widgetId, key, candidate, { message: 'The candidate value failed state validation.' })
}

export function buildPropertyResultIssue(
	widgetId: WidgetId,
	name: WidgetMemberKey,
	result: unknown,
	input: RelativeValueIssueInput,
): RuntimePropertyIssue {
	const source: RuntimePropertyResultIssueSource = {
		type: 'property-result',
		widgetId,
		name,
		result,
		...(input.path === undefined ? {} : { path: input.path }),
	}
	return { source, message: input.message }
}

export function buildMethodArgsIssue(
	widgetId: WidgetId,
	name: WidgetMemberKey,
	args: readonly unknown[],
	input: RelativeValueIssueInput,
): RuntimeMethodIssue {
	const source: RuntimeMethodArgsIssueSource = {
		type: 'method-args',
		widgetId,
		name,
		args,
		...(input.path === undefined ? {} : { path: input.path }),
	}
	return { source, message: input.message }
}

/**
 * The fallback issue committed when `method.validateArgs` rejects its arguments without recording any
 * issue of its own. See {@link buildDefaultStateValidationIssue}.
 */
export function buildDefaultMethodArgsIssue(widgetId: WidgetId, name: WidgetMemberKey, args: readonly unknown[]): RuntimeMethodIssue {
	return buildMethodArgsIssue(widgetId, name, args, { message: 'The method arguments failed validation.' })
}

export function buildMethodResultIssue(
	widgetId: WidgetId,
	name: WidgetMemberKey,
	result: unknown,
	input: RelativeValueIssueInput,
): RuntimeMethodIssue {
	const source: RuntimeMethodResultIssueSource = {
		type: 'method-result',
		widgetId,
		name,
		result,
		...(input.path === undefined ? {} : { path: input.path }),
	}
	return { source, message: input.message }
}

/**
 * Presence-carrying box for the dependency `received` field: `undefined` is itself a valid rejected
 * value, so field presence must be tracked separately from the value it carries — an omitted box means
 * "no `received` field at all" (a wrapped target failure); a box whose `value` happens to be
 * `undefined` still means "emit `received: undefined` as an own property" (a refinement rejecting an
 * actual `undefined` candidate).
 */
export interface ReceivedBox {
	readonly value: unknown
}

export interface DependencyIssueParams {
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly dependency: BlueprintDependencyReference
	readonly message: string
	readonly received?: ReceivedBox
	readonly related: RuntimeIssueLocation
}

/**
 * A consumer-local `property-dependency` issue: either a wrapped 1:1 target-primitive failure or a
 * `.validate()` refinement rejection. `related` always points only at the direct target primitive
 * location.
 *
 * [INTERPRETATION] issue #10's dependency-leaf table does not explicitly say whether `related` is set
 * on refinement-rejection issues (only on wrapped target failures); this implementation sets it
 * uniformly since the direct target location is always known and `related` is otherwise documented as
 * "the direct target primitive" without qualifying the failure origin.
 */
export function buildPropertyDependencyIssue(params: DependencyIssueParams): RuntimePropertyDependencyIssue {
	const source: RuntimePropertyDependencyIssueSource = {
		type: 'property-dependency',
		widgetId: params.widgetId,
		name: params.name,
		dependency: params.dependency,
		...(params.received === undefined ? {} : { received: params.received.value }),
		related: [params.related],
	}
	return { source, message: params.message }
}

export function buildMethodDependencyIssue(params: DependencyIssueParams): RuntimeMethodDependencyIssue {
	const source: RuntimeMethodDependencyIssueSource = {
		type: 'method-dependency',
		widgetId: params.widgetId,
		name: params.name,
		dependency: params.dependency,
		...(params.received === undefined ? {} : { received: params.received.value }),
		related: [params.related],
	}
	return { source, message: params.message }
}

export function buildTopLevelStateOverrideIssue(message: string): RuntimeLevelIssue {
	const source: RuntimeStateOverrideIssueSource = { type: 'state-override' }
	return { source, message }
}

export function buildWidgetStateOverrideIssue(widgetId: WidgetId, message: string): RuntimeLevelIssue {
	const source: RuntimeStateOverrideIssueSource = { type: 'state-override', widgetId }
	return { source, message }
}

export function buildKeyStateOverrideIssue(widgetId: WidgetId, key: WidgetMemberKey, message: string): RuntimeLevelIssue {
	const source: RuntimeStateOverrideIssueSource = { type: 'state-override', widgetId, key }
	return { source, message }
}
