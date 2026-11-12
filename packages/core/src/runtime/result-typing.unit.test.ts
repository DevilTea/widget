/**
 * Public type behavior of Property and Method success values: a completed Property result and a
 * successful Method invocation carry exactly what `compute` / `execute` returned, so their ok value is
 * typed `T`, never `T | null`. `null` stays only where it is real: `RuntimeState.get()` (an uninitialized
 * member) and dependency reads of an optional target (an absent target reads as `null`).
 */

import type {
	ExecutionResult,
	RuntimeDiagnostic,
	RuntimeLevelDiagnostic,
	RuntimeMethodDependencyDiagnostic,
	RuntimeMethodDiagnostic,
	RuntimePropertyDependencyDiagnostic,
	RuntimePropertyDiagnostic,
	RuntimeWidgetDiagnostic,
} from '../index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface TypedInterfaces {
	state: {
		count: number
	}
	properties: {
		total: number
		label: string
	}
	methods: {
		run: (factor: number) => string
		probe: () => number
	}
}

const plugin = createWidgetPlugin('typed')
	.description('Test widget')
	.interfaces<TypedInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
		default: () => 2,
	}))
	.properties(properties => properties
		.total({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps }) => {
				const count = deps.count()
				expectTypeOf(count)
					.toEqualTypeOf<ExecutionResult<number | null, RuntimePropertyDependencyDiagnostic>>()
				return count.ok ? (count.value ?? 0) * 10 : 0
			},
		})
		.label({
			registerDeps: ({ dep }) => ({
				total: dep.self.properties.get('total'),
				probe: dep.self.methods.invoke('probe'),
				elsewhere: dep.widget('elsewhere')
					.optional().properties.get('total')
					.validate((value): value is number => typeof value === 'number'),
			}),
			compute: ({ deps }) => {
				const total = deps.total()
				const probe = deps.probe()
				const elsewhere = deps.elsewhere()
				expectTypeOf(total)
					.toEqualTypeOf<ExecutionResult<number, RuntimePropertyDependencyDiagnostic>>()
				expectTypeOf(probe)
					.toEqualTypeOf<ExecutionResult<number, RuntimePropertyDependencyDiagnostic>>()
				expectTypeOf(elsewhere)
					.toEqualTypeOf<ExecutionResult<number | null, RuntimePropertyDependencyDiagnostic>>()
				return `${total.ok ? total.value.toFixed(0) : '?'}/${probe.ok ? probe.value : '?'}/${elsewhere.ok ? elsewhere.value : '?'}`
			},
		}))
	.methods(methods => methods
		.run({
			registerDeps: ({ dep }) => ({ probe: dep.self.methods.invoke('probe') }),
			validateArgs: (args): args is [number] => typeof args[0] === 'number',
			execute: ({ args: [factor], deps }) => {
				const probe = deps.probe()
				expectTypeOf(probe)
					.toEqualTypeOf<ExecutionResult<number, RuntimeMethodDependencyDiagnostic>>()
				return probe.ok ? `${probe.value * factor}` : 'failed'
			},
		})
		.probe({
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => 7,
		}))
	.done()

function createWidget() {
	const blueprint = createWidgetSystem({ plugins: [plugin] })
		.createBlueprint({ id: 'typed', type: 'typed' })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	return blueprint.createRuntime()
		.getWidget('typed')!
}

describe('property and method success values are typed exactly', () => {
	it('types RuntimeProperty.get() and its subscription without a spurious null', () => {
		const widget = createWidget()
		const result = widget.properties.total.get()

		expectTypeOf(result)
			.toEqualTypeOf<ExecutionResult<number, RuntimePropertyDiagnostic>>()
		expectTypeOf(widget.properties.total.subscribe)
			.parameter(0)
			.toEqualTypeOf<(result: ExecutionResult<number, RuntimePropertyDiagnostic>) => void>()
		expect(result)
			.toEqual({ ok: true, value: 20 })
		expect(widget.properties.label.get())
			.toEqual({ ok: true, value: '20/7/null' })
	})

	it('types a RuntimeMethod invocation without a spurious null', () => {
		const widget = createWidget()
		const result = widget.methods.run(3)

		expectTypeOf(result)
			.toEqualTypeOf<ExecutionResult<string, RuntimeMethodDiagnostic>>()
		expect(result)
			.toEqual({ ok: true, value: '21' })
	})

	it('keeps null on RuntimeState.get()', () => {
		const widget = createWidget()

		expectTypeOf(widget.state.count.get())
			.toEqualTypeOf<number | null>()
	})
})

describe('runtime diagnostic unions', () => {
	it('types RuntimeDiagnostic as the complete union and RuntimeWidgetDiagnostic as the widget-only one', () => {
		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'typed', type: 'typed' })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('typed')!

		expectTypeOf<RuntimeLevelDiagnostic>()
			.toExtend<RuntimeDiagnostic>()
		expectTypeOf<RuntimeLevelDiagnostic>()
			.not
			.toExtend<RuntimeWidgetDiagnostic>()
		expectTypeOf<RuntimeWidgetDiagnostic>()
			.toExtend<RuntimeDiagnostic>()
		expectTypeOf(runtime.getDiagnostics)
			.returns
			.toEqualTypeOf<readonly RuntimeDiagnostic[]>()
		expectTypeOf(widget.getDiagnostics)
			.returns
			.toEqualTypeOf<readonly RuntimeWidgetDiagnostic[]>()
	})
})
