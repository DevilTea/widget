/**
 * Public `useWidget(Plugin)` return-type surface.
 *
 * Normative source: diagnostic #13 checkpoints C, C addendum, D (both parts), F; diagnostic #10 amendment
 * "declaration-presence semantics and public `WidgetPlugin.capabilities`".
 *
 * Every accessor is gated on `HasWidgetCapability<Interfaces, Key>` — `@deviltea/widget-core`'s
 * authoritative declaration-presence predicate, mirroring `RuntimeStateSurface` /
 * `RuntimePropertySurface` / `RuntimeMethodSurface` / `BlueprintSemanticSlots` gating in
 * `internal/contract.ts`: an absent capability drops the whole accessor key from the returned object
 * type, while an explicitly-declared-empty capability (including `slots: never`) keeps the accessor
 * present with an empty/never-keyed surface. Presence must never be tested via
 * `[WidgetCapabilityOf<...>] extends [never]` (equivalently `[WidgetStateOf<...>] extends [never]` /
 * `[WidgetSlotNameOf<...>] extends [never]`): a legitimately-present capability can itself have
 * payload `never` (`slots: never` is the canonical explicit-empty spelling), which that test cannot
 * distinguish from absence. This package adds no capability rule of its own — it only re-projects
 * `@deviltea/widget-core`'s.
 */

import type {
	AnyWidgetPlugin,
	HasWidgetCapability,
	RuntimeMethodDiagnostic,
	RuntimePropertyDiagnostic,
	RuntimeStateDiagnostic,
	RuntimeWidgetDiagnostic,
	WidgetInterfaces,
	WidgetInterfacesOf,
	WidgetMethodArgsOf,
	WidgetMethodKeyOf,
	WidgetMethodReturnOf,
	WidgetPropertyKeyOf,
	WidgetPropertyValueOf,
	WidgetSlotNameOf,
	WidgetStateKeyOf,
	WidgetStateValueOf,
} from '@deviltea/widget-core'
import type { Ref } from 'vue'

/**
 * Truthful readonly-Ref projection shape. Property and every diagnostic channel are backed by `customRef`
 * (a plain `Ref`), never by `computed()` — `ComputedRef` additionally promises computed-specific
 * public surface (for example the deprecated `.effect` field in the pinned Vue 3.5 line) that these
 * bridges do not actually have, so it must not be used here even though both are readonly-shaped.
 * `Readonly<Ref<T>>` types exactly the `{ readonly value: T }` shape a `customRef` genuinely provides.
 */
export type ReadonlyRef<T> = Readonly<Ref<T>>

// -------------------------------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------------------------------

export type UseWidgetStateSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Key in WidgetStateKeyOf<Interfaces>]: Ref<WidgetStateValueOf<Interfaces, Key> | null>
}

export type UseWidgetStateAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'state'> extends true
	? {
			readonly useState: () => UseWidgetStateSurface<Interfaces>
		}
	: unknown

export type UseWidgetStateDiagnosticsSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Key in WidgetStateKeyOf<Interfaces>]: ReadonlyRef<readonly RuntimeStateDiagnostic[]>
}

export type UseWidgetStateDiagnosticsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'state'> extends true
	? {
			readonly useStateDiagnostics: () => UseWidgetStateDiagnosticsSurface<Interfaces>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Properties
// -------------------------------------------------------------------------------------------------

export type UseWidgetPropertiesSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetPropertyKeyOf<Interfaces>]: ReadonlyRef<WidgetPropertyValueOf<Interfaces, Name> | null>
}

export type UseWidgetPropertiesAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'properties'> extends true
	? {
			readonly useProperties: () => UseWidgetPropertiesSurface<Interfaces>
		}
	: unknown

export type UseWidgetPropertyDiagnosticsSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetPropertyKeyOf<Interfaces>]: ReadonlyRef<readonly RuntimePropertyDiagnostic[]>
}

export type UseWidgetPropertyDiagnosticsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'properties'> extends true
	? {
			readonly usePropertyDiagnostics: () => UseWidgetPropertyDiagnosticsSurface<Interfaces>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Methods
// -------------------------------------------------------------------------------------------------

export type UseWidgetMethodsSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetMethodKeyOf<Interfaces>]: (
		...args: WidgetMethodArgsOf<Interfaces, Name>
	) => WidgetMethodReturnOf<Interfaces, Name> | null
}

