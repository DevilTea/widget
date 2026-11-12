// @vitest-environment happy-dom
/**
 * Lazy keyed surfaces (`useState()`, `useProperties()`, `useMethods()`, the three member-diagnostics
 * surfaces, and `emit`) are enumerable and truthful: `Object.keys`, spread, `in` and `toRefs` reflect
 * exactly the declared members, while enumerating never subscribes the Runtime.
 */

import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it, vi } from 'vitest'
import { isRef } from 'vue'
import {
	CounterPlugin,
	createCapabilityFixtureRuntime,
	createFixtureRuntime,
	EmptyPropertiesPlugin,
	getCounterWidget,
	mountWidgetBridge,
} from './test-fixtures'

const PROTO_KEY = '__proto__' as const

interface EventInterfaces {
	events: {
		press: []
		change: [value: string]
		__proto__: [value: number]
	}
}

const EventPlugin = createWidgetPlugin('EnumerableEvents')
	.description('Enumerable events fixture')
	.interfaces<EventInterfaces>()
	.events((events) => {
		const beforeProto = events
			.press({ description: 'Pressed' })
			.change({ description: 'Changed' })
		return beforeProto[PROTO_KEY]({ description: 'Prototype-safe' })
	})
	.done()

function mountCounter() {
	const runtime = createFixtureRuntime({ id: 'w', type: 'Counter' })
	const widget = getCounterWidget(runtime, 'w')
	const { bridge } = mountWidgetBridge(runtime, 'w', CounterPlugin)
	return { widget, bridge }
}

describe('lazy keyed surfaces — enumeration and membership', () => {
	it('enumerates exactly the declared members through Object.keys and spread', () => {
		const { bridge } = mountCounter()

		const state = bridge.useState()
		expect(Object.keys(state))
			.toEqual(['count'])
		expect(Object.keys({ ...state }))
			.toEqual(['count'])
		expect({ ...state }.count)
			.toBe(state.count)

		expect(Object.keys(bridge.useProperties()))
			.toEqual(['doubled'])
		expect(Object.keys(bridge.useMethods()))
			.toEqual(['increment', 'reset', 'crash', 'then'])
		expect(Object.keys(bridge.useStateDiagnostics()))
			.toEqual(['count'])
		expect(Object.keys(bridge.usePropertyDiagnostics()))
			.toEqual(['doubled'])
		expect(Object.keys(bridge.useMethodDiagnostics()))
			.toEqual(['increment', 'reset', 'crash', 'then'])
	})

	it('answers `in` truthfully: declared members only, never an undeclared or inherited name', () => {
		const { bridge } = mountCounter()
		const state = bridge.useState()

		expect('count' in state)
			.toBe(true)
		expect('zzz' in state)
			.toBe(false)
		expect('toString' in state)
			.toBe(false)
		expect(PROTO_KEY in state)
			.toBe(false)
		expect(Symbol.iterator in state)
			.toBe(false)
		expect('then' in bridge.useMethods())
			.toBe(true)
		expect((state as Record<string, unknown>).zzz)
			.toBeUndefined()
	})

	it('reports an explicitly-declared-empty capability as an empty surface', () => {
		const runtime = createCapabilityFixtureRuntime({ id: 'w', type: 'EmptyProperties' })
		const { bridge } = mountWidgetBridge(runtime, 'w', EmptyPropertiesPlugin)

		const properties = bridge.useProperties()
		expect(Object.keys(properties))
			.toEqual([])
		expect('anything' in properties)
			.toBe(false)
	})

	it('exposes members that are already refs, so destructuring the surface is the idiom', () => {
		const { bridge } = mountCounter()
		const state = bridge.useState()
		const { count } = state

		expect(count)
			.toBe(state.count)
		expect(isRef(count))
			.toBe(true)
		expect(count.value)
			.toBe(0)
		count.value = 5
		expect(state.count.value)
			.toBe(5)
	})

	it('supports freezing a surface obtained from useState() and keeps it enumerable', () => {
		const { bridge } = mountCounter()
		const state = bridge.useState()

		Object.freeze(state)
		Object.preventExtensions(bridge.useProperties())

		expect(Object.isFrozen(state))
			.toBe(true)
		expect(Object.keys(state))
			.toEqual(['count'])
		expect(Object.keys(bridge.useProperties()))
			.toEqual(['doubled'])
		expect(state.count.value)
			.toBe(0)
	})

	it('enumerates declared events through the emit surface, including a `__proto__` event', () => {
		const system = createWidgetSystem({ plugins: [EventPlugin] as const })
		const blueprint = system.createBlueprint({ id: 'root', type: EventPlugin.type })
		if (blueprint.status !== 'valid')
			throw new Error('Expected valid blueprint')
		const { bridge } = mountWidgetBridge(blueprint.createRuntime(), 'root', EventPlugin)

		expect(Object.keys(bridge.emit))
			.toEqual(['press', 'change', PROTO_KEY])
		expect('change' in bridge.emit)
			.toBe(true)
		expect('nope' in bridge.emit)
			.toBe(false)
		expect(PROTO_KEY in bridge.emit)
			.toBe(true)
	})

	it('keeps materialization lazy: enumerating, spreading and `in` never read or subscribe the Runtime', () => {
		const runtime = createFixtureRuntime({ id: 'w', type: 'Counter' })
		const widget = getCounterWidget(runtime, 'w')
		const stateGet = vi.spyOn(widget.state.count, 'get')
		const stateSubscribe = vi.spyOn(widget.state.count, 'subscribe')
		const propertyGet = vi.spyOn(widget.properties.doubled, 'get')
		const propertySubscribe = vi.spyOn(widget.properties.doubled, 'subscribe')
		const diagnosticsSubscribe = vi.spyOn(widget.state.count, 'subscribeDiagnostics')
		const { bridge } = mountWidgetBridge(runtime, 'w', CounterPlugin)

		const state = bridge.useState()
		const properties = bridge.useProperties()
		void Object.keys(state)
		void { ...state }
		void ('count' in state)
		void Object.keys(properties)
		void { ...properties }
		void Object.keys(bridge.useStateDiagnostics())
		void { ...bridge.useStateDiagnostics() }
		void Object.keys(bridge.useMethods())

		expect(stateGet).not.toHaveBeenCalled()
		expect(stateSubscribe).not.toHaveBeenCalled()
		expect(propertyGet).not.toHaveBeenCalled()
		expect(propertySubscribe).not.toHaveBeenCalled()
		expect(diagnosticsSubscribe).not.toHaveBeenCalled()
	})
})
