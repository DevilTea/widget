// @vitest-environment happy-dom
/**
 * Conformance tests — diagnostic #13 checkpoint G "Renderer / topology conformance", checkpoints D and E.
 *
 * Recursive `WidgetSlot` rendering, semantic child order, empty slots, arbitrary slot names,
 * nearest-widget provider shadowing, exact renderer lookup, and renderer/plugin mismatch as a
 * programmer exception.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import { createWidgetVueRenderer, SharedWidgetSlotComponent } from './renderer'
import {
	ContainerPlugin,
	ContainerRenderer,
	CounterRenderer,
	createFixtureRuntime,
	EmptyStateRenderer,
	fixtureSystem,
	LabelPlugin,
	LabelRenderer,
	LeafRenderer,
	topologyDefinition,
} from './test-fixtures'
import { useWidget } from './use-widget'

const WidgetRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
	renderers
		.Counter(CounterRenderer)
		.Label(LabelRenderer)
		.Container(ContainerRenderer)
		.Leaf(LeafRenderer)
		.EmptyState(EmptyStateRenderer))

describe('renderer / topology — mounted conformance', () => {
	it('renders the recursive WidgetSlot topology, exact renderer per plugin type, in semantic child order', () => {
		const runtime = createFixtureRuntime(topologyDefinition, {
			overrideStateDefaults: {
				'leaf-a': { label: 'A' },
				'leaf-b': { label: 'B' },
				'nested-leaf': { label: 'NESTED' },
				'nested-slot-one-leaf': { label: 'SLOT-ONE' },
			},
		})

		const wrapper = mount(WidgetRenderer, { props: { runtime } })

		// Exact renderer lookup: `wrapper`'s own root element is the root Container's rendered output.
		expect(wrapper.element.classList.contains('container'))
			.toBe(true)

		// Semantic child order: two Leaves in one `header` slot, in declaration order. `:scope` keeps
		// each selector anchored to the exact element being queried, since both the root and the nested
		// Container share the same `.container`/`.header`/`.body`/`.slot-one` class names.
		const rootHeader = wrapper.get(':scope > .header')
		expect(rootHeader.findAll('.leaf')
			.map(node => node.text()))
			.toEqual(['A', 'B'])

		const nestedContainer = wrapper.get(':scope > .body > .container')

		// An empty slot renders no children (the nested Container's `body`).
		expect(nestedContainer.get(':scope > .body')
			.findAll('.leaf'))
			.toHaveLength(0)

		// Recursive WidgetSlot rendering: the nested Container's own `header` resolves its own child,
		// distinct from the root's.
		expect(nestedContainer.get(':scope > .header')
			.get('.leaf')
			.text())
			.toBe('NESTED')

		// Arbitrary/hyphenated slot name (`slot-one`): empty at the root, populated on the nested node.
		expect(wrapper.get(':scope > .slot-one')
			.findAll('.leaf'))
			.toHaveLength(0)
		expect(nestedContainer.get(':scope > .slot-one')
			.get('.leaf')
			.text())
			.toBe('SLOT-ONE')
	})

	it('nearest-widget provider shadowing: each nested widget resolves its own current widget, not an ancestor\'s', () => {
		const definition = {
			id: 'root',
			type: 'Container',
			slots: {
				'header': [{ id: 'counter-outer', type: 'Counter' }],
				'body': [{
					id: 'nested',
					type: 'Container',
					slots: {
						'header': [{ id: 'counter-inner', type: 'Counter' }],
						'body': [],
						'slot-one': [],
					},
				}],
				'slot-one': [],
			},
		}
		const runtime = createFixtureRuntime(definition, {
			overrideStateDefaults: {
				'counter-outer': { count: 1 },
				'counter-inner': { count: 100 },
			},
		})

		const wrapper = mount(WidgetRenderer, { props: { runtime } })
		const counters = wrapper.findAll('.counter')
		expect(counters.map(node => node.attributes('data-count')))
			.toEqual(['1', '100'])
	})

	it('throws a programmer exception when a renderer calls useWidget() with a plugin that does not match the currently rendered widget', () => {
		const BrokenRenderer = defineComponent({
			name: 'BrokenRenderer',
			setup() {
				// Wrong plugin: this component is registered for 'Counter' but calls useWidget(LabelPlugin).
				useWidget(LabelPlugin)
				return () => h('div')
			},
		})

		const MismatchedRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
			renderers
				.Counter(BrokenRenderer)
				.Label(LabelRenderer)
				.Container(ContainerRenderer)
				.Leaf(LeafRenderer)
				.EmptyState(EmptyStateRenderer))

		const runtime = createFixtureRuntime({ id: 'mismatch', type: 'Counter' })

		expect(() => mount(MismatchedRenderer, { props: { runtime } }))
			.toThrow(WidgetVueIntegrationError)
	})

	it('throws when useWidget()/WidgetSlot is used outside a widget renderer host', () => {
		const Rogue = defineComponent({
			name: 'RogueSlotUser',
			setup() {
				const { WidgetSlot } = useWidget(ContainerPlugin)
				return () => h(WidgetSlot, { name: 'header' })
			},
		})

		expect(() => mount(Rogue))
			.toThrow(WidgetVueIntegrationError)
	})

	it('throws when the shared WidgetSlot component itself is mounted with no CurrentWidgetContext provided', () => {
		// `WidgetSlot`'s own "outside a host" guard is a separate code path from `useWidget()`'s (each
		// is reached from a different entry point into the package), so it gets its own direct test
		// against the exact shared component identity, without needing a full renderer tree.
		expect(() => mount(SharedWidgetSlotComponent, { props: { name: 'header' } }))
			.toThrow(WidgetVueIntegrationError)
	})
})
