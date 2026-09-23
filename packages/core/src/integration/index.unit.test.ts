import { describe, expect, it, vi } from 'vitest'
import * as core from '../index'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { getWidgetEventEmitter } from './index'

interface EventInterfaces {
	methods: {
		fire: (value: string) => void
	}
	events: {
		change: [value: string]
	}
}

const eventPlugin = createWidgetPlugin('eventful')
	.description('Eventful')
	.interfaces<EventInterfaces>()
	.methods(methods => methods.fire({
		validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
		execute: ({ args, emit }) => emit.change(args[0]),
	}))
	.events(events => events.change({ description: 'Changed' }))
	.done()

const plainPlugin = createWidgetPlugin('plain')
	.description('Plain')
	.interfaces<Record<never, never>>()
	.done()

interface EmptyEventsInterfaces {
	events: Record<never, never>
}

const emptyEventsPlugin = createWidgetPlugin('empty-events')
	.description('Empty events')
	.interfaces<EmptyEventsInterfaces>()
	.events(events => events)
	.done()

function createSingleRuntime(plugin: typeof eventPlugin | typeof plainPlugin | typeof emptyEventsPlugin) {
	const system = createWidgetSystem({ plugins: [plugin] as const })
	const blueprint = system.createBlueprint({ id: 'root', type: plugin.type })
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid blueprint')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('Expected root widget')
	return { runtime, widget }
}

describe('@deviltea/widget-core/integration event emitter bridge', () => {
	it('is not re-exported from the package root', () => {
		expect('getWidgetEventEmitter' in core)
			.toBe(false)
	})

	it('returns the current widget scoped emitter and reaches public subscriptions synchronously', () => {
		const { runtime, widget } = createSingleRuntime(eventPlugin)
		const eventWidget = widget as ReturnType<typeof runtime.getWidget> & {
			events: { change: { subscribe: (listener: (value: string) => void) => () => void } }
		}
		const listener = vi.fn()
		eventWidget.events.change.subscribe(listener)
		const emitter = getWidgetEventEmitter(runtime, widget)
		expect(emitter).not.toBeNull()
		emitter!.change!('integration')
		expect(listener)
			.toHaveBeenCalledWith('integration')
	})

	it('rejects a RuntimeWidget from a different Runtime instance even when ids/types match', () => {
		const first = createSingleRuntime(eventPlugin)
		const second = createSingleRuntime(eventPlugin)
		expect(() => getWidgetEventEmitter(first.runtime, second.widget))
			.toThrow()
	})

	it('returns null when the widget has no events capability', () => {
		const { runtime, widget } = createSingleRuntime(plainPlugin)
		expect(getWidgetEventEmitter(runtime, widget))
			.toBeNull()
	})

	it('returns an empty scoped emitter for an explicitly-declared-empty events capability', () => {
		const { runtime, widget } = createSingleRuntime(emptyEventsPlugin)
		const emitter = getWidgetEventEmitter(runtime, widget)
		expect(emitter).not.toBeNull()
		expect(Object.keys(emitter!))
			.toEqual([])
		expect(Object.getPrototypeOf(emitter!))
			.toBeNull()
	})

	it('invalidates captured integration emit authority on Runtime disposal', () => {
		const { runtime, widget } = createSingleRuntime(eventPlugin)
		const emitter = getWidgetEventEmitter(runtime, widget)!
		runtime.dispose()
		expect(() => emitter.change!('stale'))
			.toThrow(WidgetSystemRuntimeDisposedError)
		expect(() => getWidgetEventEmitter(runtime, widget))
			.toThrow(WidgetSystemRuntimeDisposedError)
	})
})
