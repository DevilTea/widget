// @vitest-environment happy-dom
/**
 * `WidgetSlot` with a default scoped slot: called once per child in Blueprint order with
 * `{ Child, id, type, index }`, so a renderer can wrap, skip or reorder-free decorate children while
 * `Child` still renders each widget through the normal host. Without a default slot it behaves as before.
 */

import type { WidgetSlotScope } from './types'
import { mount } from '@vue/test-utils'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { createWidgetVueRenderer } from './renderer'
import {
	ContainerPlugin,
	CounterRenderer,
	createFixtureRuntime,
	EmptyStateRenderer,
	fixtureSystem,
	LabelRenderer,
	LeafPlugin,
} from './test-fixtures'
import { useWidget } from './use-widget'

const definition = {
	id: 'root',
	type: 'Container',
	slots: {
		'header': [
			{ id: 'leaf-a', type: 'Leaf' },
			{ id: 'leaf-b', type: 'Leaf' },
			{ id: 'leaf-c', type: 'Leaf' },
		],
		'body': [],
		'slot-one': [],
	},
}

const overrides = {
	overrideStateDefaults: {
		'leaf-a': { label: 'A' },
		'leaf-b': { label: 'B' },
		'leaf-c': { label: 'C' },
	},
}

function setup(render: (scope: WidgetSlotScope) => unknown) {
	const mounted = vi.fn<(id: string) => void>()
	const unmounted = vi.fn<(id: string) => void>()
	const scopes: WidgetSlotScope[] = []
	const tick = ref(0)

	const TrackedLeaf = defineComponent({
		setup() {
			const { widgetId, useState } = useWidget(LeafPlugin)
			const { label } = useState()
			onMounted(() => mounted(widgetId))
			onUnmounted(() => unmounted(widgetId))
			return () => h('span', { class: 'leaf' }, label.value ?? '')
		},
	})

	const ScopedContainer = defineComponent({
		setup() {
			const { WidgetSlot } = useWidget(ContainerPlugin)
			return () => {
				void tick.value
				return h('div', { class: 'container' }, [
					h(WidgetSlot, { name: 'header' }, {
						default: (scope: WidgetSlotScope) => {
							scopes.push(scope)
							return render(scope) as never
						},
					}),
					h(WidgetSlot, { name: 'body' }, {
						default: (scope: WidgetSlotScope) => {
							scopes.push(scope)
							return render(scope) as never
						},
					}),
				])
			}
		},
	})

	const WidgetRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
		renderers
			.Counter(CounterRenderer)
			.Label(LabelRenderer)
			.Container(ScopedContainer)
			.Leaf(TrackedLeaf)
			.EmptyState(EmptyStateRenderer))

	const runtime = createFixtureRuntime(definition, overrides)
	const wrapper = mount(WidgetRenderer, { props: { runtime } })
	return { wrapper, runtime, mounted, unmounted, scopes, tick }
}

