// @vitest-environment happy-dom
/**
 * `useWidget(Plugin).config` — the widget's resolved config, present exactly when the plugin
 * declares the `config` capability (read from `plugin.capabilities`, typed through
 * `HasWidgetCapability`), the very object the Runtime widget's Blueprint node holds: not reactive,
 * not cloned, typed read-only.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { UseWidgetResult } from './types'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { isReactive } from 'vue'
import { BarePlugin, CounterPlugin, createCapabilityFixtureRuntime, createFixtureRuntime, mountWidgetBridge } from './test-fixtures'

interface ConfiguredInterfaces extends WidgetInterfaces {
	config: {
		raw: { title: string, tags: string[] } | null
		resolved: { title: string, tags: string[], nested: { depth: number } }
	}
}

const ConfiguredPlugin = createWidgetPlugin('Configured')
	.description('Configured widget')
	.interfaces<ConfiguredInterfaces>()
	.config({
		description: 'Title and tags',
		validate: (input): input is ConfiguredInterfaces['config']['raw'] => input === null || (typeof input === 'object' && 'title' in input),
		resolve: raw => ({ title: raw?.title ?? 'untitled', tags: raw?.tags ?? [], nested: { depth: 1 } }),
	})
	.done()

const configuredSystem = createWidgetSystem({ plugins: [ConfiguredPlugin] as const })

function createConfiguredRuntime(config: unknown) {
	const blueprint = configuredSystem.createBlueprint({ id: 'root', type: 'Configured', config })
	if (blueprint.status !== 'valid')
		throw new Error(`Invalid fixture blueprint: ${JSON.stringify(blueprint.diagnostics)}`)
	return blueprint.createRuntime()
}

describe('useWidget() config', () => {
	it('exposes the resolved config of the current widget', () => {
		const runtime = createConfiguredRuntime({ title: 'Hello', tags: ['a', 'b'] })
		const { bridge } = mountWidgetBridge(runtime, 'root', ConfiguredPlugin)

		expect(bridge.config)
			.toEqual({ title: 'Hello', tags: ['a', 'b'], nested: { depth: 1 } })
	})

	it('exposes the resolved default when the raw config is omitted', () => {
		const runtime = createConfiguredRuntime(null)
		const { bridge } = mountWidgetBridge(runtime, 'root', ConfiguredPlugin)

		expect(bridge.config)
			.toEqual({ title: 'untitled', tags: [], nested: { depth: 1 } })
	})

	it('is the very object the Runtime widget holds: not cloned, not reactive, stable across useWidget() calls', () => {
		const runtime = createConfiguredRuntime({ title: 'Hello', tags: [] })
		const { bridge } = mountWidgetBridge(runtime, 'root', ConfiguredPlugin)
		const widget = runtime.getWidget('root')!

		expect(bridge.config)
			.toBe(widget.blueprintNode.config)
		expect(bridge.config.nested)
			.toBe(widget.blueprintNode.config.nested)
		expect(isReactive(bridge.config))
			.toBe(false)

		const second = mountWidgetBridge(runtime, 'root', ConfiguredPlugin)
		expect(second.bridge.config)
			.toBe(bridge.config)
	})

	it('is absent at runtime when the plugin declares no config capability', () => {
		const counter = mountWidgetBridge(createFixtureRuntime({ id: 'w', type: 'Counter' }), 'w', CounterPlugin)
		expect('config' in counter.bridge)
			.toBe(false)

		const bare = mountWidgetBridge(createCapabilityFixtureRuntime({ id: 'w', type: 'Bare' }), 'w', BarePlugin)
		expect('config' in bare.bridge)
			.toBe(false)
	})

	it('is typed present exactly when config is declared, and typed read-only', () => {
		type Configured = UseWidgetResult<typeof ConfiguredPlugin>
		expectTypeOf<Configured>()
			.toHaveProperty('config')
		expectTypeOf<Configured['config']>()
			.toEqualTypeOf<{
			readonly title: string
			readonly tags: readonly string[]
			readonly nested: { readonly depth: number }
		}>()

		expectTypeOf<UseWidgetResult<typeof CounterPlugin>>().not.toHaveProperty('config')
		expectTypeOf<UseWidgetResult<typeof BarePlugin>>().not.toHaveProperty('config')

		const runtime = createConfiguredRuntime(null)
		const { bridge } = mountWidgetBridge(runtime, 'root', ConfiguredPlugin)
		// @ts-expect-error resolved config is read-only for renderers
		bridge.config.title = 'changed'
		// @ts-expect-error nested values are read-only too
		bridge.config.nested.depth = 2
		// @ts-expect-error arrays are read-only
		bridge.config.tags.push('x')
	})
})
