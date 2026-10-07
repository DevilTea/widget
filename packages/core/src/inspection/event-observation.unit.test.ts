/**
 * Public-semantics conformance for Runtime Event inspection delivery
 * (`RuntimeWidgetInspection.getEvent(name).subscribe`), as recorded in the Discussion #12 amendment
 * "Event delivery semantics and Runtime Event inspection as a supported passive observation surface (#163)".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { inspectRuntime } from './index'

interface Payload { readonly label: string }

interface ObservedInterfaces {
	methods: {
		fire: (value: string) => void
		fireObject: (payload: Payload) => void
	}
	events: {
		change: [value: string]
		object: [payload: Payload]
	}
}

const plugin = createWidgetPlugin('observed')
	.description('Event observation fixture')
	.interfaces<ObservedInterfaces>()
	.methods(methods => methods
		.fire({
			validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
			execute: ({ args, emit }) => emit.change(args[0]),
		})
		.fireObject({
			validateArgs: (args): args is [Payload] => args.length === 1 && typeof args[0] === 'object' && args[0] !== null,
			execute: ({ args, emit }) => emit.object(args[0]),
		}))
	.events(events => events
		.change({ description: 'Changed value' })
		.object({ description: 'Object occurrence' }))
	.done()

const stateOnlyPlugin = createWidgetPlugin('observed-no-events')
	.description('No events fixture')
	.interfaces<{ state: { value: number } }>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.done()

function createHarness() {
	const system = createWidgetSystem({ plugins: [plugin, stateOnlyPlugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'observed' })
	if (blueprint.status !== 'valid')
		throw new Error('Expected valid blueprint')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null || widget.type !== 'observed')
		throw new Error('Expected runtime widget')
	const inspection = inspectRuntime(runtime)
	const widgetInspection = inspection.getWidget(inspection.blueprint.rootNodeId)!
	return {
		runtime,
		widget,
		widgetInspection,
		change: widgetInspection.getEvent('change')!,
		object: widgetInspection.getEvent('object')!,
	}
}

async function flushAsyncReports(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await new Promise<void>(resolve => setTimeout(resolve, 0))
}

describe('runtime event inspection delivery guarantees', () => {
	const uncaught: unknown[] = []
	const onUncaught = (error: unknown): void => {
		uncaught.push(error)
	}

	beforeEach(() => {
		uncaught.length = 0
		process.on('uncaughtException', onUncaught)
	})

	afterEach(async () => {
		await flushAsyncReports()
		process.off('uncaughtException', onUncaught)
	})

	it('returns null for an absent Event member or capability and an identity-stable facade otherwise, even after dispose', () => {
		const system = createWidgetSystem({ plugins: [plugin, stateOnlyPlugin] })
		const bare = system.createBlueprint({ id: 'bare', type: 'observed-no-events' })
		if (bare.status !== 'valid')
			throw new Error('Expected valid blueprint')
		const bareInspection = inspectRuntime(bare.createRuntime())
		expect(bareInspection.getWidget(bareInspection.blueprint.rootNodeId)!.getEvent('change'))
			.toBeNull()

		const { runtime, widgetInspection, change } = createHarness()
		expect(widgetInspection.getEvent('missing'))
			.toBeNull()
		expect(widgetInspection.getEvent('change'))
			.toBe(change)
		runtime.dispose()
		expect(widgetInspection.getEvent('change'))
			.toBe(change)
	})

	it('runs every inspection listener before any public listener, in subscription order within each audience', () => {
		const { widget, change } = createHarness()
		const order: string[] = []
		widget.events.change.subscribe(() => order.push('public-1'))
		change.subscribe(() => order.push('inspection-1'))
		widget.events.change.subscribe(() => order.push('public-2'))
		change.subscribe(() => order.push('inspection-2'))

		widget.methods.fire('x')

		expect(order)
			.toEqual(['inspection-1', 'inspection-2', 'public-1', 'public-2'])
	})

	it('does not let an inspection callback join the public delivery that is already in progress', () => {
		const { widget, change } = createHarness()
		const lateCalls: string[] = []
		let joined = false
		change.subscribe(() => {
			if (joined)
				return
			joined = true
			widget.events.change.subscribe((later) => {
				lateCalls.push(String(later))
			})
		})

		widget.methods.fire('first')
		expect(lateCalls)
			.toEqual([])

		widget.methods.fire('second')
		expect(lateCalls)
			.toEqual(['second'])
	})

	it('snapshots the inspection audience per occurrence', () => {
		const { widget, change } = createHarness()
		const calls: string[] = []
		let unsubscribeSecond: (() => void) | undefined
		let subscribedLate = false
		change.subscribe(() => {
			calls.push('first')
			unsubscribeSecond?.()
			if (!subscribedLate) {
				subscribedLate = true
				change.subscribe(() => calls.push('late'))
			}
		})
		unsubscribeSecond = change.subscribe(() => calls.push('second'))

		widget.methods.fire('one')
		expect(calls)
			.toEqual(['first', 'second'])

		calls.length = 0
		widget.methods.fire('two')
		expect(calls)
			.toEqual(['first', 'late'])
	})

	it('isolates a throwing inspection listener and reports it outside the emit call', async () => {
		const { widget, change } = createHarness()
		const failure = new Error('inspection listener failure')
		const peer = vi.fn()
		const publicListener = vi.fn()
		change.subscribe(() => {
			throw failure
		})
		change.subscribe(peer)
		widget.events.change.subscribe(publicListener)

		let result: ReturnType<typeof widget.methods.fire> | undefined
		expect(() => {
			result = widget.methods.fire('x')
		}).not.toThrow()

		expect(result)
			.toMatchObject({ ok: true })
		expect(peer)
			.toHaveBeenCalledTimes(1)
		expect(publicListener)
			.toHaveBeenCalledTimes(1)
		expect(uncaught)
			.toEqual([])

		await flushAsyncReports()
		expect(uncaught)
			.toEqual([failure])
	})

	it('still publishes the occurrence to inspection when a later public listener throws', () => {
		const { widget, change } = createHarness()
		const failure = new Error('public listener failure')
		const observed = vi.fn()
		const laterPublic = vi.fn()
		change.subscribe(observed)
		widget.events.change.subscribe(() => {
			throw failure
		})
		widget.events.change.subscribe(laterPublic)

		expect(() => widget.methods.fire('x'))
			.toThrow(failure)

		expect(observed)
			.toHaveBeenCalledTimes(1)
		expect(observed.mock.calls[0]![0])
			.toEqual(['x'])
		expect(laterPublic).not.toHaveBeenCalled()
	})

	it('shares one shallow-frozen args array across inspection listeners without cloning or freezing elements', () => {
		const { widget, object } = createHarness()
		const received: (readonly unknown[])[] = []
		object.subscribe(args => received.push(args))
		object.subscribe(args => received.push(args))
		const payload: Payload = { label: 'original' }

		widget.methods.fireObject(payload)

		expect(received)
			.toHaveLength(2)
		expect(received[1])
			.toBe(received[0])
		expect(Object.isFrozen(received[0]))
			.toBe(true)
		expect(received[0]![0])
			.toBe(payload)
		expect(Object.isFrozen(payload))
			.toBe(false)
	})

	it('delivers a distinct args array for each occurrence', () => {
		const { widget, change } = createHarness()
		const received: (readonly unknown[])[] = []
		change.subscribe(args => received.push(args))

		widget.methods.fire('a')
		widget.methods.fire('b')

		expect(received)
			.toEqual([['a'], ['b']])
		expect(received[1])
			.not
			.toBe(received[0])
	})

	it('observes future occurrences only, with no replay or immediate emission', () => {
		const { widget, change } = createHarness()
		widget.methods.fire('before')

		const listener = vi.fn()
		change.subscribe(listener)
		expect(listener).not.toHaveBeenCalled()

		widget.methods.fire('after')
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener.mock.calls[0]![0])
			.toEqual(['after'])
	})

	it('stops delivering after unsubscribe and keeps unsubscribe idempotent', () => {
		const { widget, change } = createHarness()
		const listener = vi.fn()
		const unsubscribe = change.subscribe(listener)

		unsubscribe()
		unsubscribe()
		widget.methods.fire('x')

		expect(listener).not.toHaveBeenCalled()
	})

	it('rejects new subscriptions after dispose and never calls earlier listeners again', () => {
		const { runtime, widget, change } = createHarness()
		const listener = vi.fn()
		const unsubscribe = change.subscribe(listener)

		runtime.dispose()

		expect(() => change.subscribe(() => {}))
			.toThrow(WidgetSystemRuntimeDisposedError)
		expect(() => widget.methods.fire('x'))
			.toThrow(WidgetSystemRuntimeDisposedError)
		expect(listener).not.toHaveBeenCalled()
		expect(() => {
			unsubscribe()
			unsubscribe()
		}).not.toThrow()
	})
})
