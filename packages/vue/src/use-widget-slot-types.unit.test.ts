// @vitest-environment happy-dom
/**
 * `WidgetSlot` against the 0.3 record-valued `Interfaces['slots']`: the `name` prop is the record's keys, and
 * the `type` of the scoped default slot is narrowed to the plugin types the named slot expects (`string` for a
 * slot that accepts any widget). The expectation is type-level only, so the mounted test pins that the run-time
 * behaviour (the scope's `type` value, rendering) is unchanged.
 */

import type { WidgetChild, WidgetContract, WidgetInterfaces } from '@deviltea/widget-core'
import type { VNode } from 'vue'
import type { UseWidgetResult, WidgetSlotChildTypeOf, WidgetSlotChildTypesOf, WidgetSlotScope } from './types'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { mount } from '@vue/test-utils'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { createWidgetVueRenderer } from './renderer'
import { CounterPlugin, CounterRenderer, LabelPlugin, LabelRenderer, LeafPlugin, LeafRenderer } from './test-fixtures'
import { useWidget } from './use-widget'

interface HostInterfaces extends WidgetInterfaces {
	slots: {
		/** Labels only. */
		header: 'Label'
		/** Labels and counters. */
		body: 'Label' | 'Counter'
		/** Any widget. */
		free: WidgetChild
		/** Leaves, read through a contract. */
		leaves: WidgetContract<{ state: { label: string } }, 'Leaf'>
		/** Any widget with a `label` State. */
		labelled: WidgetContract<{ state: { label: string } }>
	}
}

const HostPlugin = createWidgetPlugin('Host')
	.interfaces<HostInterfaces>()
	.slots({ header: {}, body: {}, free: {}, leaves: {}, labelled: {} })
	.done()

type HostResult = UseWidgetResult<typeof HostPlugin>

// A type-level witness of the `WidgetSlot` constructor, so that `typeof HostSlot<'header'>` can instantiate its generic.
declare const HostSlot: HostResult['WidgetSlot']

/**
 * What vue-tsc checks `<WidgetSlot name="...">` as: `new WidgetSlot({ name: '...' })`, with `Name` inferred from the
 * props argument rather than given. Never called (`HostSlot` exists only as a type).
 */
const fromTemplate = {
	header: () => new HostSlot({ name: 'header' }),
	body: () => new HostSlot({ name: 'body' }),
	leaves: () => new HostSlot({ name: 'leaves' }),
	free: () => new HostSlot({ name: 'free' }),
}

/** The scope of the default slot of `fromTemplate[Name]`. */
type InferredScopeOf<Name extends keyof typeof fromTemplate> = Parameters<NonNullable<ReturnType<(typeof fromTemplate)[Name]>['$slots']['default']>>[0]

/** The scope a `WidgetSlot` default slot receives for the slot `Name`. */
type ScopeOf<Name extends keyof HostInterfaces['slots'] & string> = Parameters<NonNullable<InstanceType<typeof HostSlot<Name>>['$slots']['default']>>[0]