describe('widgetSlot scoped default slot', () => {
	it('calls the slot once per child in Blueprint order with id, type, index and a Child component', () => {
		const { wrapper, scopes } = setup(({ Child, id, index }) =>
			h('li', { 'data-id': id, 'data-index': String(index) }, [h(Child)]))

		expect(scopes.map(({ id, type, index }) => ({ id, type, index })))
			.toEqual([
				{ id: 'leaf-a', type: 'Leaf', index: 0 },
				{ id: 'leaf-b', type: 'Leaf', index: 1 },
				{ id: 'leaf-c', type: 'Leaf', index: 2 },
			])

		const items = wrapper.findAll('li')
		expect(items.map(item => item.attributes('data-id')))
			.toEqual(['leaf-a', 'leaf-b', 'leaf-c'])
		expect(items.map(item => item.attributes('data-index')))
			.toEqual(['0', '1', '2'])
		// `Child` renders the child through the normal host: its registered renderer and state.
		expect(items.map(item => item.get('.leaf')
			.text()))
			.toEqual(['A', 'B', 'C'])
	})

	it('lets the renderer skip a child', () => {
		const { wrapper } = setup(({ Child, id }) => id === 'leaf-b' ? null : h('li', { 'data-id': id }, [h(Child)]))

		expect(wrapper.findAll('li')
			.map(item => item.attributes('data-id')))
			.toEqual(['leaf-a', 'leaf-c'])
		expect(wrapper.findAll('.leaf')
			.map(node => node.text()))
			.toEqual(['A', 'C'])
	})

	it('does not remount a child when the surrounding markup re-renders or a sibling is skipped later', async () => {
		const skipB = ref(false)
		const wrapperClass = ref('one')
		const { wrapper, mounted, unmounted, tick } = setup(({ Child, id }) =>
			skipB.value && id === 'leaf-b' ? null : h('li', { 'data-id': id, 'class': wrapperClass.value }, [h(Child)]))

		expect(mounted.mock.calls.map(([id]) => id))
			.toEqual(['leaf-a', 'leaf-b', 'leaf-c'])

		// The renderer's own wrapper markup changes and the whole container re-renders.
		wrapperClass.value = 'two'
		tick.value++
		await nextTick()
		expect(wrapper.findAll('li.two'))
			.toHaveLength(3)

		// Skipping the middle child must not disturb the others.
		skipB.value = true
		await nextTick()
		expect(wrapper.findAll('li')
			.map(item => item.attributes('data-id')))
			.toEqual(['leaf-a', 'leaf-c'])

		expect(mounted)
			.toHaveBeenCalledTimes(3)
		expect(unmounted.mock.calls.map(([id]) => id))
			.toEqual(['leaf-b'])
	})

	it('remounts a child when the renderer changes the wrapper element type or skips and re-shows it, as any Vue component would', async () => {
		const asSection = ref(false)
		const skipB = ref(false)
		const { wrapper, mounted, unmounted, tick } = setup(({ Child, id }) =>
			skipB.value && id === 'leaf-b' ? null : h(asSection.value ? 'section' : 'li', { 'data-id': id }, [h(Child)]))

		expect(mounted)
			.toHaveBeenCalledTimes(3)

		// A stable wrapper keeps every child mounted while the surrounding markup re-renders.
		tick.value++
		await nextTick()
		expect(mounted)
			.toHaveBeenCalledTimes(3)
		expect(unmounted).not.toHaveBeenCalled()

		// Skipping and re-showing one child unmounts it and mounts a fresh instance.
		skipB.value = true
		await nextTick()
		skipB.value = false
		await nextTick()
		expect(unmounted.mock.calls.map(([id]) => id))
			.toEqual(['leaf-b'])
		expect(mounted.mock.calls.map(([id]) => id))
			.toEqual(['leaf-a', 'leaf-b', 'leaf-c', 'leaf-b'])

		// A different wrapper element type remounts every child.
		asSection.value = true
		await nextTick()
		expect(wrapper.findAll('section'))
			.toHaveLength(3)
		expect(unmounted)
			.toHaveBeenCalledTimes(4)
		expect(mounted)
			.toHaveBeenCalledTimes(7)
	})

	it('hands the same Child component identity to every render of a given child', async () => {
		const { scopes, tick } = setup(({ Child }) => h(Child))

		const firstRender = scopes.slice(0, 3)
		tick.value++
		await nextTick()
		const secondRender = scopes.slice(3, 6)

		expect(secondRender.map(scope => scope.id))
			.toEqual(['leaf-a', 'leaf-b', 'leaf-c'])
		for (const [index, scope] of secondRender.entries()) {
			expect(scope.Child)
				.toBe(firstRender[index]!.Child)
		}
		expect(new Set(firstRender.map(scope => scope.Child)).size)
			.toBe(3)
	})

	it('never calls the slot for an empty slot', () => {
		const { scopes } = setup(({ Child }) => h(Child))

		// `body` is empty: only the three `header` children produced scopes.
		expect(scopes)
			.toHaveLength(3)
	})

	it('keeps rendering the unscoped form exactly as before when no default slot is given', () => {
		const ContainerWithoutSlotContent = defineComponent({
			setup() {
				const { WidgetSlot } = useWidget(ContainerPlugin)
				return () => h('div', { class: 'container' }, [h(WidgetSlot, { name: 'header' })])
			},
		})
		const WidgetRenderer = createWidgetVueRenderer(fixtureSystem, renderers =>
			renderers
				.Counter(CounterRenderer)
				.Label(LabelRenderer)
				.Container(ContainerWithoutSlotContent)
				.Leaf(defineComponent({
					setup() {
						const { useState } = useWidget(LeafPlugin)
						const { label } = useState()
						return () => h('span', { class: 'leaf' }, label.value ?? '')
					},
				}))
				.EmptyState(EmptyStateRenderer))

		const wrapper = mount(WidgetRenderer, { props: { runtime: createFixtureRuntime(definition, overrides) } })

		expect(wrapper.findAll('.leaf')
			.map(node => node.text()))
			.toEqual(['A', 'B', 'C'])
	})

	it('types the slot scope publicly', () => {
		expectTypeOf<WidgetSlotScope['id']>()
			.toEqualTypeOf<string>()
		expectTypeOf<WidgetSlotScope['type']>()
			.toEqualTypeOf<string>()
		expectTypeOf<WidgetSlotScope['index']>()
			.toEqualTypeOf<number>()
	})
})
