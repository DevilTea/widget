// @vitest-environment happy-dom

import type { UseWidgetResult } from './types'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '@deviltea/widget-core'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { mountWidgetBridge } from './test-fixtures'

const PROTO_KEY = '__proto__' as const

interface EventInterfaces {
	events: {
		press: []
		change: [value: string]
		__proto__: [value: number]
	}
}

const EventPlugin = createWidgetPlugin('EventProjection')
	.description('Event projection fixture')
	.interfaces<EventInterfaces>()
	.events((events) => {
		const beforeProto = events
			.press({ description: 'Pressed' })
			.change({ description: 'Changed' })
		return beforeProto[PROTO_KEY]({ description: 'Prototype-safe' })
	})
	.done()

interface EmptyEventsInterfaces {
	events: Record<never, never>
}

const EmptyEventsPlugin = createWidgetPlugin('EmptyEventProjection')
	.description('Empty events fixture')
	.interfaces<EmptyEventsInterfaces>()
	.events(events => events)
	.done()

const NoEventsPlugin = createWidgetPlugin('NoEventProjection')
	.description('No events fixture')
	.interfaces<Record<never, never>>()
	.done()

function createRuntime<Plugin extends typeof EventPlugin | typeof EmptyEventsPlugin | typeof NoEventsPlugin>(plugin: Plugin) {
	const system = createWidgetSystem({ plugins: [plugin] as const })
	const blueprint = system.createBlueprint({ id: 'root', type: plugin.type })
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid blueprint')
	return blueprint.createRuntime()
}

describe('useWidget() event emitter projection', () => {
	it('types declared event names and tuple arguments exactly', () => {
		type Result = UseWidgetResult<typeof EventPlugin>
		expectTypeOf<Result>()
			.toHaveProperty('emit')
		expectTypeOf<Result['emit']['press']>()
			.toEqualTypeOf<() => void>()
		expectTypeOf<Result['emit']['change']>()
			.toEqualTypeOf<(value: string) => void>()
		expectTypeOf<Result['emit'][typeof PROTO_KEY]>()
			.toEqualTypeOf<(value: number) => void>()
	})

	it('omits emit when events capability is absent, but keeps an empty emitter when explicitly empty', () => {
		type Absent = UseWidgetResult<typeof NoEventsPlugin>
		type Empty = UseWidgetResult<typeof EmptyEventsPlugin>
		expectTypeOf<Absent>().not.toHaveProperty('emit')
		expectTypeOf<Empty>()
			.toHaveProperty('emit')
		expectTypeOf<keyof Empty['emit']>()
			.toEqualTypeOf<never>()

		const absentRuntime = createRuntime(NoEventsPlugin)
		const absent = mountWidgetBridge(absentRuntime, 'root', NoEventsPlugin)
		expect(absent.bridge).not.toHaveProperty('emit')

		const emptyRuntime = createRuntime(EmptyEventsPlugin)
		const empty = mountWidgetBridge(emptyRuntime, 'root', EmptyEventsPlugin)
		expect(empty.bridge.emit)
			.toBeDefined()
		expect(Object.keys(empty.bridge.emit))
			.toEqual([])
	})

	it('emits through the same Core event channel observed by Runtime consumers', () => {
		const runtime = createRuntime(EventPlugin)
		const widget = runtime.getWidget('root')!
		const listener = vi.fn()
		widget.events.change.subscribe(listener)
		const { bridge } = mountWidgetBridge(runtime, 'root', EventPlugin)
		bridge.emit.change('from-vue')
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener)
			.toHaveBeenCalledWith('from-vue')
	})

	it('supports prototype-sensitive event names without exposing a plain-object hazard', () => {
		const runtime = createRuntime(EventPlugin)
		const widget = runtime.getWidget('root')!
		const listener = vi.fn()
		widget.events[PROTO_KEY].subscribe(listener)
		const { bridge } = mountWidgetBridge(runtime, 'root', EventPlugin)
		bridge.emit[PROTO_KEY](7)
		expect(listener)
			.toHaveBeenCalledWith(7)
	})

	it('does not touch Runtime when only materializing a declared emitter', () => {
		const runtime = createRuntime(EventPlugin)
		const { bridge } = mountWidgetBridge(runtime, 'root', EventPlugin)
		expect((bridge.emit as unknown as Record<string, unknown>).missing)
			.toBeUndefined()
		runtime.dispose()
		let emitChange: typeof bridge.emit.change | undefined
		expect(() => {
			emitChange = bridge.emit.change
		})
			.not.toThrow()
		expect(() => emitChange?.('after-dispose'))
			.toThrow(WidgetSystemRuntimeDisposedError)
	})

	it('keeps Core disposal authoritative for renderer emit authority', () => {
		const runtime = createRuntime(EventPlugin)
		const { bridge } = mountWidgetBridge(runtime, 'root', EventPlugin)
		const emitChange = bridge.emit.change
		runtime.dispose()
		expect(() => emitChange('stale'))
			.toThrow(WidgetSystemRuntimeDisposedError)
	})
})
