/**
 * Sandbox Vue renderers, registered against `sandboxSystem` through the public
 * `@deviltea/widget-vue` contract only (`createWidgetVueRenderer`, `useWidget`). No private
 * `@deviltea/widget-vue` import, no renderer-side access to Runtime/Blueprint beyond what
 * `useWidget()` exposes.
 */

import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { defineComponent, h } from 'vue'
import { CounterPlugin, SectionPlugin, StackPlugin, SummaryPlugin, TextPlugin } from './plugins'
import { sandboxSystem } from './system'

const TextRenderer = defineComponent({
	name: 'SandboxTextRenderer',
	setup() {
		const { useProperties } = useWidget(TextPlugin)
		const { content } = useProperties()
		return () => h('p', { class: 'sandbox-text' }, content.value ?? '')
	},
})

const CounterRenderer = defineComponent({
	name: 'SandboxCounterRenderer',
	setup() {
		const { useState, useProperties, useMethods } = useWidget(CounterPlugin)
		const { count } = useState()
		const { doubled } = useProperties()
		const { increment, reset } = useMethods()
		return () => h('div', { class: 'sandbox-counter' }, [
			h('span', { class: 'sandbox-counter__value' }, `count: ${count.value ?? 0} · doubled: ${doubled.value ?? 0}`),
			h('button', { type: 'button', onClick: () => increment(1) }, '+1'),
			h('button', { type: 'button', onClick: () => reset() }, 'reset'),
		])
	},
})

const SectionRenderer = defineComponent({
	name: 'SandboxSectionRenderer',
	setup() {
		const { useProperties, WidgetSlot } = useWidget(SectionPlugin)
		const { heading } = useProperties()
		return () => h('section', { class: 'sandbox-section' }, [
			h('h3', {}, heading.value ?? ''),
			h('div', { class: 'sandbox-section__body' }, [h(WidgetSlot, { name: 'body' })]),
		])
	},
})

const StackRenderer = defineComponent({
	name: 'SandboxStackRenderer',
	setup() {
		const { WidgetSlot } = useWidget(StackPlugin)
		return () => h('div', { class: 'sandbox-stack' }, [h(WidgetSlot, { name: 'items' })])
	},
})

const SummaryRenderer = defineComponent({
	name: 'SandboxSummaryRenderer',
	setup() {
		const { useProperties } = useWidget(SummaryPlugin)
		const { total } = useProperties()
		return () => h('p', { class: 'sandbox-summary' }, `Summary total: ${total.value ?? 0}`)
	},
})

/**
 * The one Preview renderer component for the sandbox `WidgetSystem`, exhaustively covering every
 * registered plugin type (`createWidgetVueRenderer` rejects incomplete/duplicate/unknown coverage at
 * construction time).
 */
export const SandboxRenderer = createWidgetVueRenderer(sandboxSystem, renderers =>
	renderers
		.Text(TextRenderer)
		.Counter(CounterRenderer)
		.Section(SectionRenderer)
		.Stack(StackRenderer)
		.Summary(SummaryRenderer))
