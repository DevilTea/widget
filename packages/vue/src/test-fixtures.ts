/**
 * Shared real `@deviltea/widget-core` fixtures for `@deviltea/widget-vue`'s unit tests.
 *
 * Per issue #13 checkpoint G, conformance tests use real Runtime fixtures, never a parallel mocked
 * semantic core. Not part of the public contract, not exported from `index.ts`, and excluded from the
 * `tsconfig.package.json` program (see that file's `exclude`).
 */

import type { AnyWidgetPlugin, AnyWidgetPluginTuple, CreateWidgetSystemRuntimeOptions, RuntimeWidgetFor, WidgetInterfaces, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { RuntimeWidgetLike } from './context'
import type { UseWidgetResult } from './types'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { CurrentWidgetContextKey } from './context'
import { useWidget } from './use-widget'

// -------------------------------------------------------------------------------------------------
// Plugins
// -------------------------------------------------------------------------------------------------

export interface CounterInterfaces extends WidgetInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
	methods: {
		increment: (step: number) => number
		reset: () => void
		crash: () => never
		then: () => string
	}
}

export const CounterPlugin = createWidgetPlugin('Counter')
	.interfaces<CounterInterfaces>()
	.state(state =>
		state.count({
			validate: (input): input is number => typeof input === 'number' && input >= 0,
			default: () => 0,
		}))
	.properties(properties =>
		properties.doubled({
			registerDeps: ({ dep }) => dep.self.state.get('count'),
			compute: ({ deps }) => {
				const result = deps()
				return (result.success ? (result.value ?? 0) : 0) * 2
			},
		}))
	.methods(methods =>
		methods
			.increment({
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count'),
					setCount: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
				execute: ({ args: [step], deps }) => {
					const current = deps.count()
					const value = (current.success ? (current.value ?? 0) : 0) + step
					deps.setCount(value)
					return value
				},
			})
			.reset({
				registerDeps: ({ dep }) => dep.self.state.set('count'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps(0)
				},
			})
			.crash({
				validateArgs: (args): args is [] => args.length === 0,
				execute: (): never => {
					throw new Error('crash() always throws — an implementation exception, not an Issue.')
				},
			})
			.then({
				validateArgs: (args): args is [] => args.length === 0,
				execute: () => 'not-a-promise',
			}))
	.done()

export interface LabelInterfaces extends WidgetInterfaces {
	properties: {
		text: string
		failing: string
	}
}

export const LabelPlugin = createWidgetPlugin('Label')
	.interfaces<LabelInterfaces>()
	.properties(properties =>
		properties
			.text({
				compute: () => 'hello',
			})
			.failing({
				compute: (ctx) => {
					ctx.addIssue({ message: 'this property always fails' })
					return ''
				},
			}))
	.done()

export interface ContainerInterfaces extends WidgetInterfaces {
	slots: 'header' | 'body' | 'slot-one'
}

export const ContainerPlugin = createWidgetPlugin('Container')
	.interfaces<ContainerInterfaces>()
	.slots({ 'header': {}, 'body': {}, 'slot-one': {} })
	.done()

export interface LeafInterfaces extends WidgetInterfaces {
	state: {
		label: string
	}
}

export const LeafPlugin = createWidgetPlugin('Leaf')
	.interfaces<LeafInterfaces>()
	.state(state =>
		state.label({
			validate: (input): input is string => typeof input === 'string',
			default: () => '',
		}))
	.done()

export interface EmptyStateInterfaces extends WidgetInterfaces {
	state: Record<never, never>
}

export const EmptyStatePlugin = createWidgetPlugin('EmptyState')
	.interfaces<EmptyStateInterfaces>()
	.state(state => state)
	.done()

export interface EmptyPropertiesInterfaces extends WidgetInterfaces {
	properties: Record<never, never>
}

export const EmptyPropertiesPlugin = createWidgetPlugin('EmptyProperties')
	.interfaces<EmptyPropertiesInterfaces>()
	.properties(properties => properties)
	.done()

export interface EmptyMethodsInterfaces extends WidgetInterfaces {
	methods: Record<never, never>
}

export const EmptyMethodsPlugin = createWidgetPlugin('EmptyMethods')
	.interfaces<EmptyMethodsInterfaces>()
	.methods(methods => methods)
	.done()

