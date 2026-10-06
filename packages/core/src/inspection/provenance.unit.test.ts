/**
 * Foreign-instance and forged inputs to the inspection entries fail with coded WidgetInspectionError.
 */

import { describe, expect, it, vi } from 'vitest'
import * as core from '../index'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import * as InspectionModule from './index'
import { inspectBlueprint, inspectPlugin, inspectRuntime, WidgetInspectionError } from './index'

function build(api: typeof core) {
	const plugin = api.createWidgetPlugin('plain')
		.description('Plain')
		.interfaces<Record<never, never>>()
		.done()
	const system = api.createWidgetSystem({ plugins: [plugin] as const })
	const blueprint = system.createBlueprint({ id: 'root', type: 'plain' })
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid blueprint')
	return { plugin, blueprint, runtime: blueprint.createRuntime() }
}

function codeOf(run: () => unknown): unknown {
	try {
		run()
	}
	catch (error) {
		expect(error)
			.toBeInstanceOf(WidgetInspectionError)
		return (error as WidgetInspectionError).code
	}
	return undefined
}

describe('inspection provenance errors', () => {
	it('exports WidgetInspectionError from the inspection subpath only', () => {
		expect(typeof InspectionModule.WidgetInspectionError)
			.toBe('function')
		expect('WidgetInspectionError' in core)
			.toBe(false)
	})

	it('rejects objects produced by another module instance', async () => {
		vi.resetModules()
		const foreignCore = await import('../index')
		const foreign = build(foreignCore)

		expect(codeOf(() => inspectPlugin(foreign.plugin as never)))
			.toBe('foreign-plugin')
		expect(codeOf(() => inspectBlueprint(foreign.blueprint as never)))
			.toBe('foreign-blueprint')
		expect(codeOf(() => inspectRuntime(foreign.runtime as never)))
			.toBe('foreign-runtime')
	})

	it('rejects structural look-alikes and non-objects', () => {
		const local = build(core)

		expect(codeOf(() => inspectPlugin({ type: 'plain', capabilities: {} } as never)))
			.toBe('foreign-plugin')
		expect(codeOf(() => inspectPlugin(null as never)))
			.toBe('foreign-plugin')
		expect(codeOf(() => inspectBlueprint({ status: local.blueprint.status, system: local.blueprint.system } as never)))
			.toBe('foreign-blueprint')
		expect(codeOf(() => inspectBlueprint(undefined as never)))
			.toBe('foreign-blueprint')
		expect(codeOf(() => inspectRuntime({ blueprint: local.blueprint, getWidget: local.runtime.getWidget } as never)))
			.toBe('foreign-runtime')
		expect(codeOf(() => inspectRuntime(local.blueprint as never)))
			.toBe('foreign-runtime')
	})

	it('still inspects genuine objects, including after disposal', () => {
		const plugin = createWidgetPlugin('p')
			.description('P')
			.interfaces<Record<never, never>>()
			.done()
		const blueprint = createWidgetSystem({ plugins: [plugin] as const })
			.createBlueprint({ id: 'root', type: 'p' })
		if (blueprint.status !== 'valid')
			throw new Error('Expected valid blueprint')
		const runtime = blueprint.createRuntime()
		runtime.dispose()

		expect(() => inspectPlugin(plugin))
			.not.toThrow()
		expect(() => inspectBlueprint(blueprint))
			.not.toThrow()
		expect(() => inspectRuntime(runtime))
			.not.toThrow()
	})
})
