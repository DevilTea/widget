// @vitest-environment happy-dom
/**
 * `@deviltea/widget-vue/testing`: mount ONE renderer component against a real Runtime without a full
 * registry, using plain Vue (these tests deliberately use `createApp`, not `@vue/test-utils`).
 */

import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { WidgetVueIntegrationError } from './errors'
import {
	ContainerPlugin,
	CounterPlugin,
	CounterRenderer,
	createFixtureRuntime,
	LeafPlugin,
	LeafRenderer,
	topologyDefinition,
} from './test-fixtures'
import * as testing from './testing'
import { createWidgetTestHost } from './testing'
import { useWidget } from './use-widget'

function render(component: ReturnType<typeof createWidgetTestHost>): HTMLElement {
	const element = document.createElement('div')
	createApp(component)
		.mount(element)
	return element
}

function capture(run: () => unknown): unknown {
	try {
		run()
	}
	catch (error) {
		return error
	}
	return undefined
}

describe('@deviltea/widget-vue/testing', () => {
	it('exports only the helper, never the private injection key', () => {
		expect(Object.keys(testing))
			.toEqual(['createWidgetTestHost'])
	})

	it('renders the component in the given widget\'s context against the real Runtime, mountable with plain Vue', () => {
		const runtime = createFixtureRuntime({ id: 'c', type: 'Counter' }, { overrideStateDefaults: { c: { count: 4 } } })

		const element = render(createWidgetTestHost(runtime, 'c', CounterRenderer))

		const counter = element.querySelector('.counter')!
		expect(counter.getAttribute('data-count'))
			.toBe('4')
		expect(counter.getAttribute('data-doubled'))
			.toBe('8')
	})

	it('targets any widget id, including a nested one', () => {
		const runtime = createFixtureRuntime(topologyDefinition, { overrideStateDefaults: { 'nested-leaf': { label: 'NESTED' } } })

		const element = render(createWidgetTestHost(runtime, 'nested-leaf', LeafRenderer))

		expect(element.textContent)
			.toBe('NESTED')
	})

	it('renders slot children through the optional partial renderer map, and as nothing for unmapped types', () => {
		const runtime = createFixtureRuntime(topologyDefinition, {
			overrideStateDefaults: { 'leaf-a': { label: 'A' }, 'leaf-b': { label: 'B' }, 'nested-leaf': { label: 'NESTED' } },
		})
		const Section = defineComponent({
			setup() {
				const { WidgetSlot } = useWidget(ContainerPlugin)
				return () => h('section', [
					h('div', { class: 'header' }, [h(WidgetSlot, { name: 'header' })]),
					h('div', { class: 'body' }, [h(WidgetSlot, { name: 'body' })]),
				])
			},
		})

		const mapped = render(createWidgetTestHost(runtime, 'root', Section, { Leaf: LeafRenderer }))
		expect(Array.from(mapped.querySelectorAll('.header .leaf'), node => node.textContent))
			.toEqual(['A', 'B'])
		// The nested Container child has no mapped renderer: it renders nothing (and so do its leaves).
		expect(mapped.querySelector('.body')!.textContent)
			.toBe('')

		const unmapped = render(createWidgetTestHost(runtime, 'root', Section))
		expect(unmapped.querySelector('.header')!.textContent)
			.toBe('')
		expect(unmapped.querySelector('.header')!.children)
			.toHaveLength(0)
	})

	it('renders the tested widget with the given component even when its own type is also mapped for children', () => {
		const runtime = createFixtureRuntime(topologyDefinition, { overrideStateDefaults: { 'nested-leaf': { label: 'NESTED' } } })
		const Mapped = defineComponent(() => () => h('i', 'mapped'))
		const Section = defineComponent({
			setup() {
				const { WidgetSlot } = useWidget(ContainerPlugin)
				return () => h('section', [h(WidgetSlot, { name: 'body' })])
			},
		})

		// 'nested' is itself a Container; its own renderer is the component under test, while a Container
		// child elsewhere would render through the map.
		const element = render(createWidgetTestHost(runtime, 'root', Section, { Container: Mapped }))

		expect(element.querySelector('section')!.innerHTML)
			.toContain('mapped')
		expect(element.querySelector('section > section'))
			.toBeNull()
	})

	it('uses the real context construction: a mismatched plugin still throws widget-plugin-mismatch', () => {
		const runtime = createFixtureRuntime({ id: 'leaf', type: 'Leaf' })
		const Wrong = defineComponent({
			setup() {
				useWidget(CounterPlugin)
				return () => null
			},
		})
		const errors: unknown[] = []
		const app = createApp(createWidgetTestHost(runtime, 'leaf', Wrong))
		app.config.errorHandler = error => errors.push(error)
		app.mount(document.createElement('div'))

		expect(errors)
			.toHaveLength(1)
		expect(errors[0])
			.toBeInstanceOf(WidgetVueIntegrationError)
		expect((errors[0] as WidgetVueIntegrationError).code)
			.toBe('widget-plugin-mismatch')

		// And the matching plugin works.
		expect(render(createWidgetTestHost(runtime, 'leaf', defineComponent({
			setup() {
				const { widgetId } = useWidget(LeafPlugin)
				return () => h('p', widgetId)
			},
		}))).textContent)
			.toBe('leaf')
	})

	it('rejects an unknown widget id, a non-Runtime and a null Runtime with coded errors', () => {
		const runtime = createFixtureRuntime({ id: 'c', type: 'Counter' })

		const unknown = capture(() => createWidgetTestHost(runtime, 'nope', CounterRenderer))
		expect(unknown)
			.toBeInstanceOf(WidgetVueIntegrationError)
		expect((unknown as WidgetVueIntegrationError).code)
			.toBe('unknown-widget')

		const lookAlike = capture(() => createWidgetTestHost({ getWidget: runtime.getWidget, blueprint: runtime.blueprint } as never, 'c', CounterRenderer))
		expect((lookAlike as WidgetVueIntegrationError).code)
			.toBe('foreign-runtime')

		const nothing = capture(() => createWidgetTestHost(null as never, 'c', CounterRenderer))
		expect((nothing as WidgetVueIntegrationError).code)
			.toBe('invalid-runtime')
	})

	it('types the renderer map by the Runtime\'s plugin types', () => {
		const runtime = createFixtureRuntime({ id: 'c', type: 'Counter' })
		const noop = vi.fn()
		noop(createWidgetTestHost(runtime, 'c', CounterRenderer, { Leaf: LeafRenderer }))
		// @ts-expect-error 'NotAType' is not a plugin type of the Runtime's System
		noop(createWidgetTestHost(runtime, 'c', CounterRenderer, { NotAType: LeafRenderer }))
	})
})