/**
 * `slots: never` is the canonical explicit-empty-slots spelling (issue #10 amendment
 * "declaration-presence semantics and public `WidgetPlugin.capabilities`"). The `slots` capability is
 * present (`HasWidgetCapability<..., 'slots'>` is `true`, `plugin.capabilities.slots` is `true`) even
 * though there is no legal slot name to declare a child under — `.slots({})` is the required, and only
 * legal, builder phase completion.
 */
export interface EmptySlotsInterfaces extends WidgetInterfaces {
	slots: never
}

export const EmptySlotsPlugin = createWidgetPlugin('EmptySlots')
	.interfaces<EmptySlotsInterfaces>()
	.slots({})
	.done()

export const fixturePlugins = [CounterPlugin, LabelPlugin, ContainerPlugin, LeafPlugin, EmptyStatePlugin] as const

export const fixtureSystem = createWidgetSystem({ plugins: fixturePlugins })

/**
 * A separate, small system dedicated to explicit-empty-vs-absent capability conformance
 * (`EmptyPropertiesPlugin` / `EmptyMethodsPlugin` / `EmptySlotsPlugin`). Kept independent of
 * `fixtureSystem` so these additions never ripple into the renderer-registry exhaustiveness checks
 * exercised by every other fixture-driven test file.
 */
export const capabilityFixturePlugins = [EmptyPropertiesPlugin, EmptyMethodsPlugin, EmptySlotsPlugin] as const

export const capabilityFixtureSystem = createWidgetSystem({ plugins: capabilityFixturePlugins })

export function createCapabilityFixtureRuntime(definition: unknown, options?: CreateWidgetSystemRuntimeOptions) {
	const blueprint = capabilityFixtureSystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Invalid capability fixture blueprint: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	return blueprint.createRuntime(options)
}

/**
 * A second, structurally-identical `WidgetSystem` instance. Used to prove that
 * `createWidgetVueRenderer`/`WidgetRenderer` reject a Runtime by `blueprint.system` *identity*, not by
 * structural plugin-shape equality.
 */
export const otherFixtureSystem = createWidgetSystem({ plugins: fixturePlugins })

export function createFixtureRuntime(definition: unknown, options?: CreateWidgetSystemRuntimeOptions) {
	const blueprint = fixtureSystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Invalid fixture blueprint: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	return blueprint.createRuntime(options)
}

export function createOtherFixtureRuntime(definition: unknown, options?: CreateWidgetSystemRuntimeOptions) {
	const blueprint = otherFixtureSystem.createBlueprint(definition)
	if (blueprint.status !== 'valid')
		throw new Error(`Invalid fixture blueprint: ${JSON.stringify(blueprint.getCollectedIssues())}`)

	return blueprint.createRuntime(options)
}

type FixturePlugins = typeof fixturePlugins

/**
 * `runtime.getWidget(id)` is distributed over every registered plugin type, so tests that need one
 * exact plugin's `state`/`properties`/`methods` surface narrow through these small type-asserting
 * helpers instead of repeating an `as` cast at every call site.
 */
function narrowWidget<Plugin extends FixturePlugins[number]>(
	runtime: WidgetSystemRuntime<FixturePlugins>,
	id: string,
	type: Plugin['type'],
): RuntimeWidgetFor<Plugin, FixturePlugins> {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== type)
		throw new Error(`fixture setup error: expected widget "${id}" of type "${type}"`)

	return widget as unknown as RuntimeWidgetFor<Plugin, FixturePlugins>
}

export function getCounterWidget(runtime: WidgetSystemRuntime<FixturePlugins>, id: string): RuntimeWidgetFor<typeof CounterPlugin, FixturePlugins> {
	return narrowWidget<typeof CounterPlugin>(runtime, id, 'Counter')
}

export function getLabelWidget(runtime: WidgetSystemRuntime<FixturePlugins>, id: string): RuntimeWidgetFor<typeof LabelPlugin, FixturePlugins> {
	return narrowWidget<typeof LabelPlugin>(runtime, id, 'Label')
}

export function getContainerWidget(runtime: WidgetSystemRuntime<FixturePlugins>, id: string): RuntimeWidgetFor<typeof ContainerPlugin, FixturePlugins> {
	return narrowWidget<typeof ContainerPlugin>(runtime, id, 'Container')
}

export function getLeafWidget(runtime: WidgetSystemRuntime<FixturePlugins>, id: string): RuntimeWidgetFor<typeof LeafPlugin, FixturePlugins> {
	return narrowWidget<typeof LeafPlugin>(runtime, id, 'Leaf')
}

