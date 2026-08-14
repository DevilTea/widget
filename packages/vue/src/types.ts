/**
 * Public `useWidget(Plugin)` return-type surface.
 *
 * Normative source: issue #13 checkpoints C, C addendum, D (both parts), F.
 *
 * Every accessor is gated on the same capability-presence rule `@deviltea/widget-core` itself uses
 * (`RuntimeStateSurface` / `RuntimePropertySurface` / `RuntimeMethodSurface` in `internal/contract.ts`):
 * an absent capability drops the whole accessor key from the returned object type, while an
 * explicitly-declared-empty capability keeps the accessor present with an empty keyed surface. This
 * package adds no capability rule of its own — it only re-projects `@deviltea/widget-core`'s.
 */

import type {
	AnyWidgetPlugin,
	RuntimeMethodIssue,
	RuntimePropertyIssue,
	RuntimeStateIssue,
	RuntimeWidgetIssue,
	WidgetInterfaces,
	WidgetInterfacesOf,
	WidgetMethodArgsOf,
	WidgetMethodKeyOf,
	WidgetMethodReturnOf,
	WidgetMethodsOf,
	WidgetPropertiesOf,
	WidgetPropertyKeyOf,
	WidgetPropertyValueOf,
	WidgetSlotNameOf,
	WidgetStateKeyOf,
	WidgetStateOf,
	WidgetStateValueOf,
} from '@deviltea/widget-core'
import type { ComputedRef, FunctionalComponent, Ref } from 'vue'

// -------------------------------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------------------------------

export type UseWidgetStateSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Key in WidgetStateKeyOf<Interfaces>]: Ref<WidgetStateValueOf<Interfaces, Key> | null>
}

export type UseWidgetStateAccessor<Interfaces extends WidgetInterfaces> = [WidgetStateOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly useState: () => UseWidgetStateSurface<Interfaces>
		}

export type UseWidgetStateIssuesSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Key in WidgetStateKeyOf<Interfaces>]: ComputedRef<readonly RuntimeStateIssue[]>
}

export type UseWidgetStateIssuesAccessor<Interfaces extends WidgetInterfaces> = [WidgetStateOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly useStateIssues: () => UseWidgetStateIssuesSurface<Interfaces>
		}

// -------------------------------------------------------------------------------------------------
// Properties
// -------------------------------------------------------------------------------------------------

export type UseWidgetPropertiesSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetPropertyKeyOf<Interfaces>]: ComputedRef<WidgetPropertyValueOf<Interfaces, Name> | null>
}

export type UseWidgetPropertiesAccessor<Interfaces extends WidgetInterfaces> = [WidgetPropertiesOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly useProperties: () => UseWidgetPropertiesSurface<Interfaces>
		}

export type UseWidgetPropertyIssuesSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetPropertyKeyOf<Interfaces>]: ComputedRef<readonly RuntimePropertyIssue[]>
}

export type UseWidgetPropertyIssuesAccessor<Interfaces extends WidgetInterfaces> = [WidgetPropertiesOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly usePropertyIssues: () => UseWidgetPropertyIssuesSurface<Interfaces>
		}

// -------------------------------------------------------------------------------------------------
// Methods
// -------------------------------------------------------------------------------------------------

export type UseWidgetMethodsSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetMethodKeyOf<Interfaces>]: (
		...args: WidgetMethodArgsOf<Interfaces, Name>
	) => WidgetMethodReturnOf<Interfaces, Name> | null
}

export type UseWidgetMethodsAccessor<Interfaces extends WidgetInterfaces> = [WidgetMethodsOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly useMethods: () => UseWidgetMethodsSurface<Interfaces>
		}

export type UseWidgetMethodIssuesSurface<Interfaces extends WidgetInterfaces> = {
	readonly [Name in WidgetMethodKeyOf<Interfaces>]: ComputedRef<readonly RuntimeMethodIssue[]>
}

export type UseWidgetMethodIssuesAccessor<Interfaces extends WidgetInterfaces> = [WidgetMethodsOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly useMethodIssues: () => UseWidgetMethodIssuesSurface<Interfaces>
		}

// -------------------------------------------------------------------------------------------------
// Widget-level aggregate issues (unconditional — present regardless of declared capabilities)
// -------------------------------------------------------------------------------------------------

export interface UseWidgetIssuesAccessor {
	readonly useIssues: () => ComputedRef<readonly RuntimeWidgetIssue[]>
}

// -------------------------------------------------------------------------------------------------
// WidgetSlot
// -------------------------------------------------------------------------------------------------

/**
 * `WidgetSlot`'s public component type: a `name` prop narrowed to the exact widget's declared
 * slot-name union. The underlying value returned at runtime is always the same shared internal
 * component identity (issue #13 checkpoint D) — only this type differs per `useWidget(Plugin)` call.
 */
export type WidgetSlotComponent<SlotName extends string> = FunctionalComponent<{ readonly name: SlotName }>

export type UseWidgetSlotAccessor<Interfaces extends WidgetInterfaces> = [WidgetSlotNameOf<Interfaces>] extends [never]
	? unknown
	: {
			readonly WidgetSlot: WidgetSlotComponent<WidgetSlotNameOf<Interfaces>>
		}

// -------------------------------------------------------------------------------------------------
// Composed result
// -------------------------------------------------------------------------------------------------

export type UseWidgetResult<Plugin extends AnyWidgetPlugin> = WidgetInterfacesOf<Plugin> extends infer Interfaces extends WidgetInterfaces
	? & UseWidgetStateAccessor<Interfaces>
	& UseWidgetPropertiesAccessor<Interfaces>
	& UseWidgetMethodsAccessor<Interfaces>
	& UseWidgetStateIssuesAccessor<Interfaces>
	& UseWidgetPropertyIssuesAccessor<Interfaces>
	& UseWidgetMethodIssuesAccessor<Interfaces>
	& UseWidgetIssuesAccessor
	& UseWidgetSlotAccessor<Interfaces>
	: never
