/**
 * Sandbox Vue renderers, registered against `sandboxSystem` through the public
 * `@deviltea/widget-vue` contract only (`createWidgetVueRenderer`, `useWidget`). No private
 * `@deviltea/widget-vue` import, no renderer-side access to Runtime/Blueprint beyond what
 * `useWidget()` exposes.
 *
 * Every renderer below projects `useWidget()`'s `widgetId`/`widgetType` identity fields onto its own
 * root vnode via `useInspectAnchor()` (diagnostic #25 P2 "Preview -> semantic inspector bridge" merge-gate
 * review round 1, blocker 2: Sandbox is the Lab's *default* showcase, so an Inspect toggle with zero
 * anchors there is a non-functional/misleading mode). These are render-function components, not SFCs
 * with a `v-bind`-able template root, so the anchor attrs are spread directly into each `h()` call's
 * props object instead — the same composable, the same plain non-reactive values, just a different
 * (non-template) merge point. This also evidences the public identity contract composes cleanly outside
 * SFC renderers.
 */

import { createWidgetVueRenderer, useWidget } from '@deviltea/widget-vue'
import { defineComponent, h } from 'vue'
import { useInspectAnchor } from '../composables/use-inspect-anchor'
import { CounterPlugin, SectionPlugin, StackPlugin, SummaryPlugin, TextPlugin } from './plugins'
import { sandboxSystem } from './system'

const TextRenderer = defineComponent({
	name: 'SandboxTextRenderer',
	setup() {
		const { useProperties, widgetId, widgetType } = useWidget(TextPlugin)
		const { content } = useProperties()
		const inspectAnchor = useInspectAnchor(widgetId, widgetType)
		return () => h('p', { class: 'sandbox-text', ...inspectAnchor }, content.value ?? '')
	},
})

const CounterRenderer = defineComponent({
	name: 'SandboxCounterRenderer',
	setup() {
		const { useState, useProperties, useMethods, widgetId, widgetType } = useWidget(CounterPlugin)
		const { count } = useState()
		const { doubled } = useProperties()
		const { increment, reset } = useMethods()
		const inspectAnchor = useInspectAnchor(widgetId, widgetType)
		return () => h('div', { class: 'sandbox-counter', ...inspectAnchor }, [
			h('span', { class: 'sandbox-counter__value' }, `count: ${count.value ?? 0} · doubled: ${doubled.value ?? 0}`),
			h('button', { type: 'button', onClick: () => increment(1) }, '+1'),
			h('button', { type: 'button', onClick: () => reset() }, 'reset'),
		])
	},
})

const SectionRenderer = defineComponent({
	name: 'SandboxSectionRenderer',
	setup() {
		const { useProperties, WidgetSlot, widgetId, widgetType } = useWidget(SectionPlugin)
		const { heading } = useProperties()
		const inspectAnchor = useInspectAnchor(widgetId, widgetType)
		return () => h('section', { class: 'sandbox-section', ...inspectAnchor }, [
			h('h3', {}, heading.value ?? ''),
			h('div', { class: 'sandbox-section__body' }, [h(WidgetSlot, { name: 'body' })]),
		])
	},
})

const StackRenderer = defineComponent({
	name: 'SandboxStackRenderer',
	setup() {
		const { WidgetSlot, widgetId, widgetType } = useWidget(StackPlugin)
		const inspectAnchor = useInspectAnchor(widgetId, widgetType)
		return () => h('div', { class: 'sandbox-stack', ...inspectAnchor }, [h(WidgetSlot, { name: 'items' })])
	},
})

const SummaryRenderer = defineComponent({
	name: 'SandboxSummaryRenderer',
	setup() {
		const { useProperties, widgetId, widgetType } = useWidget(SummaryPlugin)
		const { total } = useProperties()
		const inspectAnchor = useInspectAnchor(widgetId, widgetType)
		return () => h('p', { class: 'sandbox-summary', ...inspectAnchor }, `Summary total: ${total.value ?? 0}`)
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
