// @vitest-environment happy-dom
/**
 * Conformance tests — issue #13 checkpoint amendment "`useWidget()` may expose readonly local widget
 * identity". Pins the amendment's four required conformance points:
 *
 * 1. `widgetId` equals the current Runtime widget instance id;
 * 2. `widgetType` equals the current Runtime widget type and retains the exact `Plugin['type']`
 *    TypeScript type;
 * 3. identity is available regardless of optional widget capabilities;
 * 4. the existing exact-plugin runtime assertion remains authoritative (this amendment must not
 *    weaken it).
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { UseWidgetResult } from './types'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { WidgetVueIntegrationError } from './errors'
import {
	BarePlugin,
	CounterPlugin,
	createCapabilityFixtureRuntime,
	createFixtureRuntime,
	LabelPlugin,
	mountWidgetBridge,
} from './test-fixtures'

describe('useWidget() identity — widgetId / widgetType', () => {
	it('widgetId equals the current Runtime widget instance id', () => {
		const runtime = createFixtureRuntime({ id: 'counter-1', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'counter-1', CounterPlugin)

		expect(bridge.widgetId)
			.toBe('counter-1')
		expect(bridge.widgetId)
			.toBe(runtime.getWidget('counter-1')!.id)
	})

	it('widgetType equals the current Runtime widget type', () => {
		const runtime = createFixtureRuntime({ id: 'label-1', type: 'Label' })
		const { bridge } = mountWidgetBridge(runtime, 'label-1', LabelPlugin)

		expect(bridge.widgetType)
			.toBe('Label')
		expect(bridge.widgetType)
			.toBe(runtime.getWidget('label-1')!.type)
	})

	it('widgetId/widgetType are plain readonly values, not refs', () => {
		const runtime = createFixtureRuntime({ id: 'counter-2', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'counter-2', CounterPlugin)

		expect(bridge.widgetId)
			.toBeTypeOf('string')
		expect(bridge.widgetType)
			.toBeTypeOf('string')
		// A `Ref`/`customRef` value would be an object with a `.value` accessor, not a bare primitive.
		expect(bridge).not.toHaveProperty('widgetId.value')
	})

	it('retains the exact `Plugin["type"]` TypeScript type, not a widened `string`', () => {
		type CounterResult = UseWidgetResult<typeof CounterPlugin>
		type LabelResult = UseWidgetResult<typeof LabelPlugin>

		expectTypeOf<CounterResult['widgetType']>()
			.toEqualTypeOf<'Counter'>()
		expectTypeOf<CounterResult['widgetType']>()
			.not.toEqualTypeOf<string>()
		expectTypeOf<CounterResult['widgetId']>()
			.toEqualTypeOf<string>()
		expectTypeOf<LabelResult['widgetType']>()
			.toEqualTypeOf<'Label'>()
	})

	it('identity is present regardless of declared capabilities (a plugin with zero capabilities)', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'bare-1', type: 'Bare' })
		const { bridge } = mountWidgetBridge(runtime, 'bare-1', BarePlugin)

		expect(bridge.widgetId)
			.toBe('bare-1')
		expect(bridge.widgetType)
			.toBe('Bare')
	})

	it('identity is present alongside every other declared capability (state + properties + methods)', () => {
		const runtime = createFixtureRuntime({ id: 'counter-3', type: 'Counter' })
		const { bridge } = mountWidgetBridge(runtime, 'counter-3', CounterPlugin)

		expect(bridge.widgetId)
			.toBe('counter-3')
		expect(bridge.widgetType)
			.toBe('Counter')
		expect(bridge.useState)
			.toBeTypeOf('function')
		expect(bridge.useProperties)
			.toBeTypeOf('function')
		expect(bridge.useMethods)
			.toBeTypeOf('function')
	})

	it('does not weaken the exact-plugin runtime assertion: a different plugin instance with the same type string still throws', () => {
		// `assertWidgetMatchesPlugin` (`use-widget.ts`) rejects by plugin object identity
		// (`widget.blueprint.plugin !== plugin`), not by matching `type` strings — this is the narrow edge
		// case its own error message calls out ("a different plugin instance, even if the type string
		// matched"), otherwise uncovered elsewhere in the suite. Widget identity must only ever be read
		// after this assertion has already succeeded, so a rejection here proves this amendment added no
		// bypass around it.
		const impostorCounterPlugin = createWidgetPlugin('Counter')
			.interfaces<WidgetInterfaces>()
			.done()
		const runtime = createFixtureRuntime({ id: 'counter-4', type: 'Counter' })

		expect(() => mountWidgetBridge(runtime, 'counter-4', impostorCounterPlugin))
			.toThrow(WidgetVueIntegrationError)
		expect(() => mountWidgetBridge(runtime, 'counter-4', impostorCounterPlugin))
			.toThrow(/different plugin instance, even if the type string matched/)
	})
})
