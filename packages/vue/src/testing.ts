/**
 * `@deviltea/widget-vue/testing` — test ONE renderer component against a real Runtime without building
 * a full renderer registry, using plain Vue (no `@vue/test-utils` dependency).
 *
 * This subpath exposes nothing of the package's private injection context: the helper provides the
 * same widget context the real renderer's host provides, through the same construction, and keeps
 * the key to itself.
 */

import type { AnyWidgetPluginTuple, WidgetPluginTypeOf, WidgetSystemRuntime } from '@deviltea/widget-core'
import type { Component } from 'vue'
import type { RuntimeWidgetLike } from './context'
import { defineComponent, h } from 'vue'
import { provideCurrentWidgetContext } from './context'
import { WidgetVueIntegrationError } from './errors'
import { assertWidgetRuntime } from './runtime-guard'

/**
 * Renderers for the other widgets a tested component's slots may contain, keyed by plugin type. Any
 * plugin type left out renders as nothing.
 */
export type WidgetTestRenderers<Plugins extends AnyWidgetPluginTuple> = {
	readonly [Type in WidgetPluginTypeOf<Plugins[number]>]?: Component
}

const RendersNothing = defineComponent({
	name: 'WidgetTestPlaceholder',
	setup: () => () => null,
})

/**
 * Returns a component, mountable with plain Vue (`createApp(host).mount(el)`), that renders
 * `component` as the renderer of the widget `widgetId` of `runtime`: inside it, `useWidget(Plugin)`
 * resolves that widget exactly as under a real `WidgetRenderer`, including the exact-plugin check.
 *
 * `component` renders the widget itself, whatever `renderers` says about that widget's type.
 * `renderers` only decides how the widgets inside its slots render (through `WidgetSlot`, nested to any
 * depth): a mapped plugin type renders with its component, any other type renders as nothing.
 *
 * The Runtime is validated like the root renderer's `runtime` prop (`invalid-runtime`,
 * `foreign-runtime`), and an unknown `widgetId` throws `unknown-widget`; all are
 * `WidgetVueIntegrationError`s. The caller keeps ownership of the Runtime: nothing here disposes it.
 */
export function createWidgetTestHost<Plugins extends AnyWidgetPluginTuple>(
	runtime: WidgetSystemRuntime<Plugins>,
	widgetId: string,
	component: Component,
	renderers: WidgetTestRenderers<Plugins> = {},
): Component {
	assertWidgetRuntime(runtime)

	const widget = runtime.getWidget(widgetId) as RuntimeWidgetLike | null
	if (widget === null) {
		throw new WidgetVueIntegrationError(
			'unknown-widget',
			`createWidgetTestHost() was given widget id "${widgetId}", which the Runtime does not contain.`,
		)
	}

	const rendererByType = new Map<string, Component>()
	for (const plugin of runtime.blueprint.system.plugins)
		rendererByType.set(plugin.type, RendersNothing)
	for (const [type, renderer] of Object.entries(renderers)) {
		if (rendererByType.has(type) && renderer !== undefined)
			rendererByType.set(type, renderer as Component)
	}

	return defineComponent({
		name: 'WidgetTestHost',
		setup() {
			provideCurrentWidgetContext(widget, runtime, rendererByType)
			return () => h(component)
		},
	})
}
