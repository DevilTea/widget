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
	createFixtureRuntime,
	EmptyMethodsPlugin,
	EmptyPropertiesPlugin,
	EmptySlotsPlugin,
	EmptyStatePlugin,
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
	it('exposes both State accessors for explicitly-empty State, and omits them when State is absent', () => {
		const emptyStateRuntime = createFixtureRuntime({ id: 'es3', type: 'EmptyState' })
		const { bridge: emptyStateBridge } = mountWidgetBridge(emptyStateRuntime, 'es3', EmptyStatePlugin)

		expect(EmptyStatePlugin.capabilities.state)
			.toBe(true)
		expect(emptyStateBridge.useState)
			.toBeTypeOf('function')
		expect(emptyStateBridge.useStateDiagnostics)
			.toBeTypeOf('function')

		// Label has no State declaration, so both accessor keys must be absent at runtime.
		const absentStateRuntime = createFixtureRuntime({ id: 'l3', type: 'Label' })
		const { bridge: absentStateBridge } = mountWidgetBridge(absentStateRuntime, 'l3', LabelPlugin)

		expect(LabelPlugin.capabilities.state)
			.toBe(false)
		expect(Object.hasOwn(absentStateBridge, 'useState'))
			.toBe(false)
		expect(Object.hasOwn(absentStateBridge, 'useStateDiagnostics'))
			.toBe(false)
	})

	it('exposes useProperties()/usePropertyDiagnostics() for explicit-empty properties, and drops every other accessor', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'ep1', type: 'EmptyProperties' })
		const { bridge } = mountWidgetBridge(runtime, 'ep1', EmptyPropertiesPlugin)

		expect(bridge.useProperties)
			.toBeTypeOf('function')
		expect(bridge.usePropertyDiagnostics)
			.toBeTypeOf('function')
		for (const key of ['__proto__', 'constructor', 'phantom']) {
			expect(asLooseRecord(bridge.useProperties())[key])
				.toBeUndefined()
			expect(asLooseRecord(bridge.usePropertyDiagnostics())[key])
				.toBeUndefined()
		}
		// No state/methods/slots were declared at all — absent, not explicitly empty.
		expect(asLooseRecord(bridge).useState)
			.toBeUndefined()
		expect(asLooseRecord(bridge).useMethods)
			.toBeUndefined()
		expect(asLooseRecord(bridge).WidgetSlot)
			.toBeUndefined()
	})

	it('exposes useMethods()/useMethodDiagnostics() for explicit-empty methods, and drops every other accessor', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'em1', type: 'EmptyMethods' })
		const { bridge } = mountWidgetBridge(runtime, 'em1', EmptyMethodsPlugin)

		expect(bridge.useMethods)
			.toBeTypeOf('function')
		expect(bridge.useMethodDiagnostics)
			.toBeTypeOf('function')
		for (const key of ['__proto__', 'constructor', 'phantom']) {
			expect(asLooseRecord(bridge.useMethods())[key])
				.toBeUndefined()
			expect(asLooseRecord(bridge.useMethodDiagnostics())[key])
				.toBeUndefined()
		}
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
