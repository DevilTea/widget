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
	WidgetEventsOf,
	WidgetInterfaces,
	WidgetInterfacesOf,
	WidgetMemberKey,
	WidgetMethodsOf,
	WidgetPropertiesOf,
	WidgetReasonsOf,
	WidgetResolvedConfigOf,
	WidgetSlotNameOf,
	WidgetSlotPluginTypeOf,
	WidgetStateOf,
} from '@deviltea/widget-core'
import type { Ref, Slot } from 'vue'

/**
 * Truthful readonly-Ref projection shape. Property and every diagnostic channel are backed by `customRef`
 * (a plain `Ref`), never by `computed()` — `ComputedRef` additionally promises computed-specific
 * public surface (for example the deprecated `.effect` field in the pinned Vue 3.5 line) that these
 * bridges do not actually have, so it must not be used here even though both are readonly-shaped.
 * `Readonly<Ref<T>>` types exactly the `{ readonly value: T }` shape a `customRef` genuinely provides.
 */
export type ReadonlyRef<T> = Readonly<Ref<T>>

// -------------------------------------------------------------------------------------------------
// Keyed surfaces
// -------------------------------------------------------------------------------------------------

/**
 * Every keyed surface below is a homomorphic mapped type over `keyof` the Interfaces section, not over a
 * union of its keys. TypeScript carries a property's JSDoc from the source of a homomorphic mapping to the
 * mapped property, so hovering `useState().count` (or `useMethods().increment`, `emit.pressed`, ...) shows
 * the JSDoc written on the member in the plugin's Interfaces. A mapping over a key union has no source
 * property and would drop it. The `as` clause keeps the `WidgetMemberKey` (string) filter and, being a
 * key remapping of the same `keyof`, keeps the documentation too. An absent or `never` section maps to
 * an empty surface.
 */
type KeyedSurface<Members, Value> = [Members] extends [never]
	? Record<never, never>
	: { readonly [Key in keyof Members as Key extends WidgetMemberKey ? Key : never]: Value }

// -------------------------------------------------------------------------------------------------
// Diagnostic reasons and details
// -------------------------------------------------------------------------------------------------

type DeclaredReasonFields<Reasons> = { readonly reason?: undefined, readonly details?: undefined }
	| ([Reasons] extends [never]
		? never
		: {
				[Reason in Extract<keyof Reasons, string>]: [Reasons[Reason]] extends [void]
					? { readonly reason: Reason, readonly details?: undefined }
					: { readonly reason: Reason, readonly details: Reasons[Reason] }
			}[Extract<keyof Reasons, string>])

/**
 * A diagnostic of this widget's own State, Property or Method, with `reason` and `details` typed by the
 * plugin's `Interfaces['reasons']`.
 *
 * When the plugin declares `reasons`, a diagnostic that carries a plugin-authored `reason` is a union
 * discriminated by it: `details` is that reason's payload (always present when the payload is not `void`),
 * and a diagnostic without a `reason` (Core's default validation message, for one) has neither field.
 * Without a `reasons` declaration the diagnostic keeps Core's shape (`reason?: string`,
 * `details?: JsonValue`). Dependency diagnostics (`dependency-target-failed`, `dependency-value-rejected`)
 * carry no `reason` and are unchanged. The typing is a declaration: Core checks the payload when the plugin
 * reports it, and does not re-check it on the way out.
 */
export type ReasonedDiagnostic<Diagnostic, Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'reasons'> extends true
	? Diagnostic extends unknown
		? 'reason' extends keyof Diagnostic
			? Omit<Diagnostic, 'reason' | 'details'> & DeclaredReasonFields<WidgetReasonsOf<Interfaces>>
			: Diagnostic
		: never
	: Diagnostic

// -------------------------------------------------------------------------------------------------
// Config
// -------------------------------------------------------------------------------------------------

/**
 * Recursively read-only view of a resolved config. Functions are left alone; arrays and tuples keep
 * their shape but become readonly.
 */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
	? T
	: T extends object
		? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
		: T

/**
 * The widget's resolved config (the value the plugin's `config.resolve` returned), present exactly when
 * the plugin declares the `config` capability. It is the Runtime widget's own object, neither cloned
 * nor reactive: within one Runtime a widget's resolved config never changes. Renderers must treat it
 * as read-only; the type enforces that deeply.
 */
export type UseWidgetConfigAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'config'> extends true
	? { readonly config: DeepReadonly<WidgetResolvedConfigOf<Interfaces>> }
	: unknown

// -------------------------------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------------------------------

type StateSurface<Members> = [Members] extends [never]
	? Record<never, never>
	: { readonly [Key in keyof Members as Key extends WidgetMemberKey ? Key : never]: Ref<Members[Key] | null> }

