/**
 * Conformance tests — COMMENT 26 §1 type-level contract, dependency grammar half.
 *
 * Covers: dependency target-stage grammar (`optional()` only on the parent/widget target stage, and
 * only before a capability is chosen), the Property-vs-Method `state.set` surface split, `dep.self`'s
 * precise typing versus the generic `root`/`parent`/`widget(id)` grammar, `ToExecutedDeps` container
 * shape preservation and recursive readonly-ness, the conservative `MaybeOptional` nullability rule,
 * and `.validate()` refinement.
 *
 * Normative source: diagnostic #10 COMMENT 26 §1, COMMENT 9 (recursive shape + conservative optional
 * typing), COMMENT 10 (dependency fluent grammar locked), COMMENT 11 (resolution / compiled-edge
 * invariants).
 *
 * The `dep` builder itself has no public runtime constructor (`createDependencyBuilder` is an
 * internal export U2/U3 use directly; see `packages/widget/core/src/plugin.ts`'s docs), so this file
 * is a type-level suite: every assertion is either a positive `expectTypeOf` check or a `@ts-expect-error`
 * negative case. Negative cases are written as a function whose *parameter* carries the tested type and
 * whose body contains the rejected expression; the function is referenced (via `expectTypeOf`) but never
 * invoked, so the erroring line never actually executes.
 */

import type {
	DependencyBuilder,
	ExecutionResult,
	MaybeOptional,
	MethodInvokeDepExpression,
	OptionalizableDependencyTarget,
	PropertyGetDepExpression,
	RuntimeMethodDependencyDiagnostic,
	RuntimePropertyDependencyDiagnostic,
	SelfStateDependencyOperations,
	StateGetDepExpression,
	StateSetDepExpression,
	ToExecutedDeps,
	UnknownTargetDependencyOperations,
	UnknownTargetStateDependencyOperations,
	WidgetInterfaces,
} from './index'
import { describe, expectTypeOf, it } from 'vitest'

// -------------------------------------------------------------------------------------------------
// Fixture interfaces
// -------------------------------------------------------------------------------------------------

interface SampleInterfaces extends WidgetInterfaces {
	state: {
		count: number
		label: string
	}
	properties: {
		total: number
	}
	methods: {
		run: (amount: number) => string
	}
}

