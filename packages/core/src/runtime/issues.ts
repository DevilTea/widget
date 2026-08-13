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

export interface DependencyIssueParams {
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly dependency: BlueprintDependencyReference
	readonly message: string
	readonly received?: unknown
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
		...(params.received === undefined ? {} : { received: params.received }),
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
		...(params.received === undefined ? {} : { received: params.received }),
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