/** One writable `Ref` per declared State member, carrying the member's JSDoc. `null` while the value is failing. */
export type UseWidgetStateSurface<Interfaces extends WidgetInterfaces> = StateSurface<WidgetStateOf<Interfaces>>

export type UseWidgetStateAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'state'> extends true
	? {
			readonly useState: () => UseWidgetStateSurface<Interfaces>
		}
	: unknown

/** One readonly diagnostics `Ref` per declared State member. */
export type UseWidgetStateDiagnosticsSurface<Interfaces extends WidgetInterfaces> = KeyedSurface<
	WidgetStateOf<Interfaces>,
	ReadonlyRef<readonly ReasonedDiagnostic<RuntimeStateDiagnostic, Interfaces>[]>
>

export type UseWidgetStateDiagnosticsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'state'> extends true
	? {
			readonly useStateDiagnostics: () => UseWidgetStateDiagnosticsSurface<Interfaces>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Properties
// -------------------------------------------------------------------------------------------------

type PropertiesSurface<Members> = [Members] extends [never]
	? Record<never, never>
	: { readonly [Name in keyof Members as Name extends WidgetMemberKey ? Name : never]: ReadonlyRef<Members[Name] | null> }

/** One readonly `Ref` per declared Property, carrying the Property's JSDoc. `null` while the Property is failing. */
export type UseWidgetPropertiesSurface<Interfaces extends WidgetInterfaces> = PropertiesSurface<WidgetPropertiesOf<Interfaces>>

export type UseWidgetPropertiesAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'properties'> extends true
	? {
			readonly useProperties: () => UseWidgetPropertiesSurface<Interfaces>
		}
	: unknown

/** One readonly diagnostics `Ref` per declared Property. */
export type UseWidgetPropertyDiagnosticsSurface<Interfaces extends WidgetInterfaces> = KeyedSurface<
	WidgetPropertiesOf<Interfaces>,
	ReadonlyRef<readonly ReasonedDiagnostic<RuntimePropertyDiagnostic, Interfaces>[]>
>

export type UseWidgetPropertyDiagnosticsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'properties'> extends true
	? {
			readonly usePropertyDiagnostics: () => UseWidgetPropertyDiagnosticsSurface<Interfaces>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Events
// -------------------------------------------------------------------------------------------------

type EventEmitterSurface<Members> = [Members] extends [never]
	? Record<never, never>
	: {
			readonly [Name in keyof Members as Name extends WidgetMemberKey ? Name : never]: Members[Name] extends readonly unknown[]
				? (...args: Members[Name]) => void
				: never
		}

/** One emit function per declared Event, carrying the Event's JSDoc. Takes the Event's argument tuple. */
export type UseWidgetEventEmitter<Interfaces extends WidgetInterfaces> = EventEmitterSurface<WidgetEventsOf<Interfaces>>

export type UseWidgetEventEmitterAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'events'> extends true
	? { readonly emit: UseWidgetEventEmitter<Interfaces> }
	: unknown

// -------------------------------------------------------------------------------------------------
// Methods
// -------------------------------------------------------------------------------------------------

type MethodsSurface<Members> = [Members] extends [never]
	? Record<never, never>
	: {
			readonly [Name in keyof Members as Name extends WidgetMemberKey ? Name : never]: Members[Name] extends (...args: infer Args) => infer Return
				? (...args: Args) => Return | null
				: never
		}

/** One function per declared Method, carrying the Method's JSDoc. Returns `null` when the Method fails. */
export type UseWidgetMethodsSurface<Interfaces extends WidgetInterfaces> = MethodsSurface<WidgetMethodsOf<Interfaces>>

export type UseWidgetMethodsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'methods'> extends true
	? {
			readonly useMethods: () => UseWidgetMethodsSurface<Interfaces>
		}
	: unknown

/** One readonly diagnostics `Ref` per declared Method. */
export type UseWidgetMethodDiagnosticsSurface<Interfaces extends WidgetInterfaces> = KeyedSurface<
	WidgetMethodsOf<Interfaces>,
	ReadonlyRef<readonly ReasonedDiagnostic<RuntimeMethodDiagnostic, Interfaces>[]>
>

export type UseWidgetMethodDiagnosticsAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'methods'> extends true
	? {
			readonly useMethodDiagnostics: () => UseWidgetMethodDiagnosticsSurface<Interfaces>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Widget-level aggregate diagnostics (unconditional — present regardless of declared capabilities)
// -------------------------------------------------------------------------------------------------

export interface UseWidgetDiagnosticsAccessor<Interfaces extends WidgetInterfaces = WidgetInterfaces> {
	readonly useDiagnostics: () => ReadonlyRef<readonly ReasonedDiagnostic<RuntimeWidgetDiagnostic, Interfaces>[]>
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
 * `WidgetSlot`'s public component type. `Slots` maps each declared slot name to the plugin types the
 * plugin expects in it (`string` when the slot accepts any widget, see {@link WidgetSlotChildTypeOf}).
 * The `name` prop is narrowed to the slot names (`never` for an explicitly-declared-empty `slots: never`
 * capability, since no legal slot name exists to pass), and the `type` of the scoped default slot is
 * narrowed to the named slot's expected plugin types. The underlying value returned at runtime is always the
 * same shared internal component identity (diagnostic #13 checkpoint D); only this type differs per
 * `useWidget(Plugin)` call.
 *
 * Typed as a generic non-callable component/constructor shape (the generic is the chosen slot name) —
 * mirroring `WidgetVueRenderer` in `renderer.ts` — rather than `FunctionalComponent`: the actual shared
 * value is a `defineComponent()` output, which is not safely invocable as a plain function the way a real
 * `FunctionalComponent` value is.
 */
export type WidgetSlotComponent<Slots extends Readonly<Record<string, string>>> = new <Name extends keyof Slots & string>() => {
	$props: { readonly name: Name }
	$slots: { default?: Slot<WidgetSlotScope<Slots[Name]>> }
}

/**
 * A component that renders one child widget through the normal host (its registered renderer, its
 * own `useWidget()` context, its own subscriptions). Takes no props. Obtained from the scoped
 * `WidgetSlot` default slot; the identity is stable for a given child across re-renders, so re-rendering
 * the surrounding markup with a stable wrapper never remounts the child widget. As with any Vue
 * component, changing the wrapper element/component type, or skipping a child and showing it again,
 * unmounts and remounts it.
 */
export type WidgetSlotChildComponent = new () => {
	$props: Record<never, never>
}

/**
 * What the `WidgetSlot` default slot receives, once per child in Blueprint order. No Runtime handle
 * is exposed: the renderer decides how to wrap each child and whether to render it at all.
 */
export interface WidgetSlotScope<Type extends string = string> {
	/** Renders this child widget through the normal host. */
	readonly Child: WidgetSlotChildComponent
	/** The child's widget id. */
	readonly id: string
	/**
	 * The child's plugin type. Typed by what the slot expects (a plain union of plugin types or a
	 * `WidgetContract`'s `Types`), or `string` when the slot accepts any widget. The expectation is
	 * type-level only: Core checks nothing at run time, so this is as trustworthy as the plugin's own
	 * `validateStructure`.
	 */
	readonly type: Type
	/** The child's position in this slot, counting children the renderer chooses to skip. */
	readonly index: number
}

/**
 * The plugin types slot `Name` expects, or `string` when it accepts any widget (`WidgetChild`) and
 * `WidgetSlotPluginTypeOf` is therefore `never`. Resolved per slot name, so a union of slot names that
 * includes an any-widget slot is `string` and is not narrowed by the other slots.
 */
export type WidgetSlotChildTypeOf<Interfaces extends WidgetInterfaces, Name extends WidgetMemberKey> = Name extends unknown
	? [WidgetSlotPluginTypeOf<Interfaces, Name>] extends [never]
			? string
			: WidgetSlotPluginTypeOf<Interfaces, Name>
	: never

/** The record `WidgetSlotComponent` takes: every slot name of the plugin, with the plugin types it expects. */
export type WidgetSlotChildTypesOf<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetSlotNameOf<Interfaces>]: WidgetSlotChildTypeOf<Interfaces, Name>
}

export type UseWidgetSlotAccessor<Interfaces extends WidgetInterfaces> = HasWidgetCapability<Interfaces, 'slots'> extends true
	? {
			readonly WidgetSlot: WidgetSlotComponent<WidgetSlotChildTypesOf<Interfaces>>
		}
	: unknown

// -------------------------------------------------------------------------------------------------
// Composed result
// -------------------------------------------------------------------------------------------------

export type UseWidgetResult<Plugin extends AnyWidgetPlugin> = WidgetInterfacesOf<Plugin> extends infer Interfaces extends WidgetInterfaces
	? & UseWidgetConfigAccessor<Interfaces>
	& UseWidgetStateAccessor<Interfaces>
	& UseWidgetPropertiesAccessor<Interfaces>
	& UseWidgetMethodsAccessor<Interfaces>
	& UseWidgetEventEmitterAccessor<Interfaces>
	& UseWidgetStateDiagnosticsAccessor<Interfaces>
	& UseWidgetPropertyDiagnosticsAccessor<Interfaces>
	& UseWidgetMethodDiagnosticsAccessor<Interfaces>
	& UseWidgetDiagnosticsAccessor<Interfaces>
	& UseWidgetSlotAccessor<Interfaces>
	& UseWidgetIdentityAccessor<Plugin>
	: never