describe('dependency target-stage grammar', () => {
	it('exposes `optional()` only on the parent/widget target stage, not on self/root', () => {
		expectTypeOf<DependencyBuilder<SampleInterfaces, 'method'>['parent']>()
			.toHaveProperty('optional')
		expectTypeOf<ReturnType<DependencyBuilder<SampleInterfaces, 'method'>['widget']>>()
			.toHaveProperty('optional')
		expectTypeOf<DependencyBuilder<SampleInterfaces, 'method'>['self']>().not.toHaveProperty('optional')
		expectTypeOf<DependencyBuilder<SampleInterfaces, 'method'>['root']>().not.toHaveProperty('optional')
	})

	it('makes `optional()` disappear once a capability has been selected on the parent/widget target stage', () => {
		type AfterOptional = ReturnType<OptionalizableDependencyTarget<'method'>['optional']>
		expectTypeOf<AfterOptional>().not.toHaveProperty('optional')
		expectTypeOf<AfterOptional['state']>().not.toHaveProperty('optional')
		expectTypeOf<AfterOptional['properties']>().not.toHaveProperty('optional')
		expectTypeOf<AfterOptional['methods']>().not.toHaveProperty('optional')
	})

	it('rejects dep.parent.state.optional() (optional() is unavailable once a capability has been chosen)', () => {
		function attempt(builder: DependencyBuilder<SampleInterfaces, 'method'>): void {
			// @ts-expect-error optional() is exposed only immediately after target selection, not after choosing `state`
			builder.parent.state.optional()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('rejects dep.widget(id).properties.get(name).optional() (optional() is unavailable on a returned leaf expression)', () => {
		function attempt(builder: DependencyBuilder<SampleInterfaces, 'method'>): void {
			const leaf = builder.widget('other').properties.get('total')
			// @ts-expect-error optional() only exists on the target stage, never on a leaf expression it produced
			leaf.optional()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})
})

describe('state.set is Method-consumer only', () => {
	it('hides `state.set` from the Property-consumer self surface while keeping `state.get`', () => {
		expectTypeOf<SelfStateDependencyOperations<SampleInterfaces, 'property'>>().not.toHaveProperty('set')
		expectTypeOf<SelfStateDependencyOperations<SampleInterfaces, 'property'>>()
			.toHaveProperty('get')
	})

	it('exposes `state.set` on the Method-consumer self surface', () => {
		expectTypeOf<SelfStateDependencyOperations<SampleInterfaces, 'method'>>()
			.toHaveProperty('set')
		expectTypeOf<SelfStateDependencyOperations<SampleInterfaces, 'method'>>()
			.toHaveProperty('get')
	})

	it('hides `state.set` from the unknown-target (root/parent/widget) Property-consumer surface too', () => {
		expectTypeOf<UnknownTargetStateDependencyOperations<'property', false>>().not.toHaveProperty('set')
		expectTypeOf<UnknownTargetStateDependencyOperations<'method', false>>()
			.toHaveProperty('set')
	})

	it('rejects dep.self.state.set(...) for Property consumers', () => {
		function attempt(builder: DependencyBuilder<SampleInterfaces, 'property'>): void {
			// @ts-expect-error `state.set` does not exist on the Property-consumer dependency type surface
			builder.self.state.set('count')
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})
})

describe('toExecutedDeps preserves exact nested object/array/tuple shape', () => {
	it('maps a nested object/array/tuple RegisteredDeps container to its exact executed shape', () => {
		interface SampleDeps {
			primary: StateGetDepExpression<number, false>
			group: {
				current: PropertyGetDepExpression<string, false>
				actions: readonly [
					MethodInvokeDepExpression<[], void, false>,
					MethodInvokeDepExpression<[number], number, false>,
				]
			}
			children: readonly { id: StateGetDepExpression<string, true> }[]
		}

		type Executed = ToExecutedDeps<SampleDeps, 'method'>

		expectTypeOf<Executed>()
			.toEqualTypeOf<{
			readonly primary: () => ExecutionResult<number, RuntimeMethodDependencyDiagnostic>
			readonly group: {
				readonly current: () => ExecutionResult<string, RuntimeMethodDependencyDiagnostic>
				readonly actions: readonly [
					(...args: []) => ExecutionResult<void, RuntimeMethodDependencyDiagnostic>,
					(...args: [number]) => ExecutionResult<number, RuntimeMethodDependencyDiagnostic>,
				]
			}
			readonly children: readonly { readonly id: () => ExecutionResult<string | null, RuntimeMethodDependencyDiagnostic> }[]
		}>()
	})

	it('switches the executed dependency diagnostic type based on Consumer (property vs method)', () => {
		type Leaf = StateGetDepExpression<number, false>
		expectTypeOf<ToExecutedDeps<Leaf, 'property'>>()
			.toEqualTypeOf<() => ExecutionResult<number, RuntimePropertyDependencyDiagnostic>>()
		expectTypeOf<ToExecutedDeps<Leaf, 'method'>>()
			.toEqualTypeOf<() => ExecutionResult<number, RuntimeMethodDependencyDiagnostic>>()
	})

	it('keeps a state-set executed callable\'s candidate type exactly Input, regardless of Optional (never candidate | null)', () => {
		expectTypeOf<ToExecutedDeps<StateSetDepExpression<number, true>, 'method'>>()
			.toEqualTypeOf<(candidate: number) => ExecutionResult<number, RuntimeMethodDependencyDiagnostic>>()
	})
})

describe('executed dependency containers are recursively readonly', () => {
	it('rejects reassigning a nested executed tuple element', () => {
		interface SampleDeps {
			group: {
				actions: readonly [MethodInvokeDepExpression<[], void, false>]
			}
		}
		type Executed = ToExecutedDeps<SampleDeps, 'method'>

		function mutate(executed: Executed, replacement: Executed['group']['actions'][0]): void {
			// @ts-expect-error `actions` is a readonly tuple; index assignment is rejected
			executed.group.actions[0] = replacement
		}
		expectTypeOf(mutate).returns.toBeVoid()
	})

	it('rejects reassigning a nested executed object property', () => {
		interface SampleDeps {
			group: {
				current: PropertyGetDepExpression<string, false>
			}
		}
		type Executed = ToExecutedDeps<SampleDeps, 'method'>

		function mutate(executed: Executed, replacement: Executed['group']['current']): void {
			// @ts-expect-error `current` is a readonly property on the mapped executed object
			executed.group.current = replacement
		}
		expectTypeOf(mutate).returns.toBeVoid()
	})

	it('rejects replacing a whole executed readonly array', () => {
		interface SampleDeps {
			children: readonly { id: StateGetDepExpression<string, true> }[]
		}
		type Executed = ToExecutedDeps<SampleDeps, 'method'>

		function mutate(executed: Executed, replacement: Executed['children']): void {
			// @ts-expect-error `children` is a readonly array; whole-property reassignment is rejected
			executed.children = replacement
		}
		expectTypeOf(mutate).returns.toBeVoid()
	})
})

describe('optional-target nullability follows the conservative rule', () => {
	it('keeps the value type as-is when Optional is the literal `false`', () => {
		expectTypeOf<MaybeOptional<number, false>>()
			.toEqualTypeOf<number>()
	})

	it('adds `| null` when Optional is the literal `true`', () => {
		expectTypeOf<MaybeOptional<number, true>>()
			.toEqualTypeOf<number | null>()
	})

	it('adds `| null` when Optional is widened to the general `boolean` (only a literal `false` may remove nullability)', () => {
		expectTypeOf<MaybeOptional<number, boolean>>()
			.toEqualTypeOf<number | null>()
	})
})

describe('.validate() refinement narrows the read/return value only', () => {
	function refineStateGet(expr: StateGetDepExpression<unknown, false>) {
		return expr.validate((value): value is number => typeof value === 'number')
	}

	function refineStateGetOptional(expr: StateGetDepExpression<unknown, true>) {
		return expr.validate((value): value is number => typeof value === 'number')
	}

	function refinePropertyGet(expr: PropertyGetDepExpression<unknown, false>) {
		return expr.validate((value): value is string => typeof value === 'string')
	}

	function refineMethodInvoke(expr: MethodInvokeDepExpression<[number], unknown, false>) {
		return expr.validate((value): value is boolean => typeof value === 'boolean')
	}

	it('narrows StateGetDepExpression Value while preserving Optional=false', () => {
		expectTypeOf(refineStateGet).returns.toEqualTypeOf<StateGetDepExpression<number, false>>()
	})

	it('preserves Optional=true through .validate()', () => {
		expectTypeOf(refineStateGetOptional).returns.toEqualTypeOf<StateGetDepExpression<number, true>>()
	})

	it('narrows PropertyGetDepExpression Value via .validate()', () => {
		expectTypeOf(refinePropertyGet).returns.toEqualTypeOf<PropertyGetDepExpression<string, false>>()
	})

	it('narrows MethodInvokeDepExpression Value via .validate() while preserving Args', () => {
		expectTypeOf(refineMethodInvoke).returns.toEqualTypeOf<MethodInvokeDepExpression<[number], boolean, false>>()
	})

	it('rejects calling .validate() on a terminal StateSetDepExpression', () => {
		function attempt(expr: StateSetDepExpression<number, false>): void {
			// @ts-expect-error StateSetDepExpression is terminal (write-only) and has no `.validate()`
			expr.validate((value): value is number => typeof value === 'number')
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})
})

describe('dep.self is strongly typed; root/parent/widget stay unknown', () => {
	function readCount(builder: DependencyBuilder<SampleInterfaces, 'method'>) {
		return builder.self.state.get('count')
	}

	function readTotal(builder: DependencyBuilder<SampleInterfaces, 'property'>) {
		return builder.self.properties.get('total')
	}

	function invokeRun(builder: DependencyBuilder<SampleInterfaces, 'property'>) {
		return builder.self.methods.invoke('run')
	}

	function readFromRoot(builder: DependencyBuilder<SampleInterfaces, 'method'>) {
		return builder.root.state.get('anything-at-all')
	}

	function invokeFromParent(builder: DependencyBuilder<SampleInterfaces, 'method'>) {
		return builder.parent.methods.invoke('anything-at-all')
	}

	it('types dep.self.state.get(key) using the plugin\'s own State value', () => {
		expectTypeOf(readCount).returns.toEqualTypeOf<StateGetDepExpression<number | null, false>>()
	})

	it('types dep.self.properties.get(name) using the plugin\'s own Properties value', () => {
		expectTypeOf(readTotal).returns.toEqualTypeOf<PropertyGetDepExpression<number | null, false>>()
	})

	it('types dep.self.methods.invoke(name) using the plugin\'s own Method signature', () => {
		expectTypeOf(invokeRun).returns.toEqualTypeOf<MethodInvokeDepExpression<[number], string | null, false>>()
	})

	it('rejects an unknown member key on dep.self (member keys are statically checked for self)', () => {
		function attempt(builder: DependencyBuilder<SampleInterfaces, 'property'>): void {
			// @ts-expect-error 'missing' is not a declared property key of SampleInterfaces
			builder.self.properties.get('missing')
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('keeps dep.root generic/unknown regardless of Interfaces (root\'s type does not depend on the type parameter)', () => {
		expectTypeOf<DependencyBuilder<SampleInterfaces, 'method'>['root']>()
			.toEqualTypeOf<UnknownTargetDependencyOperations<'method', false>>()
	})

	it('reads unknown-target state/methods as `unknown`-typed and unconstrained by member key', () => {
		expectTypeOf(readFromRoot).returns.toEqualTypeOf<StateGetDepExpression<unknown, false>>()
		expectTypeOf(invokeFromParent).returns.toEqualTypeOf<MethodInvokeDepExpression<readonly unknown[], unknown, false>>()
	})
})
