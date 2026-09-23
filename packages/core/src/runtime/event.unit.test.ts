import type { WidgetEventEmitter } from '../index'
import { computed, signal } from 'alien-signals'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'

const PROTO_KEY = '__proto__' as const

interface EventInterfaces {
	slots: 'children'
	methods: {
		emitPing: () => void
		emitChange: (value: string) => void
		emitChain: (value: string) => void
		emitProto: (value: number) => void
		captureEmitter: () => void
	}
	events: {
		ping: []
		change: [value: string]
		chain: [value: string]
		__proto__: [value: number]
	}
}

let capturedEmitter: WidgetEventEmitter<EventInterfaces> | null = null

function readCapturedEmitter(): WidgetEventEmitter<EventInterfaces> | null {
	return capturedEmitter
}

const eventPlugin = createWidgetPlugin('event-widget')
	.description('Event widget')
	.interfaces<EventInterfaces>()
	.slots({ children: { description: 'Children' } })
	.methods(methods => methods
		.emitPing({
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ emit }) => emit.ping(),
		})
		.emitChange({
			validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
			execute: ({ args, emit }) => emit.change(args[0]),
		})
		.emitChain({
			validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
			execute: ({ args, emit }) => emit.chain(args[0]),
		})
		.emitProto({
			validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
			execute: ({ args, emit }) => emit[PROTO_KEY](args[0]),
		})
		.captureEmitter({
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ emit }) => {
				capturedEmitter = emit
			},
		}))
	.events((events) => {
		const beforeProto = events
			.ping({ description: 'Ping' })
			.change({ description: 'Changed value' })
			.chain({ description: 'Chain event' })
		return beforeProto[PROTO_KEY]({ description: 'Prototype-safe event' })
	})
	.done()

function createRuntime() {
	const system = createWidgetSystem({ plugins: [eventPlugin] })
	const blueprint = system.createBlueprint({
		id: 'root',
		type: 'event-widget',
		slots: {
			children: [{ id: 'child', type: 'event-widget' }],
		},
	})
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid blueprint')
	const runtime = blueprint.createRuntime()
	const root = runtime.getWidget('root')
	const child = runtime.getWidget('child')
	if (root === null || child === null)
		throw new Error('Expected runtime widgets')
	return { runtime, root, child }
}

describe('runtime semantic events', () => {
	it('exposes a subscribe-only named surface with exact tuple listener types', () => {
		const { root } = createRuntime()
		expectTypeOf(root.events.change.subscribe)
			.parameter(0)
			.toEqualTypeOf<(value: string) => void>()
		expectTypeOf(root.events.change).not.toHaveProperty('emit')
		expect(Object.getPrototypeOf(root.events))
			.toBeNull()
	})

	it('delivers synchronously in the same call stack', () => {
		const { root } = createRuntime()
		const order: string[] = []
		root.events.change.subscribe(value => order.push(`event:${value}`))
		order.push('before')
		const result = root.methods.emitChange('x')
		order.push('after')
		expect(result)
			.toEqual({ ok: true, value: undefined })
		expect(order)
			.toEqual(['before', 'event:x', 'after'])
	})

	it('uses depth-first ordering for nested/reentrant emits', () => {
		const { root } = createRuntime()
		const order: string[] = []
		root.events.chain.subscribe((value) => {
			order.push(`${value}:a`)
			if (value === 'outer')
				root.methods.emitChain('inner')
		})
		root.events.chain.subscribe(value => order.push(`${value}:b`))
		root.methods.emitChain('outer')
		expect(order)
			.toEqual(['outer:a', 'inner:a', 'inner:b', 'outer:b'])
	})

	it('snapshots subscribers at emit start', () => {
		const { root } = createRuntime()
		const calls: string[] = []
		let changed = false
		const listenerB = () => calls.push('b')
		const unsubscribeB = root.events.ping.subscribe(listenerB)
		root.events.ping.subscribe(() => {
			calls.push('a')
			if (!changed) {
				changed = true
				unsubscribeB()
				root.events.ping.subscribe(() => calls.push('c'))
			}
		})
		root.methods.emitPing()
		expect(calls)
			.toEqual(['b', 'a'])
		calls.length = 0
		root.methods.emitPing()
		expect(calls)
			.toEqual(['a', 'c'])
	})

	it('keeps duplicate callback registrations and their unsubscribe handles independent', () => {
		const { root } = createRuntime()
		const callback = vi.fn()
		const unsubscribeFirst = root.events.ping.subscribe(callback)
		const unsubscribeSecond = root.events.ping.subscribe(callback)

		root.methods.emitPing()
		expect(callback)
			.toHaveBeenCalledTimes(2)

		unsubscribeFirst()
		root.methods.emitPing()
		expect(callback)
			.toHaveBeenCalledTimes(3)

		unsubscribeSecond()
		root.methods.emitPing()
		expect(callback)
			.toHaveBeenCalledTimes(3)
	})

	it('does not let public event listeners add accidental reactive dependencies', () => {
		const { root } = createRuntime()
		const unrelated = signal(1)
		const observed: number[] = []
		root.events.ping.subscribe(() => observed.push(unrelated()))

		let evaluationCount = 0
		const dependent = computed(() => {
			++evaluationCount
			root.methods.emitPing()
			return evaluationCount
		})
		expect(dependent())
			.toBe(1)
		expect(observed)
			.toEqual([1])
		unrelated(2)
		expect(dependent())
			.toBe(1)
		expect(observed)
			.toEqual([1])
	})

	it('propagates subscriber errors immediately and aborts later subscribers', () => {
		const { root } = createRuntime()
		const error = new Error('subscriber failed')
		const later = vi.fn()
		root.events.change.subscribe(() => {
			throw error
		})
		root.events.change.subscribe(later)
		expect(() => root.methods.emitChange('x'))
			.toThrow(error)
		expect(later).not.toHaveBeenCalled()
	})

	it('scopes same-named events to one widget instance', () => {
		const { root, child } = createRuntime()
		const rootListener = vi.fn()
		const childListener = vi.fn()
		root.events.change.subscribe(rootListener)
		child.events.change.subscribe(childListener)
		child.methods.emitChange('child')
		expect(rootListener).not.toHaveBeenCalled()
		expect(childListener)
			.toHaveBeenCalledWith('child')
	})

	it('keeps special event names prototype-safe', () => {
		const { root } = createRuntime()
		const listener = vi.fn()
		root.events[PROTO_KEY].subscribe(listener)
		root.methods.emitProto(42)
		expect(Object.hasOwn(root.events, PROTO_KEY))
			.toBe(true)
		expect(listener)
			.toHaveBeenCalledWith(42)
	})

	it('clears subscriptions on dispose and keeps prior unsubscribe handles safe', () => {
		const { runtime, root } = createRuntime()
		const listener = vi.fn()
		const unsubscribe = root.events.ping.subscribe(listener)
		runtime.dispose()
		expect(() => unsubscribe()).not.toThrow()
		expect(() => root.events.ping.subscribe(listener))
			.toThrow(WidgetSystemRuntimeDisposedError)
	})

	it('invalidates a previously captured implementation emitter after dispose', () => {
		capturedEmitter = null
		const { runtime, root } = createRuntime()
		root.methods.captureEmitter()
		const emitter = readCapturedEmitter()
		expect(emitter).not.toBeNull()
		runtime.dispose()
		expect(() => emitter!.ping())
			.toThrow(WidgetSystemRuntimeDisposedError)
	})
})
