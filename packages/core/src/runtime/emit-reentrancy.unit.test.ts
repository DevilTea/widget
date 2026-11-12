/**
 * Conformance: a runaway Method -> emit -> listener -> Method loop ends promptly.
 *
 * Event listener exceptions are isolated, so without a guard a loop that never ends would not fail fast:
 * every nesting level would retry its remaining listeners after the deeper level failed, which is
 * exponential work. The non-semantic emit re-entrancy guard bounds one Runtime's nested emits at
 * `MAX_EMIT_DEPTH`; its `WidgetSystemRuntimeReentrancyError`, and an engine stack overflow raised inside a
 * listener, are the exceptions event-listener isolation never swallows, so they unwind every nested emit
 * to the operation that started the loop, with work linear in the nesting depth.
 *
 * Ordinary listener exceptions stay isolated at every nesting level, and legitimate re-entrancy keeps
 * working up to the limit.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeReentrancyError } from '../index'
import { MAX_EMIT_DEPTH } from './event'

interface LoopInterfaces {
	methods: {
		fire: () => null
	}
	events: {
		ev: []
	}
}

const loopPlugin = createWidgetPlugin('loop')
	.description('Test widget')
	.interfaces<LoopInterfaces>()
	.methods(methods => methods.fire({
		validateArgs: (args): args is [] => args.length === 0,
		execute: ({ emit }) => {
			emit.ev()
			return null
		},
	}))
	.events(events => events.ev({ description: 'Fired' }))
	.done()

const system = createWidgetSystem({ plugins: [loopPlugin] })

function createWidget() {
	const blueprint = system.createBlueprint({ id: 'loop', type: 'loop' })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	return blueprint.createRuntime()
		.getWidget('loop')!
}

/** Far more listener calls than any linear unwinding needs; stops a regressed exponential retry. */
const CALL_BUDGET = MAX_EMIT_DEPTH * 20

/** A genuine engine stack overflow, captured once at a shallow stack so a listener can rethrow it. */
function captureEngineStackOverflow(): unknown {
	const exhaust = (): number => 1 + exhaust()
	try {
		exhaust()
	}
	catch (error) {
		return error
	}
	throw new Error('expected the engine to report stack exhaustion')
}

let reported: unknown[] = []
function onUncaughtException(error: unknown): void {
	reported.push(error)
}

async function waitForAsyncReporting(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await new Promise<void>(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
	reported = []
	process.on('uncaughtException', onUncaughtException)
})

afterEach(async () => {
	await waitForAsyncReporting()
	process.off('uncaughtException', onUncaughtException)
})

