/**
 * Conformance coverage for callback-context lifetime: a callback's `addDiagnostic` /
 * `hasAnyDiagnostic` may only be used while that callback runs. A later call (for example from a
 * retained context or deferred code) throws instead of writing into an already-final operation.
 */

import type { DiagnosticCollector } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'

type Retained = Partial<Record<'config' | 'slot' | 'plugin' | 'system' | 'state' | 'compute' | 'validateArgs' | 'execute', DiagnosticCollector<never>>>
const retained: Retained = {}

interface ProbeInterfaces {
	config: {
		raw: { readonly ok: boolean }
		resolved: { readonly ok: boolean }
	}
	slots: 'items'
	state: { value: number }
	properties: { doubled: number }
	methods: { run: () => number }
}

const probePlugin = createWidgetPlugin('probe')
	.description('Test widget')
	.interfaces<ProbeInterfaces>()
	.config({
		description: 'Test config',
		validate: (input, ctx): input is { ok: boolean } => {
			retained.config = ctx as DiagnosticCollector<never>
			return typeof input === 'object' && input !== null
		},
		resolve: raw => ({ ok: raw?.ok ?? false }),
	})
	.slots(
		{
			items: {
				description: 'Test slot',
				validateStructure: (ctx) => {
					retained.slot = ctx as DiagnosticCollector<never>
				},
			},
		},
		(ctx) => {
			retained.plugin = ctx as DiagnosticCollector<never>
		},
	)
	.state(state => state.value({
		validate: (input, ctx): input is number => {
			retained.state = ctx as DiagnosticCollector<never>
			return typeof input === 'number'
		},
		default: () => 1,
	}))
	.properties(properties => properties.doubled({
		registerDeps: ({ dep }) => ({ value: dep.self.state.get('value') }),
		compute: (ctx) => {
			retained.compute = ctx as unknown as DiagnosticCollector<never>
			const value = ctx.deps.value()
			return value.ok ? (value.value ?? 0) * 2 : 0
		},
	}))
	.methods(methods => methods.run({
		validateArgs: (args, ctx): args is [] => {
			retained.validateArgs = ctx as DiagnosticCollector<never>
			return args.length === 0
		},
		execute: (ctx) => {
			retained.execute = ctx as unknown as DiagnosticCollector<never>
			return 1
		},
	}))
	.done()

const system = createWidgetSystem({
	plugins: [probePlugin],
	validateStructure: (ctx) => {
		retained.system = ctx as unknown as DiagnosticCollector<never>
	},
})

function exercise(): void {
	const blueprint = system.createBlueprint({ id: 'root', type: 'probe', config: { ok: true } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const widget = blueprint.createRuntime()
		.getWidget('root')!
	widget.state.value.set(2)
	widget.properties.doubled.get()
	widget.methods.run()
}

describe('callback-context lifetime', () => {
	exercise()

	for (const callback of ['config', 'slot', 'plugin', 'system', 'state', 'compute', 'validateArgs', 'execute'] as const) {
		it(`${callback}: addDiagnostic and hasAnyDiagnostic throw after the callback returned`, () => {
			const ctx = retained[callback]
			if (ctx === undefined)
				throw new Error(`fixture error: ${callback} context was not retained`)

			expect(() => ctx.addDiagnostic({ message: 'late' } as never))
				.toThrow(TypeError)
			expect(() => ctx.hasAnyDiagnostic())
				.toThrow(TypeError)
		})
	}

	it('a late call cannot change the completed operation', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'probe', config: { ok: true } })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const widget = blueprint.createRuntime()
			.getWidget('root')!
		widget.properties.doubled.get()

		expect(() => retained.compute!.addDiagnostic({ message: 'late' } as never))
			.toThrow(TypeError)
		expect(widget.properties.doubled.getDiagnostics())
			.toEqual([])
		expect(blueprint.diagnostics)
			.toEqual([])
	})
})
