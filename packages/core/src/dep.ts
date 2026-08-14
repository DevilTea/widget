/**
 * Dependency declaration grammar and registered/executed dependency type mapping.
 *
 * Normative source: issue #10 checkpoint D, amendments "RegisteredDeps recursive shape + conservative
 * optional typing", "dependency fluent grammar locked", "dependency resolution and compiled-edge
 * invariants" and consolidated handoff §8.
 */

import type { ExecutionResult } from './execution-result'
import type {
	BlueprintDependencyOperation,
	BlueprintDependencyReference,
	BlueprintDependencyTarget,
	RuntimeMethodDependencyIssue,
	RuntimePropertyDependencyIssue,
} from './issue'
import type {
	HasWidgetCapability,
	WidgetId,
	WidgetInterfaces,
	WidgetMemberKey,
	WidgetMethodArgsOf,
	WidgetMethodKeyOf,
	WidgetMethodReturnOf,
	WidgetPropertyKeyOf,
	WidgetPropertyValueOf,
	WidgetStateKeyOf,
	WidgetStateValueOf,
} from './types'

/**
 * Framework-private brand of a dependency expression leaf.
 *
 * Plugin code must never construct an expression manually or read its internals; leaves are opaque
 * and are only produced by the fluent `dep` builder.
 */
export const depExpressionBrand: unique symbol = Symbol('@deviltea/widget-core:dep-expression')

export type DependencyConsumer = 'property' | 'method'

/**
 * Conservative optional-target nullability: only a provable literal `false` removes the
 * absent-target `null`.
 */
export type MaybeOptional<Value, Optional extends boolean> = [Optional] extends [false]
	? Value
	: Value | null

export type DepExpressionMeta
	= | {
		readonly kind: 'state-get'
		readonly value: unknown
		readonly optional: boolean
	}
	| {
		readonly kind: 'state-set'
		readonly input: unknown
		readonly optional: boolean
	}
	| {
		readonly kind: 'property-get'
		readonly value: unknown
		readonly optional: boolean
	}
	| {
		readonly kind: 'method-invoke'
		readonly args: readonly unknown[]
		readonly value: unknown
		readonly optional: boolean
	}

/**
 * Any branded dependency expression leaf.
 */
export interface AnyDepExpression {
	readonly [depExpressionBrand]: DepExpressionMeta
}

export interface StateGetDepExpression<Value, Optional extends boolean> {
	readonly [depExpressionBrand]: {
		readonly kind: 'state-get'
		readonly value: Value
		readonly optional: Optional
	}

	/**
	 * Pure refinement of the read value. Repeatable, narrowing only, never part of the stable
	 * public dependency reference, and skipped entirely when an optional target is absent.
	 */
	validate: <Refined extends Value>(validate: (input: Value) => input is Refined) => StateGetDepExpression<Refined, Optional>
}

export interface StateSetDepExpression<Input, Optional extends boolean> {
	readonly [depExpressionBrand]: {
		readonly kind: 'state-set'
		readonly input: Input
		readonly optional: Optional
	}
}

export interface PropertyGetDepExpression<Value, Optional extends boolean> {
	readonly [depExpressionBrand]: {
		readonly kind: 'property-get'
		readonly value: Value
		readonly optional: Optional
	}

	validate: <Refined extends Value>(validate: (input: Value) => input is Refined) => PropertyGetDepExpression<Refined, Optional>
}

export interface MethodInvokeDepExpression<Args extends readonly unknown[], Value, Optional extends boolean> {
	readonly [depExpressionBrand]: {
		readonly kind: 'method-invoke'
		readonly args: Args
		readonly value: Value
		readonly optional: Optional
	}

	validate: <Refined extends Value>(validate: (input: Value) => input is Refined) => MethodInvokeDepExpression<Args, Refined, Optional>
}

/**
 * Arbitrary recursive readonly container whose leaves are branded dependency expressions.
 *
 * Container shape is free organization only; `registerDeps` is not a static data transport.
 */
export type RegisteredDeps
	= | AnyDepExpression
		| { readonly [key: string]: RegisteredDeps }
		| readonly RegisteredDeps[]

/**
 * Default for a member declared without `registerDeps`.
 */
export type EmptyRegisteredDeps = Record<never, never>

type DependencyIssueOf<Consumer extends DependencyConsumer> = Consumer extends 'property'
	? RuntimePropertyDependencyIssue
	: RuntimeMethodDependencyIssue

/**
 * Runtime materialization of one branded dependency leaf.
 *
 * Reads/invocations are callables returning `ExecutionResult`; state setters are write callables
 * whose absent-target no-op still succeeds with the original candidate.
 */
