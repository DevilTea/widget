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
 * `getDiagnostics()` — compilation is still in progress and no final diagnostic snapshot exists yet
 * (COMMENT 2 compile-view contract). Runtime semantic callbacks (`compute`, `execute`) are
 * unaffected and keep `getDiagnostics()` on `ctx.widget`.
 *
 * finding 3773695997 (internal/contract.ts:188): the round-1 compile-view fix was shallow — a
 * resolved view's `.slots` children were still full nodes, and `getLocation()`'s `parent` was still a
 * full node, so `ctx.widget.slots.items[0].getDiagnostics()` and
 * `ctx.blueprint.getLocation(...).parent.getDiagnostics()` both stayed legal. The view is now recursive
 * (`BlueprintSemanticSlotsView`, `WidgetLocationView`) all the way down.
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
// finding 3773310859 — compile-time compile view omits getDiagnostics
// -------------------------------------------------------------------------------------------------

describe('compile-time node views omit getDiagnostics (finding 3773310859)', () => {
	it('registerDeps: ctx.widget has no getDiagnostics', () => {
		function attempt(ctx: WidgetRegisterDepsContext<SampleInterfaces, 'property'>): void {
			// @ts-expect-error compile-time widget view has no getDiagnostics; compilation is still in progress
			ctx.widget.getDiagnostics()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('registerDeps: a node reached through ctx.blueprint has no getDiagnostics', () => {
		function attempt(ctx: WidgetRegisterDepsContext<SampleInterfaces, 'method'>): void {
			const found = ctx.blueprint.getWidget('other')
			// @ts-expect-error compile-time node view has no getDiagnostics
			found?.getDiagnostics()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('slot-level validateStructure: ctx.widget and ctx.children have no getDiagnostics', () => {
		function attempt(ctx: WidgetSlotValidateStructureContext<SampleInterfaces, 'items'>): void {
			// @ts-expect-error compile-time widget view has no getDiagnostics
			ctx.widget.getDiagnostics()
			// @ts-expect-error compile-time child node views have no getDiagnostics
			ctx.children[0]?.getDiagnostics()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('plugin-level validateStructure: ctx.widget has no getDiagnostics', () => {
		function attempt(ctx: WidgetPluginValidateStructureContext<SampleInterfaces>): void {
			// @ts-expect-error compile-time widget view has no getDiagnostics
			ctx.widget.getDiagnostics()
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('blueprintCompileView queries (root/getParent/getChildren/getChildrenAt) all omit getDiagnostics', () => {
		function attempt(view: BlueprintCompileView): void {
			// @ts-expect-error root is a compile-time node view
			view.root.getDiagnostics()

			const parent = view.getParent(view.root)
			// @ts-expect-error getParent returns a compile-time node view
			void parent?.diagnostics

			const children = view.getChildren(view.root)
			// @ts-expect-error getChildren returns compile-time node views
			void children[0]?.diagnostics

			const atSlot = view.getChildrenAt(view.root, 'items')
			// @ts-expect-error getChildrenAt returns compile-time node views
			void atSlot[0]?.diagnostics
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('runtime callbacks (compute/execute) expose the immutable diagnostics property', () => {
		function computeAttempt(ctx: WidgetPropertyComputeContext<SampleInterfaces, EmptyRegisteredDeps>): void {
			void ctx.widget.diagnostics
		}
		function executeAttempt(ctx: WidgetMethodExecuteContext<SampleInterfaces, 'run', EmptyRegisteredDeps>): void {
			void ctx.widget.diagnostics
		}
		expectTypeOf(computeAttempt).returns.toBeVoid()
		expectTypeOf(executeAttempt).returns.toBeVoid()
	})
})

// -------------------------------------------------------------------------------------------------
// finding 3773695997 — the compile view must be recursive (slots children, getLocation().parent)
// -------------------------------------------------------------------------------------------------

describe('compile-time views are recursive, not just top-level (finding 3773695997)', () => {
	it('registerDeps: ctx.widget.slots[...] children have no getDiagnostics', () => {
		function attempt(ctx: WidgetRegisterDepsContext<SampleInterfaces, 'property'>): void {
			// @ts-expect-error a slot's children are compile-time node views too, not full nodes
			void ctx.widget.slots.items[0]?.diagnostics
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('slot-level validateStructure: ctx.widget.slots[...] children have no getDiagnostics', () => {
		function attempt(ctx: WidgetSlotValidateStructureContext<SampleInterfaces, 'items'>): void {
			// @ts-expect-error a slot's children are compile-time node views too, not full nodes
			void ctx.widget.slots.items[0]?.diagnostics
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('registerDeps: ctx.blueprint.getLocation(...)\'s parent has no getDiagnostics', () => {
		function attempt(ctx: WidgetRegisterDepsContext<SampleInterfaces, 'property'>): void {
			const location = ctx.blueprint.getLocation(ctx.widget)
			if (location === null || location.type === 'root')
				return
			// @ts-expect-error the location's parent is a compile-time node view too, not a full node
			void location.parent.diagnostics
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('blueprintCompileView.getLocation(...)\'s parent has no getDiagnostics', () => {
		function attempt(view: BlueprintCompileView): void {
			const location = view.getLocation(view.root)
			if (location === null || location.type === 'root')
				return
			// @ts-expect-error the location's parent is a compile-time node view too, not a full node
			void location.parent.diagnostics
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})

	it('runtime callbacks (compute/execute) are unaffected: getLocation(...)\'s parent keeps getDiagnostics', () => {
		function attempt(ctx: WidgetPropertyComputeContext<SampleInterfaces, EmptyRegisteredDeps>): void {
			const location = ctx.blueprint.getLocation(ctx.widget)
			if (location === null || location.type === 'root')
				return
			// No @ts-expect-error: the runtime valid-blueprint view is unaffected by the compile-view fix.
			void location.parent.diagnostics
		}
		expectTypeOf(attempt).returns.toBeVoid()
	})
})
