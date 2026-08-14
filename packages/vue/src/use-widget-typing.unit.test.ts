/**
 * Conformance tests — issue #13 checkpoint G "Type-level conformance" (`useWidget(Plugin)` half):
 * exact capability/member/slot inference and the absent-vs-explicitly-empty distinction.
 */

import type { Ref } from 'vue'
import type {
	ContainerPlugin,
	CounterPlugin,
	EmptyPropertiesPlugin,
	EmptySlotsPlugin,
	EmptyStatePlugin,
	LabelPlugin,
	LeafPlugin,
} from './test-fixtures'
import type { ReadonlyRef, UseWidgetResult } from './types'
import { describe, expectTypeOf, it } from 'vitest'

describe('useWidget(Plugin) — type-level conformance', () => {
	it('exposes exactly the state/property/method accessors and member keys the plugin declares', () => {
		type CounterResult = UseWidgetResult<typeof CounterPlugin>

		expectTypeOf<CounterResult>()
			.toHaveProperty('useState')
		expectTypeOf<CounterResult>()
			.toHaveProperty('useProperties')
		expectTypeOf<CounterResult>()
			.toHaveProperty('useMethods')
		expectTypeOf<CounterResult>()
			.toHaveProperty('useStateIssues')
		expectTypeOf<CounterResult>()
			.toHaveProperty('usePropertyIssues')
		expectTypeOf<CounterResult>()
			.toHaveProperty('useMethodIssues')
		expectTypeOf<CounterResult>()
			.toHaveProperty('useIssues')
		// Counter declares no slots capability.
		expectTypeOf<CounterResult>().not.toHaveProperty('WidgetSlot')

		expectTypeOf<ReturnType<CounterResult['useState']>>()
			.toEqualTypeOf<{
			readonly count: Ref<number | null>
		}>()

		expectTypeOf<ReturnType<CounterResult['useProperties']>>()
			.toEqualTypeOf<{
			readonly doubled: ReadonlyRef<number | null>
		}>()

		expectTypeOf<ReturnType<CounterResult['useMethods']>['increment']>()
			.toEqualTypeOf<(step: number) => number | null>()
		expectTypeOf<ReturnType<CounterResult['useMethods']>['reset']>()
			.toEqualTypeOf<() => void | null>()
	})

	it('drops the whole accessor when a capability is absent (Label has no state/methods/slots)', () => {
		type LabelResult = UseWidgetResult<typeof LabelPlugin>

		expectTypeOf<LabelResult>().not.toHaveProperty('useState')
		expectTypeOf<LabelResult>().not.toHaveProperty('useStateIssues')
		expectTypeOf<LabelResult>().not.toHaveProperty('useMethods')
		expectTypeOf<LabelResult>().not.toHaveProperty('useMethodIssues')
		expectTypeOf<LabelResult>().not.toHaveProperty('WidgetSlot')
		expectTypeOf<LabelResult>()
			.toHaveProperty('useProperties')
		// The widget-level aggregate is unconditional, regardless of declared capabilities.
		expectTypeOf<LabelResult>()
			.toHaveProperty('useIssues')
	})

	it('keeps an explicitly-declared-empty capability present with an empty keyed surface, distinct from absence', () => {
		type EmptyStateResult = UseWidgetResult<typeof EmptyStatePlugin>

		expectTypeOf<EmptyStateResult>()
			.toHaveProperty('useState')
		expectTypeOf<EmptyStateResult>()
			.toHaveProperty('useStateIssues')
		// Present, but with a keyed surface that has no members — distinct from the capability being
		// absent (which drops `useState` from the type entirely, asserted above for `Label`/`Leaf`).
		expectTypeOf<keyof ReturnType<EmptyStateResult['useState']>>()
			.toEqualTypeOf<never>()
		// No properties/methods/slots were declared at all (absent, not explicitly empty).
		expectTypeOf<EmptyStateResult>().not.toHaveProperty('useProperties')
		expectTypeOf<EmptyStateResult>().not.toHaveProperty('useMethods')
		expectTypeOf<EmptyStateResult>().not.toHaveProperty('WidgetSlot')
	})

	it('exposes `WidgetSlot` narrowed to the exact declared slot-name union, and only when slots are declared', () => {
		type ContainerResult = UseWidgetResult<typeof ContainerPlugin>

		expectTypeOf<ContainerResult>()
			.toHaveProperty('WidgetSlot')
		// `WidgetSlot` is a non-callable component/constructor type (`new () => { $props }`), not a
		// plain function — `InstanceType` is the correct way to reach its prop shape, not `.parameter()`.
		expectTypeOf<InstanceType<ContainerResult['WidgetSlot']>['$props']>()
			.toEqualTypeOf<{ readonly name: 'header' | 'body' | 'slot-one' }>()

		type LeafResult = UseWidgetResult<typeof LeafPlugin>
		expectTypeOf<LeafResult>().not.toHaveProperty('WidgetSlot')
		expectTypeOf<LeafResult>()
			.toHaveProperty('useState')
		expectTypeOf<ReturnType<LeafResult['useState']>>()
			.toEqualTypeOf<{
			readonly label: Ref<string | null>
		}>()
	})

	it('keeps explicitly-declared-empty properties present with an empty keyed surface, distinct from absence', () => {
		type EmptyPropertiesResult = UseWidgetResult<typeof EmptyPropertiesPlugin>

		expectTypeOf<EmptyPropertiesResult>()
			.toHaveProperty('useProperties')
		expectTypeOf<EmptyPropertiesResult>()
			.toHaveProperty('usePropertyIssues')
		expectTypeOf<keyof ReturnType<EmptyPropertiesResult['useProperties']>>()
			.toEqualTypeOf<never>()
		// No state/methods/slots were declared at all (absent, not explicitly empty).
		expectTypeOf<EmptyPropertiesResult>().not.toHaveProperty('useState')
		expectTypeOf<EmptyPropertiesResult>().not.toHaveProperty('useMethods')
		expectTypeOf<EmptyPropertiesResult>().not.toHaveProperty('WidgetSlot')
	})

	it('keeps explicitly-declared-empty slots (`slots: never`) present with `name: never`, distinct from absence', () => {
		type EmptySlotsResult = UseWidgetResult<typeof EmptySlotsPlugin>

		// This is exactly the case a value-`never`/shape-based presence test collapses into absence:
		// the semantic slot map is `{}` the same way it is for a plugin with no `slots` capability at
		// all, so presence must come from `HasWidgetCapability`/`plugin.capabilities.slots`, not from
		// `WidgetSlotNameOf`'s payload or from inspecting `blueprint.slots`'s key count.
		expectTypeOf<EmptySlotsResult>()
			.toHaveProperty('WidgetSlot')
		expectTypeOf<InstanceType<EmptySlotsResult['WidgetSlot']>['$props']>()
			.toEqualTypeOf<{ readonly name: never }>()
	})

	it('types Property/issue projections as a truthful readonly Ref, not a ComputedRef', () => {
		// `ReadonlyRef<T>` (`Readonly<Ref<T>>`) is exactly `{ readonly value: T }` plus Vue's internal
		// ref brand — it must not additionally claim computed-only public surface such as `.effect`,
		// which `customRef()` (what actually backs these projections) never provides.
		expectTypeOf<ReadonlyRef<number>>()
			.toHaveProperty('value')
		expectTypeOf<ReadonlyRef<number>>().not.toHaveProperty('effect')
	})
})