export type ToExecutedDep<Expression, Consumer extends DependencyConsumer> = Expression extends { readonly [depExpressionBrand]: infer Meta }
	? Meta extends { readonly kind: 'state-get', readonly value: infer Value, readonly optional: infer Optional extends boolean }
		? () => ExecutionResult<MaybeOptional<Value, Optional>, DependencyIssueOf<Consumer>>
		: Meta extends { readonly kind: 'state-set', readonly input: infer Input, readonly optional: boolean }
			? (candidate: Input) => ExecutionResult<Input, DependencyIssueOf<Consumer>>
			: Meta extends { readonly kind: 'property-get', readonly value: infer Value, readonly optional: infer Optional extends boolean }
				? () => ExecutionResult<MaybeOptional<Value, Optional>, DependencyIssueOf<Consumer>>
				: Meta extends { readonly kind: 'method-invoke', readonly args: infer Args extends readonly unknown[], readonly value: infer Value, readonly optional: infer Optional extends boolean }
					? (...args: Args) => ExecutionResult<MaybeOptional<Value, Optional>, DependencyIssueOf<Consumer>>
					: never
	: never

/**
 * Recursively maps a registered dependency container to its executed form.
 *
 * The branded leaf test happens before container recursion, exact object/array/tuple shape is
 * preserved, and the result is recursively readonly.
 */
export type ToExecutedDeps<Deps, Consumer extends DependencyConsumer> = Deps extends AnyDepExpression
	? ToExecutedDep<Deps, Consumer>
	: Deps extends readonly unknown[]
		? { readonly [Key in keyof Deps]: ToExecutedDeps<Deps[Key], Consumer> }
		: Deps extends object
			? { readonly [Key in keyof Deps]: ToExecutedDeps<Deps[Key], Consumer> }
			: never

// -------------------------------------------------------------------------------------------------
// Fluent declaration grammar
// -------------------------------------------------------------------------------------------------

/**
 * Capability grammar of an unknown plugin target (`root` / `parent` / `widget(id)`).
 *
 * Capability and member existence are Blueprint dependency-resolution concerns, so the whole
 * grammar is exposed and read values start at `unknown` until `.validate()` refines them.
 */
export interface UnknownTargetDependencyOperations<Consumer extends DependencyConsumer, Optional extends boolean> {
	readonly state: UnknownTargetStateDependencyOperations<Consumer, Optional>

	readonly properties: {
		get: (name: WidgetMemberKey) => PropertyGetDepExpression<unknown, Optional>
	}

	readonly methods: {
		invoke: (name: WidgetMemberKey) => MethodInvokeDepExpression<readonly unknown[], unknown, Optional>
	}
}

export type UnknownTargetStateDependencyOperations<Consumer extends DependencyConsumer, Optional extends boolean>
	= & {
		get: (key: WidgetMemberKey) => StateGetDepExpression<unknown, Optional>
	}
	& (Consumer extends 'method'
		? {
				set: (key: WidgetMemberKey) => StateSetDepExpression<unknown, Optional>
			}
		: unknown)

/**
 * `parent` / `widget(id)` target stage. `optional()` is exposed only here and disappears as soon as a
 * capability is selected; it modifies target existence only.
 */
export type OptionalizableDependencyTarget<Consumer extends DependencyConsumer>
	= & UnknownTargetDependencyOperations<Consumer, false>
		& {
			optional: () => UnknownTargetDependencyOperations<Consumer, true>
		}

export type SelfStateDependencyOperations<Interfaces extends WidgetInterfaces, Consumer extends DependencyConsumer>
	= & {
		get: <Key extends WidgetStateKeyOf<Interfaces>>(key: Key) => StateGetDepExpression<WidgetStateValueOf<Interfaces, Key> | null, false>
	}
	& (Consumer extends 'method'
		? {
				set: <Key extends WidgetStateKeyOf<Interfaces>>(key: Key) => StateSetDepExpression<WidgetStateValueOf<Interfaces, Key>, false>
			}
		: unknown)

export interface SelfPropertyDependencyOperations<Interfaces extends WidgetInterfaces> {
	get: <Name extends WidgetPropertyKeyOf<Interfaces>>(name: Name) => PropertyGetDepExpression<WidgetPropertyValueOf<Interfaces, Name> | null, false>
}

export interface SelfMethodDependencyOperations<Interfaces extends WidgetInterfaces> {
	invoke: <Name extends WidgetMethodKeyOf<Interfaces>>(name: Name) => MethodInvokeDepExpression<WidgetMethodArgsOf<Interfaces, Name>, WidgetMethodReturnOf<Interfaces, Name> | null, false>
}

