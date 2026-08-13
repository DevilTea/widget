/**
 * Type-level regressions for adversarial PR #12 review findings on the Blueprint/type side.
 *
 * finding 3773310855 (internal/contract.ts:310): the Runtime `methods` capability surface must be
 * gated on capability *presence* (`WidgetMethodsOf`), not on the declared member-key union
 * (`WidgetMethodKeyOf`), so a declared-but-empty `methods: {}` capability still exposes an empty
 * `methods` surface at the type level — matching Runtime assembly's `definition.methods !== null`
 * check (COMMENT 4/consolidated handoff §9 capability contract).
 *
 * finding 3773310859 (internal/contract.ts:163): compile-time semantic callbacks
 * (`registerDeps`, `validateStructure`) receive a read-only compile-time node view with no
 * `getIssues()` — compilation is still in progress and no final issue snapshot exists yet
 * (COMMENT 2 compile-view contract). Runtime semantic callbacks (`compute`, `execute`) are
 * unaffected and keep `getIssues()` on `ctx.widget`.
 *
 * Only the public entry (`./index`) is used; no internal module or `blueprintInternals` access.
 */

import type {
	BlueprintCompileView,
	EmptyRegisteredDeps,
	RuntimeMethodSurface,
	RuntimeWidgetFor,
	WidgetInterfaces,
	WidgetMethodExecuteContext,
	WidgetPlugin,
	WidgetPluginValidateStructureContext,
	WidgetPropertyComputeContext,
	WidgetRegisterDepsContext,
	WidgetSlotValidateStructureContext,
} from './index'
import { describe, expectTypeOf, it } from 'vitest'

interface SampleInterfaces extends WidgetInterfaces {
	slots: 'items'
	state: {
		count: number
	}
	properties: {
		total: number
	}
	methods: {
		run: () => number
	}
}

// -------------------------------------------------------------------------------------------------
// finding 3773310855 — methods capability presence vs member-key union
// -------------------------------------------------------------------------------------------------

describe('methods capability presence vs member count (finding 3773310855)', () => {
	interface EmptyMethodsInterfaces extends WidgetInterfaces {
		methods: Record<never, never>
	}

	interface NoMethodsInterfaces extends WidgetInterfaces {
		state: {
			count: number
		}
	}

	it('exposes an empty `methods` surface for a declared-but-empty methods capability', () => {
		expectTypeOf<RuntimeMethodSurface<EmptyMethodsInterfaces>>()
			.toHaveProperty('methods')

		expectTypeOf<RuntimeMethodSurface<EmptyMethodsInterfaces>['methods']>()
			// eslint-disable-next-line ts/no-empty-object-type -- the mapped surface over an empty methods capability is exactly the empty object type.
			.toEqualTypeOf<{}>()

		type EmptyMethodsWidget = RuntimeWidgetFor<WidgetPlugin<'empty-methods', EmptyMethodsInterfaces>>
		expectTypeOf<EmptyMethodsWidget>()
			.toHaveProperty('methods')
	})

	it('exposes no `methods` surface at all when the capability is absent', () => {
		expectTypeOf<RuntimeMethodSurface<NoMethodsInterfaces>>()
			.toEqualTypeOf<unknown>()

		type NoMethodsWidget = RuntimeWidgetFor<WidgetPlugin<'no-methods', NoMethodsInterfaces>>
		expectTypeOf<NoMethodsWidget>().not.toHaveProperty('methods')
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773310859 — compile-time compile view omits getIssues
// -------------------------------------------------------------------------------------------------

describe('compile-time node views omit getIssues (finding 3773310859)', () => {
	it('registerDeps: ctx.widget has no getIssues', () => {
		function attempt(ctx: WidgetRegisterDepsContext<SampleInterfaces, 'property'>): void {
			// @ts-expect-error compile-time widget view has no getIssues; compilation is still in progress
			ctx.widget.getIssues()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('registerDeps: a node reached through ctx.blueprint has no getIssues', () => {
		function attempt(ctx: WidgetRegisterDepsContext<SampleInterfaces, 'method'>): void {
			const found = ctx.blueprint.getWidget('other')
			// @ts-expect-error compile-time node view has no getIssues
			found?.getIssues()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('slot-level validateStructure: ctx.widget and ctx.children have no getIssues', () => {
		function attempt(ctx: WidgetSlotValidateStructureContext<SampleInterfaces, 'items'>): void {
			// @ts-expect-error compile-time widget view has no getIssues
			ctx.widget.getIssues()
			// @ts-expect-error compile-time child node views have no getIssues
			ctx.children[0]?.getIssues()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('plugin-level validateStructure: ctx.widget has no getIssues', () => {
		function attempt(ctx: WidgetPluginValidateStructureContext<SampleInterfaces>): void {
			// @ts-expect-error compile-time widget view has no getIssues
			ctx.widget.getIssues()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('blueprintCompileView queries (root/getParent/getChildren/getChildrenAt) all omit getIssues', () => {
		function attempt(view: BlueprintCompileView): void {
			// @ts-expect-error root is a compile-time node view
			view.root.getIssues()

			const parent = view.getParent(view.root)
			// @ts-expect-error getParent returns a compile-time node view
			parent?.getIssues()

			const children = view.getChildren(view.root)
			// @ts-expect-error getChildren returns compile-time node views
			children[0]?.getIssues()

			const atSlot = view.getChildrenAt(view.root, 'items')
			// @ts-expect-error getChildrenAt returns compile-time node views
			atSlot[0]?.getIssues()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('runtime callbacks (compute/execute) are unaffected: ctx.widget keeps getIssues', () => {
		function computeAttempt(ctx: WidgetPropertyComputeContext<SampleInterfaces, EmptyRegisteredDeps>): void {
			// No @ts-expect-error: the runtime widget view is unaffected by the compile-view fix.
			ctx.widget.getIssues()
		}
		function executeAttempt(ctx: WidgetMethodExecuteContext<SampleInterfaces, 'run', EmptyRegisteredDeps>): void {
			// No @ts-expect-error: the runtime widget view is unaffected by the compile-view fix.
			ctx.widget.getIssues()
		}
		expectTypeOf(computeAttempt).returns.toBeVoid()
		expectTypeOf(executeAttempt).returns.toBeVoid()
	})
})