describe('a runaway re-entrant emit loop', () => {
	it('throws WidgetSystemRuntimeReentrancyError to the outermost caller after MAX_EMIT_DEPTH nested emits', async () => {
		const widget = createWidget()
		const calls = { first: 0, second: 0 }
		widget.events.ev.subscribe(() => {
			if (++calls.first <= CALL_BUDGET)
				widget.methods.fire()
		})
		widget.events.ev.subscribe(() => {
			if (++calls.second <= CALL_BUDGET)
				widget.methods.fire()
		})

		let thrown: unknown
		try {
			widget.methods.fire()
		}
		catch (error) {
			thrown = error
		}

		expect(thrown)
			.toBeInstanceOf(WidgetSystemRuntimeReentrancyError)
		expect(thrown)
			.toBeInstanceOf(RangeError)
		expect(thrown)
			.toMatchObject({ name: 'WidgetSystemRuntimeReentrancyError', code: 'emit-depth-exceeded' })
		// Each level ran its first listener once; no level retried its second listener.
		expect(calls)
			.toEqual({ first: MAX_EMIT_DEPTH, second: 0 })

		await waitForAsyncReporting()

		// Thrown, never isolated: nothing is reported outside the emit.
		expect(reported)
			.toEqual([])
	})

	it('still unwinds linearly when listener code swallows the guard error at every level', () => {
		const widget = createWidget()
		const calls = { first: 0, second: 0 }
		widget.events.ev.subscribe(() => {
			if (++calls.first > CALL_BUDGET)
				return
			try {
				widget.methods.fire()
			}
			catch {}
		})
		widget.events.ev.subscribe(() => {
			if (++calls.second > CALL_BUDGET)
				return
			try {
				widget.methods.fire()
			}
			catch {}
		})

		expect(() => widget.methods.fire())
			.toThrow(WidgetSystemRuntimeReentrancyError)
		expect(calls)
			.toEqual({ first: MAX_EMIT_DEPTH, second: 0 })
	})

	it('also ends a loop that alternates between two Runtimes', async () => {
		const left = createWidget()
		const right = createWidget()
		let calls = 0
		left.events.ev.subscribe(() => {
			if (++calls <= CALL_BUDGET)
				right.methods.fire()
		})
		right.events.ev.subscribe(() => {
			if (++calls <= CALL_BUDGET)
				left.methods.fire()
		})
		left.events.ev.subscribe(() => {
			if (++calls <= CALL_BUDGET)
				right.methods.fire()
		})

		expect(() => left.methods.fire())
			.toThrow(WidgetSystemRuntimeReentrancyError)
		// Each Runtime nested MAX_EMIT_DEPTH emits; the second left listener never retried.
		expect(calls)
			.toBe(2 * MAX_EMIT_DEPTH)

		await waitForAsyncReporting()

		// The other Runtime's listener isolation let the guard error through as well.
		expect(reported)
			.toEqual([])
	})

	it('lets an engine stack overflow raised inside a listener unwind instead of retrying every level', () => {
		const overflow = captureEngineStackOverflow()
		const widget = createWidget()
		const calls = { first: 0, second: 0 }
		let depth = 0
		widget.events.ev.subscribe(() => {
			if (++calls.first > CALL_BUDGET)
				return
			// Stand-in for the stack running out a few levels down.
			if (++depth === 5)
				throw overflow
			widget.methods.fire()
		})
		widget.events.ev.subscribe(() => {
			if (++calls.second <= CALL_BUDGET)
				widget.methods.fire()
		})

		let thrown: unknown
		try {
			widget.methods.fire()
		}
		catch (error) {
			thrown = error
		}

		expect(thrown)
			.toBe(overflow)
		expect(calls)
			.toEqual({ first: 5, second: 0 })
	})

	it('accepts a new loop after the previous one unwound', () => {
		const widget = createWidget()
		let calls = 0
		let armed = true
		widget.events.ev.subscribe(() => {
			if (armed && ++calls <= CALL_BUDGET)
				widget.methods.fire()
		})

		expect(() => widget.methods.fire())
			.toThrow(WidgetSystemRuntimeReentrancyError)

		armed = false
		expect(widget.methods.fire())
			.toEqual({ ok: true, value: null })
	})
})

describe('legitimate re-entrancy and ordinary listener exceptions', () => {
	it('allows exactly MAX_EMIT_DEPTH nested emits', () => {
		const widget = createWidget()
		let depth = 0
		let deepest = 0
		widget.events.ev.subscribe(() => {
			deepest = Math.max(deepest, ++depth)
			if (depth < MAX_EMIT_DEPTH)
				widget.methods.fire()
			depth--
		})

		expect(widget.methods.fire())
			.toEqual({ ok: true, value: null })
		expect(deepest)
			.toBe(MAX_EMIT_DEPTH)
	})

	it('isolates an ordinary RangeError thrown by a nested listener', async () => {
		const widget = createWidget()
		const order: string[] = []
		let depth = 0
		const ordinary = new RangeError('Invalid time value')
		widget.events.ev.subscribe(() => {
			const level = ++depth
			order.push(`a${level}`)
			if (level < 3)
				widget.methods.fire()
			depth--
		})
		widget.events.ev.subscribe(() => {
			order.push(`b${depth + 1}`)
			if (depth + 1 === 3)
				throw ordinary
		})

		expect(widget.methods.fire())
			.toEqual({ ok: true, value: null })
		expect(order)
			.toEqual(['a1', 'a2', 'a3', 'b3', 'b2', 'b1'])

		await waitForAsyncReporting()

		expect(reported)
			.toEqual([ordinary])
	})
})
