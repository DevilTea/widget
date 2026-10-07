import type { WidgetIntegrationErrorCode } from './index'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import * as core from '../index'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { getWidgetEventEmitter, WidgetIntegrationError } from './index'

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
		expect('WidgetIntegrationError' in core)
			.toBe(false)
		expectTypeOf<typeof core>()
			.not.toHaveProperty('WidgetIntegrationError')
		expectTypeOf<typeof core>()
			.not.toHaveProperty('getWidgetEventEmitter')
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

	it('rejects a RuntimeWidget from a different Runtime instance with a stable coded integration error', () => {
		const first = createSingleRuntime(eventPlugin)
		const second = createSingleRuntime(eventPlugin)
		let thrown: unknown
		try {
			getWidgetEventEmitter(first.runtime, second.widget)
		}
		catch (error) {
			thrown = error
		}

		expect(thrown)
			.toBeInstanceOf(WidgetIntegrationError)
		expect((thrown as WidgetIntegrationError).code)
			.toBe('runtime-widget-mismatch')
		expectTypeOf<WidgetIntegrationErrorCode>()
			.toEqualTypeOf<'runtime-widget-mismatch' | 'foreign-runtime'>()
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

	it('rejects a Runtime from another module instance with foreign-runtime', async () => {
		vi.resetModules()
		const foreignCore = await import('../index')
		const foreignPlugin = foreignCore.createWidgetPlugin('plain')
			.description('Plain')
			.interfaces<Record<never, never>>()
			.done()
		const foreignSystem = foreignCore.createWidgetSystem({ plugins: [foreignPlugin] as const })
		const foreignBlueprint = foreignSystem.createBlueprint({ id: 'root', type: 'plain' })
		if (foreignBlueprint.status !== 'valid')
			throw new Error('Expected valid blueprint')
		const foreignRuntime = foreignBlueprint.createRuntime()
		const foreignWidget = foreignRuntime.getWidget('root')

		let thrown: unknown
		try {
			getWidgetEventEmitter(foreignRuntime as never, foreignWidget as never)
		}
		catch (error) {
			thrown = error
		}
		expect(thrown)
			.toBeInstanceOf(WidgetIntegrationError)
		expect((thrown as WidgetIntegrationError).code)
			.toBe('foreign-runtime')
	})

	it('rejects structural look-alike and delegating Runtime forgeries with foreign-runtime', () => {
		const { runtime, widget } = createSingleRuntime(eventPlugin)
		const forgeries = [
			{ getWidget: () => widget, blueprint: runtime.blueprint },
			{ getWidget: runtime.getWidget, blueprint: runtime.blueprint, isDisposed: false },
			null,
		]

		for (const forged of forgeries) {
			let thrown: unknown
			try {
				getWidgetEventEmitter(forged as never, widget)
			}
			catch (error) {
				thrown = error
			}
			expect(thrown)
				.toBeInstanceOf(WidgetIntegrationError)
			expect((thrown as WidgetIntegrationError).code)
				.toBe('foreign-runtime')
		}
	})

	it('rejects a RuntimeWidget from a second Runtime of the same Blueprint with runtime-widget-mismatch', () => {
		const system = createWidgetSystem({ plugins: [eventPlugin] as const })
		const blueprint = system.createBlueprint({ id: 'root', type: eventPlugin.type })
		if (blueprint.status !== 'valid')
			throw new Error('Expected valid blueprint')
		const first = blueprint.createRuntime()
		const second = blueprint.createRuntime()
		const secondWidget = second.getWidget('root')!

		let thrown: unknown
		try {
			getWidgetEventEmitter(first, secondWidget)
		}
		catch (error) {
			thrown = error
		}
		expect(thrown)
			.toBeInstanceOf(WidgetIntegrationError)
		expect((thrown as WidgetIntegrationError).code)
			.toBe('runtime-widget-mismatch')
		expect(getWidgetEventEmitter(second, secondWidget))
			.not.toBeNull()
	})

	it('exposes WidgetIntegrationError with the foreign-runtime code from the integration subpath', () => {
		const error = new WidgetIntegrationError('foreign-runtime')

		expect(error)
			.toBeInstanceOf(WidgetIntegrationError)
		expect(error.code)
			.toBe('foreign-runtime')
	})

	it('rejects a forged RuntimeWidget against a genuine Runtime with runtime-widget-mismatch', () => {
		const { runtime, widget } = createSingleRuntime(eventPlugin)
		const forgedWidgets = [
			{ id: 'root', blueprint: (widget as unknown as { blueprint: unknown }).blueprint },
			{ ...(widget as object) },
			{ id: 'missing' },
			null,
		]

		for (const forged of forgedWidgets) {
			let thrown: unknown
			try {
				getWidgetEventEmitter(runtime, forged as never)
			}
			catch (error) {
				thrown = error
			}
			expect(thrown)
				.toBeInstanceOf(WidgetIntegrationError)
			expect((thrown as WidgetIntegrationError).code)
				.toBe('runtime-widget-mismatch')
		}
	})
})
