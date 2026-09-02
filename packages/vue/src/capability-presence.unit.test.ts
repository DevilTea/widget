// @vitest-environment happy-dom
/**
 * Conformance tests — diagnostic #10 amendment "declaration-presence semantics and public
 * `WidgetPlugin.capabilities`"; diagnostic #13 checkpoint G's explicit-empty-vs-absent requirement,
 * extended per adversarial review round 1 beyond the pre-existing `EmptyState` fixture.
 *
 * `useWidget(Plugin)` must gate every accessor — most critically `WidgetSlot` — on
 * `plugin.capabilities`, never on Blueprint/Runtime object shape (member-key counts, semantic-slot-map
 * key counts, or any other `[Payload] extends [never]` heuristic). A capability can be
 * explicitly-declared-empty (`properties: Record<never, never>`, `methods: Record<never, never>`,
 * `slots: never`) and still be present; only a truly absent capability drops its accessor.
 */

import { describe, expect, it } from 'vitest'
import {
	ContainerPlugin,
	createCapabilityFixtureRuntime,
	EmptyMethodsPlugin,
	EmptyPropertiesPlugin,
	EmptySlotsPlugin,
	LabelPlugin,
	LeafPlugin,
	mountWidgetBridge,
} from './test-fixtures'

/**
 * `UseWidgetResult<Plugin>` correctly omits an absent capability's accessor key from the *type*, so
 * reaching for it directly (`bridge.useState`) to assert runtime absence is itself a type error — the
 * exact behavior these tests exist to prove. This narrows to a loosely-typed view only for that
 * specific runtime-shape assertion.
 */
function asLooseRecord(value: object): Record<string, unknown> {
	return value as Record<string, unknown>
}

describe('plugin.capabilities — the authoritative presence source `useWidget()` reads', () => {
	it('is true for an explicitly-declared-empty capability and false for a truly absent one', () => {
		expect(EmptyPropertiesPlugin.capabilities.properties)
			.toBe(true)
		expect(EmptyPropertiesPlugin.capabilities.state)
			.toBe(false)
		expect(EmptyPropertiesPlugin.capabilities.methods)
			.toBe(false)
		expect(EmptyPropertiesPlugin.capabilities.slots)
			.toBe(false)

		expect(EmptyMethodsPlugin.capabilities.methods)
			.toBe(true)
		expect(EmptyMethodsPlugin.capabilities.properties)
			.toBe(false)

		expect(EmptySlotsPlugin.capabilities.slots)
			.toBe(true)
		expect(EmptySlotsPlugin.capabilities.state)
			.toBe(false)

		// Comparison points already used elsewhere in the suite as "absent" fixtures.
		expect(LeafPlugin.capabilities.slots)
			.toBe(false)
		expect(LeafPlugin.capabilities.properties)
			.toBe(false)
		expect(LabelPlugin.capabilities.methods)
			.toBe(false)
		expect(ContainerPlugin.capabilities.slots)
			.toBe(true)
	})
})

describe('useWidget() runtime capability gating — explicit-empty vs absent', () => {
	it('exposes useProperties()/usePropertyDiagnostics() with an empty keyed surface for explicit-empty properties, and drops every other accessor', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'ep1', type: 'EmptyProperties' })
		const { bridge } = mountWidgetBridge(runtime, 'ep1', EmptyPropertiesPlugin)

		expect(bridge.useProperties)
			.toBeTypeOf('function')
		expect(bridge.usePropertyDiagnostics)
			.toBeTypeOf('function')
		expect(Object.keys(bridge.useProperties()))
			.toEqual([])
		expect(Object.keys(bridge.usePropertyDiagnostics()))
			.toEqual([])
		// No state/methods/slots were declared at all — absent, not explicitly empty.
		expect(asLooseRecord(bridge).useState)
			.toBeUndefined()
		expect(asLooseRecord(bridge).useMethods)
			.toBeUndefined()
		expect(asLooseRecord(bridge).WidgetSlot)
			.toBeUndefined()
	})

	it('exposes useMethods()/useMethodDiagnostics() with an empty keyed surface for explicit-empty methods, and drops every other accessor', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'em1', type: 'EmptyMethods' })
		const { bridge } = mountWidgetBridge(runtime, 'em1', EmptyMethodsPlugin)

		expect(bridge.useMethods)
			.toBeTypeOf('function')
		expect(bridge.useMethodDiagnostics)
			.toBeTypeOf('function')
		expect(Object.keys(bridge.useMethods()))
			.toEqual([])
		expect(Object.keys(bridge.useMethodDiagnostics()))
			.toEqual([])
		expect(asLooseRecord(bridge).useProperties)
			.toBeUndefined()
		expect(asLooseRecord(bridge).WidgetSlot)
			.toBeUndefined()
	})

	it('exposes WidgetSlot for explicitly-declared-empty slots (`slots: never`) — the exact case a shape-based test collapses into absence', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'es1', type: 'EmptySlots' })
		const { bridge } = mountWidgetBridge(runtime, 'es1', EmptySlotsPlugin)

		// The resolved semantic slot map is `{}` here, exactly as it is for a widget whose plugin has no
		// `slots` capability at all — proving presence cannot be read from `blueprint.slots`'s own shape.
		const widget = runtime.getWidget('es1') as unknown as { blueprint: { slots: object } }
		expect(Object.keys(widget.blueprint.slots))
			.toEqual([])

		expect(bridge.WidgetSlot)
			.toBeDefined()
	})

	it('widgetSlot is the same shared component identity regardless of which explicit-empty-slots widget produced it', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'es2', type: 'EmptySlots' })
		const first = mountWidgetBridge(runtime, 'es2', EmptySlotsPlugin).bridge.WidgetSlot
		const second = mountWidgetBridge(runtime, 'es2', EmptySlotsPlugin).bridge.WidgetSlot

		expect(first)
			.toBe(second)
	})

	it('drops WidgetSlot entirely for a plugin with no slots capability at all (absence, not explicit-empty)', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'em2', type: 'EmptyMethods' })
		const { bridge } = mountWidgetBridge(runtime, 'em2', EmptyMethodsPlugin)

		expect(asLooseRecord(bridge).WidgetSlot)
			.toBeUndefined()
	})
})