/**
 * `self` target stage: guaranteed target, strongly typed, and capability-aware.
 *
 * Gated on `HasWidgetCapability` (declaration presence), never on whether the capability's own payload
 * type happens to be `never` — a declared-but-explicitly-empty capability (e.g. `state: Record<never,
 * never>`) still exposes its `dep.self.state` surface, just with an uncallable-with-any-real-key `get`.
 */
export type SelfDependencyTarget<Interfaces extends WidgetInterfaces, Consumer extends DependencyConsumer>
	= & (HasWidgetCapability<Interfaces, 'state'> extends true
		? { readonly state: SelfStateDependencyOperations<Interfaces, Consumer> }
		: unknown)
	& (HasWidgetCapability<Interfaces, 'properties'> extends true
		? { readonly properties: SelfPropertyDependencyOperations<Interfaces> }
		: unknown)
	& (HasWidgetCapability<Interfaces, 'methods'> extends true
		? { readonly methods: SelfMethodDependencyOperations<Interfaces> }
		: unknown)

/**
 * The `dep` grammar supplied to `registerDeps`.
 *
 * `dep.root` and `dep.widget(id)` stay unknown-typed even when they happen to designate the current
 * widget; precise typing is exclusive to `dep.self`.
 */
export interface DependencyBuilder<Interfaces extends WidgetInterfaces, Consumer extends DependencyConsumer> {
	readonly self: SelfDependencyTarget<Interfaces, Consumer>
	readonly root: UnknownTargetDependencyOperations<Consumer, false>
	readonly parent: OptionalizableDependencyTarget<Consumer>
	widget: (widgetId: WidgetId) => OptionalizableDependencyTarget<Consumer>
}

// -------------------------------------------------------------------------------------------------
// Internal representation
// -------------------------------------------------------------------------------------------------

/**
 * One `.validate()` refinement predicate, erased to its runtime shape.
 */
export type DependencyRefinement = (input: unknown) => boolean

/**
 * Framework-internal payload carried by every branded dependency leaf.
 */
export interface DepExpressionInternals {
	readonly reference: BlueprintDependencyReference
	readonly refinements: readonly DependencyRefinement[]
}

export function isDepExpression(value: unknown): value is AnyDepExpression {
	return typeof value === 'object' && value !== null && depExpressionBrand in value
}

/**
 * Reads the framework-internal payload of a branded dependency leaf.
 */
export function readDepExpression(expression: AnyDepExpression): DepExpressionInternals {
	return expression[depExpressionBrand] as unknown as DepExpressionInternals
}

function createDepExpression(internals: DepExpressionInternals, readable: boolean): AnyDepExpression {
	const expression = {
		[depExpressionBrand]: internals,
	} as Record<PropertyKey, unknown>

	if (readable) {
		expression.validate = (refinement: DependencyRefinement) => createDepExpression(
			{
				reference: internals.reference,
				refinements: [...internals.refinements, refinement],
			},
			true,
		)
	}

	return expression as unknown as AnyDepExpression
}

function createTargetOperations(target: BlueprintDependencyTarget): unknown {
	const leaf = (operation: BlueprintDependencyOperation, readable: boolean): AnyDepExpression => createDepExpression(
		{ reference: { target, operation }, refinements: [] },
		readable,
	)

	return {
		state: {
			get: (key: WidgetMemberKey) => leaf({ type: 'state-get', key }, true),
			set: (key: WidgetMemberKey) => leaf({ type: 'state-set', key }, false),
		},
		properties: {
			get: (name: WidgetMemberKey) => leaf({ type: 'property-get', name }, true),
		},
		methods: {
			invoke: (name: WidgetMemberKey) => leaf({ type: 'method-invoke', name }, true),
		},
	}
}

function createOptionalizableTarget(target: (optional: boolean) => BlueprintDependencyTarget): unknown {
	return {
		...createTargetOperations(target(false)) as object,
		optional: () => createTargetOperations(target(true)),
	}
}

/**
 * Creates the `dep` grammar object handed to `registerDeps`.
 *
 * The consumer kind only narrows the public type surface (`state.set` is invisible to Property
 * consumers); the runtime object is consumer-agnostic.
 */
export function createDependencyBuilder<
	Interfaces extends WidgetInterfaces,
	Consumer extends DependencyConsumer,
>(): DependencyBuilder<Interfaces, Consumer> {
	return {
		self: createTargetOperations({ type: 'self' }),
		root: createTargetOperations({ type: 'root' }),
		parent: createOptionalizableTarget(optional => ({ type: 'parent', optional })),
		widget: (widgetId: WidgetId) => createOptionalizableTarget(optional => ({ type: 'widget', widgetId, optional })),
	} as unknown as DependencyBuilder<Interfaces, Consumer>
}