export type UseWidgetMethodsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'methods'> extends true
	? {
			readonly useMethods: () => UseWidgetMethodsSurface<Interfaces>
		}
	: unknown

export type UseWidgetMethodDiagnosticsSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetMethodKeyOf<Interfaces>]: ReadonlyRef<readonly RuntimeMethodDiagnostic[]>
}

export type UseWidgetMethodDiagnosticsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'methods'> extends true
	? {
			readonly useMethodDiagnostics: () => UseWidgetMethodDiagnosticsSurface<Interfaces>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Widget-level aggregate diagnostics (unconditional — present regardless of declared capabilities)
// -------------------------------------------------------------------------------------------------

export interface UseWidgetDiagnosticsAccessor {
	readonly useDiagnostics: () => ReadonlyRef<readonly RuntimeWidgetDiagnostic[]>
}

// -------------------------------------------------------------------------------------------------
// Widget identity (unconditional — present regardless of declared capabilities)
// -------------------------------------------------------------------------------------------------

/**
 * Normative source: diagnostic #13 checkpoint amendment "`useWidget()` may expose readonly local widget
 * identity". Projected from the already-injected current `RuntimeWidget` at `useWidget()` time — plain
 * readonly values, not refs and not reactive projections: a mounted renderer instance's widget identity
 * never changes (Runtime replacement remounts through the existing lifecycle boundary). Present
 * regardless of which optional capabilities (`state`/`properties`/`methods`/`slots`) the plugin
 * declares. Deliberately narrow: no `RuntimeWidget`, Blueprint node, parent/child traversal, or
 * system/runtime handle is exposed through this — see the amendment's normative boundaries.
 */
export interface UseWidgetIdentityAccessor<Plugin extends AnyWidgetPlugin> {
	/** The current rendered widget instance's semantic/Blueprint id. Stable for this renderer instance. */
	readonly widgetId: string
	/** The exact current widget plugin type. Stable for this renderer instance. */
	readonly widgetType: Plugin['type']
}

// -------------------------------------------------------------------------------------------------
// WidgetSlot
// -------------------------------------------------------------------------------------------------

/**
 * `WidgetSlot`'s public component type: a `name` prop narrowed to the exact widget's declared
 * slot-name union (`never` for an explicitly-declared-empty `slots: never` capability, since no legal
 * slot name exists to pass). The underlying value returned at runtime is always the same shared
 * internal component identity (diagnostic #13 checkpoint D) — only this type differs per `useWidget(Plugin)`
 * call.
 *
 * Typed as a non-callable component/constructor shape — mirroring `WidgetVueRenderer` in
 * `renderer.ts` — rather than `FunctionalComponent`: the actual shared value is a `defineComponent()`
 * output, which is not safely invocable as a plain function the way a real `FunctionalComponent`
 * value is.
 */
export type WidgetSlotComponent<SlotName extends string> = new () => {
	$props: { readonly name: SlotName }
}

export type UseWidgetSlotAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'slots'> extends true
	? {
			readonly WidgetSlot: WidgetSlotComponent<WidgetSlotNameOf<Interfaces>>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Composed result
// -------------------------------------------------------------------------------------------------

export type UseWidgetResult<Plugin extends AnyWidgetPlugin> = WidgetInterfacesOf<Plugin> extends infer Interfaces extends WidgetInterfaces
	? & UseWidgetStateAccessor<Interfaces>
	& UseWidgetPropertiesAccessor<Interfaces>
	& UseWidgetMethodsAccessor<Interfaces>
	& UseWidgetStateDiagnosticsAccessor<Interfaces>
	& UseWidgetPropertyDiagnosticsAccessor<Interfaces>
	& UseWidgetMethodDiagnosticsAccessor<Interfaces>
	& UseWidgetDiagnosticsAccessor
	& UseWidgetSlotAccessor<Interfaces>
	& UseWidgetIdentityAccessor<Plugin>
	: never
