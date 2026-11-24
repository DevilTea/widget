// @vitest-environment happy-dom
/**
 * Diagnostics carry `details` (0.3). The diagnostics surfaces expose them typed by `reason` when the plugin
 * declares `Interfaces['reasons']`, and keep Core's `reason?: string` / `details?: JsonValue` when it does not.
 * The run-time half pins that the surface hands out the Runtime's own diagnostic objects, `details` by reference.
 */

import type { JsonValue, RuntimeMethodDiagnostic, RuntimePropertyDiagnostic, RuntimeStateDiagnostic, RuntimeWidgetDiagnostic, WidgetInterfaces } from '@deviltea/widget-core'
import type { CounterPlugin } from './test-fixtures'
import type { ReadonlyRef, ReasonedDiagnostic, UseWidgetResult } from './types'
import { createWidgetPlugin, createWidgetSystem, undocumented } from '@deviltea/widget-core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { nextTick } from 'vue'
import { mountWidgetBridge } from './test-fixtures'

interface GaugeInterfaces extends WidgetInterfaces {
	state: { level: number }
	properties: { percent: number }
	methods: { setLevel: (level: number) => number }
	reasons: {
		'not-a-number': void
		'too-large': { max: number, received: number }
	}
}

const GaugePlugin = createWidgetPlugin('Gauge')
	.description(undocumented)
	.interfaces<GaugeInterfaces>()
	.state(state => state.level({
		description: undocumented,
		validate: (input, ctx): input is number => {
			if (typeof input !== 'number') {
				ctx.addDiagnostic({ message: 'The level must be a number.', reason: 'not-a-number' })
				return false
			}
			if (input > 100) {
				ctx.addDiagnostic({ message: 'The level is too large.', reason: 'too-large', details: { max: 100, received: input } })
				return false
			}
			return true
		},
		default: () => 0,
	}))
	.properties(properties => properties.percent({
		description: undocumented,
		compute: ({ addDiagnostic }) => {
			addDiagnostic({ message: 'The percentage is out of range.', reason: 'too-large', details: { max: 100, received: 250 } })
			return 0
		},
	}))
	.methods(methods => methods.setLevel({
		description: undocumented,
		validateArgs: (args, ctx): args is [number] => {
			if (args.length === 1 && typeof args[0] === 'number')
				return true
			ctx.addDiagnostic({ message: 'setLevel takes one number.', reason: 'not-a-number' })
			return false
		},
		execute: ({ args: [level] }) => level,
	}))
	.reasons({ 'not-a-number': undocumented, 'too-large': undocumented })
	.done()

const gaugeSystem = createWidgetSystem({ plugins: [GaugePlugin] as const })

type GaugeResult = UseWidgetResult<typeof GaugePlugin>
type CounterResult = UseWidgetResult<typeof CounterPlugin>

function createGauge(id: string) {
	const blueprint = gaugeSystem.createBlueprint({ id, type: 'Gauge' })
	if (blueprint.status !== 'valid')
		throw new Error(JSON.stringify(blueprint.diagnostics))
	return blueprint.createRuntime()
}