describe('widgetSlot slot typing', () => {
	it('takes the record\'s keys as the `name` prop', () => {
		expectTypeOf<InstanceType<HostResult['WidgetSlot']>['$props']['name']>()
			.toEqualTypeOf<'header' | 'body' | 'free' | 'leaves' | 'labelled'>()

		// @ts-expect-error `nope` is not a declared slot
		type _Unknown = InstanceType<typeof HostSlot<'nope'>>
	})

	it('narrows the scoped slot `type` to the plugin types the slot expects', () => {
		expectTypeOf<ScopeOf<'header'>>()
			.toEqualTypeOf<WidgetSlotScope<'Label'>>()
		expectTypeOf<ScopeOf<'header'>['type']>()
			.toEqualTypeOf<'Label'>()
		expectTypeOf<ScopeOf<'body'>['type']>()
			.toEqualTypeOf<'Label' | 'Counter'>()
		// A contract's `Types` narrows exactly as a plain union does.
		expectTypeOf<ScopeOf<'leaves'>['type']>()
			.toEqualTypeOf<'Leaf'>()
	})

	it('infers the slot name from the props of a constructor call, as vue-tsc does for a template', () => {
		expectTypeOf<InferredScopeOf<'header'>['type']>()
			.toEqualTypeOf<'Label'>()
		expectTypeOf<InferredScopeOf<'body'>['type']>()
			.toEqualTypeOf<'Label' | 'Counter'>()
		expectTypeOf<InferredScopeOf<'leaves'>['type']>()
			.toEqualTypeOf<'Leaf'>()
		expectTypeOf<InferredScopeOf<'free'>['type']>()
			.toEqualTypeOf<string>()
		expectTypeOf(fromTemplate.header)
			.returns
			.toEqualTypeOf<InstanceType<typeof HostSlot<'header'>>>()

		// Never called: only the type errors matter.
		const _rejected = [
			// @ts-expect-error `nope` is not a declared slot
			() => new HostSlot({ name: 'nope' }),
			// @ts-expect-error `h()` checks the props against the slot names too
			() => h(HostSlot, { name: 'nope' }),
		]
		expect(_rejected)
			.toHaveLength(2)
	})

	it('keeps the plain `string` for a slot that accepts any widget or names no plugin type', () => {
		expectTypeOf<ScopeOf<'free'>['type']>()
			.toEqualTypeOf<string>()
		expectTypeOf<ScopeOf<'labelled'>['type']>()
			.toEqualTypeOf<string>()
		expectTypeOf<ScopeOf<'free'>>()
			.toEqualTypeOf<WidgetSlotScope>()
	})

	it('resolves the child types per slot name, so one any-widget slot does not narrow another', () => {
		expectTypeOf<WidgetSlotChildTypesOf<HostInterfaces>>()
			.toEqualTypeOf<{
			readonly header: 'Label'
			readonly body: 'Label' | 'Counter'
			readonly free: string
			readonly leaves: 'Leaf'
			readonly labelled: string
		}>()
		expectTypeOf<WidgetSlotChildTypeOf<HostInterfaces, 'header' | 'free'>>()
			.toEqualTypeOf<string>()
		expectTypeOf<WidgetSlotChildTypeOf<HostInterfaces, 'header' | 'body'>>()
			.toEqualTypeOf<'Label' | 'Counter'>()
	})

	it('keeps a scope-annotated default slot assignable whatever the slot expects', () => {
		const wide = (scope: WidgetSlotScope): VNode[] => (scope.type === '' ? [] : [])
		expectTypeOf(wide)
			.toExtend<NonNullable<InstanceType<typeof HostSlot<'header'>>['$slots']['default']>>()
	})

	it('keeps `name: never` for an explicitly empty `slots: never`', () => {
		const Empty = createWidgetPlugin('Empty')
			.interfaces<{ slots: never }>()
			.slots({})
			.done()
		type EmptySlot = UseWidgetResult<typeof Empty>['WidgetSlot']
		expectTypeOf<InstanceType<EmptySlot>['$props']['name']>()
			.toEqualTypeOf<never>()
		expect(Empty.type)
			.toBe('Empty')
	})

	it('passes the child type through at run time and renders children unchanged', () => {
		const system = createWidgetSystem({ plugins: [HostPlugin, LabelPlugin, CounterPlugin, LeafPlugin] as const })
		const blueprint = system.createBlueprint({
			id: 'host',
			type: 'Host',
			slots: {
				header: [{ id: 'label-1', type: 'Label' }],
				body: [{ id: 'counter-1', type: 'Counter' }, { id: 'label-2', type: 'Label' }],
				free: [{ id: 'leaf-1', type: 'Leaf' }],
			},
		})
		if (blueprint.status !== 'valid')
			throw new Error(JSON.stringify(blueprint.diagnostics))
		const runtime = blueprint.createRuntime()

		const seen: Array<{ slot: string, type: string }> = []
		const HostRenderer = defineComponent({
			setup() {
				const { WidgetSlot } = useWidget(HostPlugin)
				return () => h('div', [
					h(WidgetSlot, { name: 'header' }, {
						default: ({ type, Child }: WidgetSlotScope<'Label'>) => {
							seen.push({ slot: 'header', type })
							return h(Child)
						},
					}),
					h(WidgetSlot, { name: 'body' }, {
						default: ({ type, Child }: WidgetSlotScope<'Label' | 'Counter'>) => {
							seen.push({ slot: 'body', type })
							return h(Child)
						},
					}),
					h(WidgetSlot, { name: 'free' }, {
						default: ({ type, Child }: WidgetSlotScope) => {
							seen.push({ slot: 'free', type })
							return h(Child)
						},
					}),
				])
			},
		})

		const Renderer = createWidgetVueRenderer(system, renderers => renderers
			.Host(HostRenderer)
			.Label(LabelRenderer)
			.Counter(CounterRenderer)
			.Leaf(LeafRenderer))
		const wrapper = mount(Renderer, { props: { runtime } })

		expect(seen)
			.toEqual([
				{ slot: 'header', type: 'Label' },
				{ slot: 'body', type: 'Counter' },
				{ slot: 'body', type: 'Label' },
				{ slot: 'free', type: 'Leaf' },
			])
		expect(wrapper.findAll('.label'))
			.toHaveLength(2)
		expect(wrapper.findAll('.counter'))
			.toHaveLength(1)
		expect(wrapper.findAll('.leaf'))
			.toHaveLength(1)
	})
})
