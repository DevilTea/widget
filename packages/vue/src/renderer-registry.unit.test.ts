/**
 * Conformance tests — issue #13 checkpoint G "Type-level conformance" (renderer-builder half) and the
 * runtime construction-validation half of checkpoint B.
 */

import type { AnyWidgetPlugin, WidgetInterfaces } from '@deviltea/widget-core'
import type { WidgetVueRendererEntry, WidgetVueRendererSection } from './renderer'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import { createWidgetVueRenderer } from './renderer'
import {
	ContainerRenderer,
	CounterPlugin,
	CounterRenderer,
	EmptyStateRenderer,
	fixtureSystem,
	LabelPlugin,
	LabelRenderer,
	LeafRenderer,
} from './test-fixtures'

const Placeholder = defineComponent(() => () => h('div'))

describe('renderer registry — type-level conformance', () => {
	it('narrows `Remaining` by one literal per registered key, in any order', () => {
		let captured: unknown

		createWidgetVueRenderer(fixtureSystem, (renderers) => {
			captured = renderers
			const afterLabel = renderers.Label(LabelRenderer)
			expectTypeOf(afterLabel)
				.toEqualTypeOf<WidgetVueRendererSection<'Counter' | 'Container' | 'Leaf' | 'EmptyState'>>()

			const afterCounter = afterLabel.Counter(CounterRenderer)
			const afterContainer = afterCounter.Container(ContainerRenderer)
			const afterLeaf = afterContainer.Leaf(LeafRenderer)
			const completed = afterLeaf.EmptyState(EmptyStateRenderer)
			expectTypeOf(completed)
				.toEqualTypeOf<WidgetVueRendererSection<never>>()
			return completed
		})

		expect(captured)
			.toBeDefined()
	})

	it('makes a consumed renderer key disappear from the type surface so it cannot be repeated (and rejects the resulting duplicate at runtime too)', () => {
		expect(() => {
			createWidgetVueRenderer(fixtureSystem, (renderers) => {
				const afterCounter = renderers.Counter(CounterRenderer)
				expectTypeOf(afterCounter).not.toHaveProperty('Counter')

				return afterCounter
					.Label(LabelRenderer)
					.Container(ContainerRenderer)
					.Leaf(LeafRenderer)
					// @ts-expect-error 'Counter' was already consumed; it must not reappear on the keyed-chain type
					.Counter(CounterRenderer)
					.EmptyState(EmptyStateRenderer)
			})
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('rejects an unknown renderer key at the type level', () => {
		createWidgetVueRenderer(fixtureSystem, (renderers) => {
			// @ts-expect-error 'NotARealType' is not a plugin type registered on `fixtureSystem`
			void renderers.NotARealType
			return renderers
				.Counter(CounterRenderer)
				.Label(LabelRenderer)
				.Container(ContainerRenderer)
				.Leaf(LeafRenderer)
				.EmptyState(EmptyStateRenderer)
		})
	})

	it('rejects an incomplete callback that leaves a plugin type unregistered (and rejects the resulting missing coverage at runtime too)', () => {
		expect(() => {
			createWidgetVueRenderer(
				fixtureSystem,
				// @ts-expect-error the callback omits 'EmptyState', so `Remaining` never reaches `never`
				renderers => renderers
					.Counter(CounterRenderer)
					.Label(LabelRenderer)
					.Container(ContainerRenderer)
					.Leaf(LeafRenderer),
			)
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('rejects an empty object literal masquerading as a completed registry (and rejects the resulting empty registry at runtime too)', () => {
		expect(() => {
			createWidgetVueRenderer(
				fixtureSystem,
				// @ts-expect-error `{}` has neither the private completion marker nor the renderer keys
				() => ({}),
			)
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('rejects a broadened `string` plugin-type universe: `Remaining` can never reduce to `never`', () => {
		const widenedPlugins: AnyWidgetPlugin[] = [CounterPlugin, LabelPlugin]
		const widenedSystem = createWidgetSystem({ plugins: widenedPlugins })

		expectTypeOf<WidgetVueRendererEntry<typeof widenedPlugins>>()
			.toEqualTypeOf<WidgetVueRendererSection<string>>()

		expect(() => {
			createWidgetVueRenderer(
				widenedSystem,
				// @ts-expect-error `widenedPlugins` widened `plugin.type` to `string`; no finite completion exists
				renderers => renderers,
			)
		})
			.toThrow(WidgetVueIntegrationError)
	})
})

describe('renderer registry — runtime construction validation', () => {
	it('builds successfully when every plugin type is registered exactly once', () => {
		const renderer = createWidgetVueRenderer(fixtureSystem, renderers =>
			renderers
				.Counter(CounterRenderer)
				.Label(LabelRenderer)
				.Container(ContainerRenderer)
				.Leaf(LeafRenderer)
				.EmptyState(EmptyStateRenderer))

		expect(renderer)
			.toBeDefined()
	})

	it('throws WidgetVueIntegrationError (a programmer/configuration exception) when a plugin type has no registered renderer', () => {
		expect(() => {
			createWidgetVueRenderer(
				fixtureSystem,
				// @ts-expect-error intentionally incomplete (omits 'EmptyState') at the type level too, to match the runtime scenario
				renderers => renderers
					.Counter(CounterRenderer)
					.Label(LabelRenderer)
					.Container(ContainerRenderer)
					.Leaf(LeafRenderer),
			)
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('throws when a renderer key is registered more than once, even though the type system already forbids it', () => {
		expect(() => {
			createWidgetVueRenderer(fixtureSystem, (renderers) => {
				const afterCounter = renderers.Counter(CounterRenderer)
				// Bypass the typestate the way an untyped/`any` call site could.
				;(afterCounter as unknown as { Counter: (component: unknown) => unknown }).Counter(Placeholder)
				return afterCounter
					.Label(LabelRenderer)
					.Container(ContainerRenderer)
					.Leaf(LeafRenderer)
					.EmptyState(EmptyStateRenderer)
			})
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('throws when an unknown plugin type is registered, even though the type system already forbids it', () => {
		expect(() => {
			createWidgetVueRenderer(fixtureSystem, (renderers) => {
				;(renderers as unknown as { NotReal: (component: unknown) => unknown }).NotReal(Placeholder)
				return renderers
					.Counter(CounterRenderer)
					.Label(LabelRenderer)
					.Container(ContainerRenderer)
					.Leaf(LeafRenderer)
					.EmptyState(EmptyStateRenderer)
			})
		})
			.toThrow(WidgetVueIntegrationError)
	})

	it('supports arbitrary string-literal renderer keys, including "__proto__" and "constructor"', () => {
		const weirdPlugin = createWidgetPlugin('__proto__')
			.interfaces<WidgetInterfaces>()
			.done()
		const ctorPlugin = createWidgetPlugin('constructor')
			.interfaces<WidgetInterfaces>()
			.done()
		const weirdSystem = createWidgetSystem({ plugins: [weirdPlugin, ctorPlugin] })

		// Bracket access through a variable key, not a literal `.__proto__`/`.constructor` member
		// expression, both to stay collision-safe the same way the implementation is and to avoid
		// tripping the repo's `no-proto` lint rule over what is here a legitimate plugin-type string.
		const protoKey = '__proto__' as const
		const ctorKey = 'constructor' as const

		const renderer = createWidgetVueRenderer(weirdSystem, (renderers) => {
			const afterProto = renderers[protoKey](Placeholder)
			return afterProto[ctorKey](Placeholder)
		})

		expect(renderer)
			.toBeDefined()
	})
})