export function getEmptyStateWidget(runtime: WidgetSystemRuntime<FixturePlugins>, id: string): RuntimeWidgetFor<typeof EmptyStatePlugin, FixturePlugins> {
	return narrowWidget<typeof EmptyStatePlugin>(runtime, id, 'EmptyState')
}

/**
 * A representative topology exercising: recursive `WidgetSlot` rendering (nested `Container`),
 * semantic child order (two `Leaf`s in one `header` slot), an empty slot (`body` of the nested
 * `Container`), and an arbitrary/hyphenated slot name (`slot-one`).
 */
export const topologyDefinition = {
	id: 'root',
	type: 'Container',
	slots: {
		'header': [
			{ id: 'leaf-a', type: 'Leaf' },
			{ id: 'leaf-b', type: 'Leaf' },
		],
		'body': [
			{
				id: 'nested',
				type: 'Container',
				slots: {
					'header': [{ id: 'nested-leaf', type: 'Leaf' }],
					'body': [],
					'slot-one': [{ id: 'nested-slot-one-leaf', type: 'Leaf' }],
				},
			},
		],
		'slot-one': [],
	},
}

// -------------------------------------------------------------------------------------------------
// Renderer components
// -------------------------------------------------------------------------------------------------

export const CounterRenderer = defineComponent({
	name: 'CounterRenderer',
	setup() {
		const { useState, useProperties } = useWidget(CounterPlugin)
		const { count } = useState()
		const { doubled } = useProperties()
		return () => h('div', { 'class': 'counter', 'data-count': String(count.value), 'data-doubled': String(doubled.value) })
	},
})

export const LabelRenderer = defineComponent({
	name: 'LabelRenderer',
	setup() {
		const { useProperties } = useWidget(LabelPlugin)
		const { text } = useProperties()
		return () => h('span', { class: 'label' }, text.value ?? '')
	},
})

export const ContainerRenderer = defineComponent({
	name: 'ContainerRenderer',
	setup() {
		const { WidgetSlot } = useWidget(ContainerPlugin)
		return () => h('div', { class: 'container' }, [
			h('div', { class: 'header' }, [h(WidgetSlot, { name: 'header' })]),
			h('div', { class: 'body' }, [h(WidgetSlot, { name: 'body' })]),
			h('div', { class: 'slot-one' }, [h(WidgetSlot, { name: 'slot-one' })]),
		])
	},
})

export const LeafRenderer = defineComponent({
	name: 'LeafRenderer',
	setup() {
		const { useState } = useWidget(LeafPlugin)
		const { label } = useState()
		return () => h('span', { class: 'leaf' }, label.value ?? '')
	},
})

export const EmptyStateRenderer = defineComponent({
	name: 'EmptyStateRenderer',
	setup() {
		useWidget(EmptyStatePlugin)
		return () => h('div', { class: 'empty-state' })
	},
})

// -------------------------------------------------------------------------------------------------
// useWidget() bridge test harness
// -------------------------------------------------------------------------------------------------

/**
 * `useWidget(Plugin)` requires Vue's component injection (`inject()`), which in turn requires an
 * active component instance — a bare `effectScope()` is not enough. This mounts a throwaway component
 * that calls `useWidget(plugin)` during `setup()`, with `CurrentWidgetContext` provided directly
 * (bypassing the full recursive renderer/registry, which `renderer-mounted.unit.test.ts` covers
 * separately) so `useWidget()` itself can be exercised against a real Runtime widget in isolation.
 */
export function mountWidgetBridge<Plugins extends AnyWidgetPluginTuple, Plugin extends AnyWidgetPlugin>(
	runtime: WidgetSystemRuntime<Plugins>,
	widgetId: string,
	plugin: Plugin,
) {
	const widget = runtime.getWidget(widgetId)
	if (widget === null)
		throw new Error(`fixture setup error: widget "${widgetId}" not found`)

	let bridge!: UseWidgetResult<Plugin>
	const wrapper = mount(defineComponent({
		setup() {
			bridge = useWidget(plugin)
			return () => null
		},
	}), {
		global: {
			provide: {
				[CurrentWidgetContextKey as unknown as string]: {
					widget: widget as unknown as RuntimeWidgetLike,
					runtime,
					rendererByType: new Map(),
				},
			},
		},
	})

	return { wrapper, bridge }
}
