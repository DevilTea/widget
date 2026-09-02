/**
 * Conformance coverage for diagnostic #10 COMMENT 26 §7 (Runtime initialization) — the state
 * override/default/null precedence rules, plus consolidated handoff §11 and amendments COMMENT 15/21.
 *
 * Scope: state initialization precedence and its validation-vs-fallback edges. `overrideStateDefaults`
 * best-effort recovery granularity is covered by `override.unit.test.ts`.
 */

import type { ValidWidgetSystemBlueprint } from '../index'
import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface CounterInterfaces {
	state: {
		count: number
	}
}

interface ConfiguredInterfaces {
	config: {
		raw: { multiplier: number }
		resolved: { multiplier: number }
	}
	state: {
		count: number
	}
}

function createCounterBlueprint(params: {
	validate: (input: unknown) => boolean
	default?: (ctx: unknown) => unknown
}): ValidWidgetSystemBlueprint {
	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<CounterInterfaces>()
		.state(section => section.count({
			validate: (input): input is number => params.validate(input),
			...(params.default === undefined ? {} : { default: params.default as (ctx: unknown) => number }),
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })

	if (blueprint.status !== 'valid')
		throw new Error('expected a valid blueprint')

	return blueprint as unknown as ValidWidgetSystemBlueprint
}

function isFiniteNumber(input: unknown): input is number {
	return typeof input === 'number'
}

describe('runtime initialization — state precedence (diagnostic #10 §7 / §11, COMMENT 15/21)', () => {
	it('uses the explicit override when both an override and a default are present', () => {
		const defaultFn = vi.fn(() => 1)
		const blueprint = createCounterBlueprint({ validate: isFiniteNumber, default: defaultFn })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 42 } } })
		const widget = runtime.getWidget('root') as any

		expect(widget.state.count.get())
			.toBe(42)
		expect(defaultFn).not.toHaveBeenCalled()
	})

	it('falls back to the plugin default when no override is supplied', () => {
		const defaultFn = vi.fn(() => 7)
		const blueprint = createCounterBlueprint({ validate: isFiniteNumber, default: defaultFn })

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root') as any

		expect(widget.state.count.get())
			.toBe(7)
		expect(defaultFn)
			.toHaveBeenCalledTimes(1)
	})

	it('initializes to null when neither an override nor a default is present', () => {
		const blueprint = createCounterBlueprint({ validate: isFiniteNumber })

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root') as any

		expect(widget.state.count.get())
			.toBeNull()
		expect(widget.state.count.getDiagnostics())
			.toHaveLength(0)
	})

	it('treats an own-property `undefined` override candidate as explicit (it reaches validate)', () => {
		const blueprint = createCounterBlueprint({ validate: isFiniteNumber })

		// Own-property `undefined`: the key exists on the fragment, so it must be validated and rejected
		// (validate only accepts numbers) rather than being treated as "no candidate".
		const withUndefinedOwnProperty = blueprint.createRuntime({ overrideStateDefaults: { root: { count: undefined } } })
		const widgetA = withUndefinedOwnProperty.getWidget('root') as any

		expect(widgetA.state.count.get())
			.toBeNull()
		expect(widgetA.state.count.getDiagnostics())
			.toHaveLength(1)
		expect(widgetA.state.count.getDiagnostics()[0])
			.toMatchObject({ code: 'invalid-state-value', location: { type: 'state', widgetId: 'root', key: 'count' }, candidate: undefined })

		// Contrast: the key is genuinely absent from the fragment, so there is no explicit candidate at
		// all and (with no default declared) initialization silently stays null with no diagnostic.
		const withAbsentKey = blueprint.createRuntime({ overrideStateDefaults: { root: {} } })
		const widgetB = withAbsentKey.getWidget('root') as any

		expect(widgetB.state.count.get())
			.toBeNull()
		expect(widgetB.state.count.getDiagnostics())
			.toHaveLength(0)
	})

	it('regression: an invalid explicit override never falls back to the default', () => {
		const defaultFn = vi.fn(() => 99)
		const blueprint = createCounterBlueprint({ validate: isFiniteNumber, default: defaultFn })

		const runtime = blueprint.createRuntime({ overrideStateDefaults: { root: { count: 'not-a-number' } } })
		const widget = runtime.getWidget('root') as any

		expect(widget.state.count.get())
			.toBeNull()
		expect(defaultFn).not.toHaveBeenCalled()

		const diagnostics = widget.state.count.getDiagnostics()
		expect(diagnostics)
			.toHaveLength(1)
		expect(diagnostics[0])
			.toMatchObject({ code: 'invalid-state-value', location: { type: 'state', widgetId: 'root', key: 'count' }, candidate: 'not-a-number' })
	})

	it('an invalid default initializes to null with a state-validation diagnostic', () => {
		const validatePositive = (input: unknown): input is number => typeof input === 'number' && input > 0
		const blueprint = createCounterBlueprint({ validate: validatePositive, default: () => -1 })

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root') as any

		expect(widget.state.count.get())
			.toBeNull()

		const diagnostics = widget.state.count.getDiagnostics()
		expect(diagnostics)
			.toHaveLength(1)
		expect(diagnostics[0])
			.toMatchObject({ code: 'invalid-state-value', location: { type: 'state', widgetId: 'root', key: 'count' }, candidate: -1 })
	})

	it('the default callback receives the resolved config, not the raw config', () => {
		let capturedConfig: unknown
		const plugin = createWidgetPlugin('configured')
			.description('Test widget')
			.interfaces<ConfiguredInterfaces>()
			.config({
				description: 'Test config',
				validate: (input): input is { multiplier: number } => typeof input === 'object' && input !== null && typeof (input as any).multiplier === 'number',
				resolve: raw => raw === null ? { multiplier: 1 } : raw,
			})
			.state(section => section.count({
				validate: (input): input is number => typeof input === 'number',
				default: (ctx: any) => {
					capturedConfig = ctx.config
					return ctx.config.multiplier * 10
				},
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'configured', config: { multiplier: 7 } })

		if (blueprint.status !== 'valid')
			throw new Error('expected a valid blueprint')

		const node = blueprint.getWidget('root')!
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root') as any

		expect(capturedConfig)
			.toBe(node.config)
		expect(capturedConfig)
			.toStrictEqual({ multiplier: 7 })
		expect(widget.state.count.get())
			.toBe(70)
	})
})
