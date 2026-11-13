/**
 * Every callback context of a widget with the config capability carries the widget's resolved `config`
 * (the same object as its Blueprint node's), and a widget without it carries no `config` key at all.
 */

import type { WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface ConfiguredInterfaces extends WidgetInterfaces {
	config: { raw: { factor: number }, resolved: { factor: number } }
	state: { value: number }
	properties: { scaled: number }
	methods: { scale: (amount: number) => number }
}

interface BareInterfaces extends WidgetInterfaces {
	state: { value: number }
	properties: { scaled: number }
	methods: { scale: (amount: number) => number }
}

const seen: Record<string, unknown[]> = {}
function record(site: string, ctx: unknown): void {
	;(seen[site] ??= []).push(typeof ctx === 'object' && ctx !== null && 'config' in ctx ? ctx.config : 'no config key')
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

const configured = createWidgetPlugin('configured')
	.description('Test widget')
	.interfaces<ConfiguredInterfaces>()
	.config({
		description: 'Test config',
		validate: (input): input is { factor: number } => typeof input === 'object' && input !== null,
		resolve: raw => raw ?? { factor: 1 },
	})
	.state(state => state.value({
		validate: (input, ctx): input is number => {
			record('configured.validate', ctx)
			return isNumber(input)
		},
		default: (ctx) => {
			record('configured.default', ctx)
			return 1
		},
	}))
	.properties(properties => properties.scaled({
		compute: (ctx) => {
			record('configured.compute', ctx)
			return ctx.config.factor
		},
	}))
	.methods(methods => methods.scale({
		validateArgs: (args, ctx): args is [number] => {
			record('configured.validateArgs', ctx)
			return args.length === 1
		},
		execute: (ctx) => {
			record('configured.execute', ctx)
			return ctx.config.factor * ctx.args[0]
		},
	}))
	.done()

const bare = createWidgetPlugin('bare')
	.description('Test widget')
	.interfaces<BareInterfaces>()
	.state(state => state.value({
		validate: (input, ctx): input is number => {
			record('bare.validate', ctx)
			return isNumber(input)
		},
		default: (ctx) => {
			record('bare.default', ctx)
			return 1
		},
	}))
	.properties(properties => properties.scaled({
		compute: (ctx) => {
			record('bare.compute', ctx)
			return 1
		},
	}))
	.methods(methods => methods.scale({
		validateArgs: (args, ctx): args is [number] => {
			record('bare.validateArgs', ctx)
			return args.length === 1
		},
		execute: (ctx) => {
			record('bare.execute', ctx)
			return ctx.args[0]
		},
	}))
	.done()

const system = createWidgetSystem({ plugins: [configured, bare] })

describe('callback contexts and widget config', () => {
	it('hands the node\'s resolved config to every callback of a widget with config, and none to one without', () => {
		const compiled = system.createBlueprint({ id: 'a', type: 'configured', config: { factor: 3 } })
		if (compiled.status !== 'valid')
			throw new Error('fixture setup error: expected a valid Blueprint')
		const bareCompiled = system.createBlueprint({ id: 'b', type: 'bare' })
		if (bareCompiled.status !== 'valid')
			throw new Error('fixture setup error: expected a valid Blueprint')
		const config = (compiled.getWidget('a') as { config?: unknown } | null)?.config
		expect(config)
			.toStrictEqual({ factor: 3 })

		for (const key of Object.keys(seen))
			delete seen[key]
		const runtime = compiled.createRuntime()
		const widget = runtime.getWidget('a')!
		widget.state.value.set(5)
		widget.properties.scaled.get()
		widget.methods.scale(2)
		const bareRuntime = bareCompiled.createRuntime()
		const bareWidget = bareRuntime.getWidget('b')!
		bareWidget.state.value.set(5)
		bareWidget.properties.scaled.get()
		bareWidget.methods.scale(2)

		for (const site of ['validate', 'default', 'compute', 'validateArgs', 'execute']) {
			expect(seen[`configured.${site}`]?.length)
				.toBeGreaterThan(0)
			for (const received of seen[`configured.${site}`]!) {
				expect(received)
					.toBe(config)
			}
			expect(seen[`bare.${site}`]?.length)
				.toBeGreaterThan(0)
			for (const received of seen[`bare.${site}`]!) {
				expect(received)
					.toBe('no config key')
			}
		}
		expect(widget.methods.scale(2))
			.toEqual({ ok: true, value: 6 })
	})
})