describe('diagnostics `details` typing', () => {
	it('types `reason` and `details` of every surface by the plugin\'s declared reasons', () => {
		type StateDiagnostic = ReturnType<GaugeResult['useStateDiagnostics']>['level']['value'][number]
		type PropertyDiagnostic = ReturnType<GaugeResult['usePropertyDiagnostics']>['percent']['value'][number]
		type MethodDiagnostic = ReturnType<GaugeResult['useMethodDiagnostics']>['setLevel']['value'][number]
		type WidgetDiagnostic = ReturnType<GaugeResult['useDiagnostics']>['value'][number]

		// One own-diagnostic variant per reason (plus one without a reason), discriminated by `reason`.
		type OwnState = Extract<StateDiagnostic, { code: 'invalid-state-value' }>
		expectTypeOf<OwnState['reason']>()
			.toEqualTypeOf<'not-a-number' | 'too-large' | undefined>()
		expectTypeOf<Extract<OwnState, { reason: 'too-large' }>['details']>()
			.toEqualTypeOf<{ max: number, received: number }>()
		expectTypeOf<Extract<OwnState, { reason: 'not-a-number' }>['details']>()
			.toEqualTypeOf<undefined>()
		expectTypeOf<Extract<OwnState, { reason?: undefined }>['details']>()
			.toEqualTypeOf<undefined>()
		// The rest of the Core diagnostic is kept.
		expectTypeOf<OwnState['candidate']>()
			.toEqualTypeOf<unknown>()
		expectTypeOf<OwnState['code']>()
			.toEqualTypeOf<'invalid-state-value'>()

		expectTypeOf<Extract<PropertyDiagnostic, { code: 'invalid-property-result', reason: 'too-large' }>['details']>()
			.toEqualTypeOf<{ max: number, received: number }>()
		expectTypeOf<Extract<MethodDiagnostic, { code: 'invalid-method-arguments', reason: 'too-large' }>['details']>()
			.toEqualTypeOf<{ max: number, received: number }>()
		expectTypeOf<Extract<MethodDiagnostic, { code: 'invalid-method-result', reason: 'not-a-number' }>['details']>()
			.toEqualTypeOf<undefined>()
		expectTypeOf<Extract<WidgetDiagnostic, { code: 'invalid-state-value', reason: 'too-large' }>['details']>()
			.toEqualTypeOf<{ max: number, received: number }>()

		// A reason the plugin did not declare is not a member of the union.
		expectTypeOf<Extract<StateDiagnostic, { reason: 'unknown' }>>()
			.toEqualTypeOf<never>()
	})

	it('narrows `details` by checking `reason`', () => {
		function maxOf(diagnostic: ReturnType<GaugeResult['useStateDiagnostics']>['level']['value'][number]): number | null {
			if (diagnostic.code === 'invalid-state-value' && diagnostic.reason === 'too-large') {
				expectTypeOf(diagnostic.details)
					.toEqualTypeOf<{ max: number, received: number }>()
				return diagnostic.details.max
			}
			return null
		}
		expect(maxOf)
			.toBeTypeOf('function')
	})

	it('leaves dependency diagnostics untouched (they carry no reason)', () => {
		type PropertyDiagnostic = ReturnType<GaugeResult['usePropertyDiagnostics']>['percent']['value'][number]
		expectTypeOf<Extract<PropertyDiagnostic, { code: 'dependency-target-failed' }>>()
			.toEqualTypeOf<Extract<RuntimePropertyDiagnostic, { code: 'dependency-target-failed' }>>()
		type MethodDiagnostic = ReturnType<GaugeResult['useMethodDiagnostics']>['setLevel']['value'][number]
		expectTypeOf<Extract<MethodDiagnostic, { code: 'dependency-value-rejected' }>>()
			.toEqualTypeOf<Extract<RuntimeMethodDiagnostic, { code: 'dependency-value-rejected' }>>()
	})

	it('keeps Core\'s untyped diagnostics when the plugin declares no reasons', () => {
		expectTypeOf<ReturnType<CounterResult['useStateDiagnostics']>['count']>()
			.toEqualTypeOf<ReadonlyRef<readonly RuntimeStateDiagnostic[]>>()
		expectTypeOf<ReturnType<CounterResult['usePropertyDiagnostics']>['doubled']>()
			.toEqualTypeOf<ReadonlyRef<readonly RuntimePropertyDiagnostic[]>>()
		expectTypeOf<ReturnType<CounterResult['useMethodDiagnostics']>['increment']>()
			.toEqualTypeOf<ReadonlyRef<readonly RuntimeMethodDiagnostic[]>>()
		expectTypeOf<ReturnType<CounterResult['useDiagnostics']>>()
			.toEqualTypeOf<ReadonlyRef<readonly RuntimeWidgetDiagnostic[]>>()

		type CounterStateDiagnostic = ReturnType<CounterResult['useStateDiagnostics']>['count']['value'][number]
		expectTypeOf<CounterStateDiagnostic['reason']>()
			.toEqualTypeOf<string | undefined>()
		expectTypeOf<CounterStateDiagnostic['details']>()
			.toEqualTypeOf<JsonValue | undefined>()
	})

	it('maps a `ReasonedDiagnostic` over the Core diagnostic unions', () => {
		expectTypeOf<ReasonedDiagnostic<RuntimeStateDiagnostic, GaugeInterfaces>['details']>()
			.toEqualTypeOf<{ max: number, received: number } | undefined>()
		expectTypeOf<ReasonedDiagnostic<RuntimeStateDiagnostic, WidgetInterfaces>>()
			.toEqualTypeOf<RuntimeStateDiagnostic>()
	})
})

describe('diagnostics `details` at run time', () => {
	it('hands out the Runtime\'s diagnostic objects with `reason` and `details` by reference', async () => {
		const runtime = createGauge('g1')
		const { bridge } = mountWidgetBridge(runtime, 'g1', GaugePlugin)
		const { level } = bridge.useState()
		const { level: levelDiagnostics } = bridge.useStateDiagnostics()

		level.value = 250
		await nextTick()

		expect(levelDiagnostics.value)
			.toHaveLength(1)
		const [diagnostic] = levelDiagnostics.value
		expect(diagnostic)
			.toMatchObject({ code: 'invalid-state-value', reason: 'too-large', details: { max: 100, received: 250 } })

		const widget = runtime.getWidget('g1')!
		expect(bridge.useDiagnostics().value[0])
			.toBe(widget.getDiagnostics()[0])
		expect(diagnostic)
			.toBe(bridge.useDiagnostics().value[0])
	})

	it('carries `details` of a Property and a Method diagnostic', () => {
		const runtime = createGauge('g2')
		const { bridge } = mountWidgetBridge(runtime, 'g2', GaugePlugin)

		expect(bridge.useProperties().percent.value)
			.toBeNull()
		expect(bridge.usePropertyDiagnostics().percent.value[0])
			.toMatchObject({ code: 'invalid-property-result', reason: 'too-large', details: { max: 100, received: 250 } })

		expect((bridge.useMethods().setLevel as (...args: unknown[]) => unknown)('x'))
			.toBeNull()
		const methodDiagnostic = bridge.useMethodDiagnostics().setLevel.value[0]!
		if (methodDiagnostic.code !== 'invalid-method-arguments')
			throw new Error(`unexpected diagnostic ${methodDiagnostic.code}`)
		expect(methodDiagnostic.reason)
			.toBe('not-a-number')
		expect(methodDiagnostic.details)
			.toBeUndefined()
	})
})
