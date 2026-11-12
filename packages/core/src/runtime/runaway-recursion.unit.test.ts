/**
 * Conformance: runaway Method <-> Method recursion is a valid Blueprint (Discussion #12 C0R19: a
 * method-only cycle is valid and runaway recursion is ordinary runaway recursion), so the engine's stack
 * overflow is just an implementation exception escaping the outermost invocation. It must not leave
 * alien-signals batched: afterwards every subscriber in this Runtime and in any other Runtime of the
 * realm is still notified, and the batch depth is back to its value at the outermost entry.
 */

import { endBatch, getBatchDepth, startBatch } from 'alien-signals'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface RecursiveInterfaces {
	state: {
		a: number
	}
	properties: {
		sum: number
	}
	methods: {
		ping: () => number
		pong: () => number
	}
}

interface CounterInterfaces {
	state: {
		n: number
	}
}

const isNumber = (input: unknown): input is number => typeof input === 'number'

const recursivePlugin = createWidgetPlugin('recursive')
	.description('Test widget')
	.interfaces<RecursiveInterfaces>()
	.state(state => state.a({ validate: isNumber, default: () => 0 }))
	.properties(properties => properties.sum({
		registerDeps: ({ dep }) => ({ a: dep.self.state.get('a') }),
		compute: ({ deps }) => {
			const a = deps.a()
			return a.ok ? a.value ?? 0 : 0
		},
	}))
	.methods(methods => methods
		.ping({
			registerDeps: ({ dep }) => ({ pong: dep.self.methods.invoke('pong'), setA: dep.self.state.set('a') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				deps.setA(1)
				const pong = deps.pong()
				return pong.ok ? pong.value ?? 0 : 0
			},
		})
		.pong({
			registerDeps: ({ dep }) => ({ ping: dep.self.methods.invoke('ping') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				const ping = deps.ping()
				return ping.ok ? ping.value ?? 0 : 0
			},
		}))
	.done()

const counterPlugin = createWidgetPlugin('counter')
	.description('Test widget')
	.interfaces<CounterInterfaces>()
	.state(state => state.n({ validate: isNumber, default: () => 0 }))
	.done()

const recursiveSystem = createWidgetSystem({ plugins: [recursivePlugin] })
const counterSystem = createWidgetSystem({ plugins: [counterPlugin] })

function createRecursiveRuntime() {
	const blueprint = recursiveSystem.createBlueprint({ id: 'r', type: 'recursive' })
	if (blueprint.status !== 'valid')
		throw new Error('expected the method-only cycle to be a valid Blueprint')
	const runtime = blueprint.createRuntime()
	return { runtime, widget: runtime.getWidget('r')! }
}

function probeFreshRuntime(): unknown[] {
	const blueprint = counterSystem.createBlueprint({ id: 'c', type: 'counter' })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('c')!
	const seen: unknown[] = []
	widget.state.n.subscribe(value => seen.push(value))
	widget.state.n.set(1)
	widget.state.n.set(2)
	runtime.dispose()
	return seen
}

describe('runaway Method recursion', () => {
	it('escapes the outermost invocation as a RangeError', () => {
		const { widget } = createRecursiveRuntime()

		expect(() => widget.methods.ping())
			.toThrow(RangeError)
	})

	it('restores the alien-signals batch depth', () => {
		const { widget } = createRecursiveRuntime()

		expect(() => widget.methods.ping())
			.toThrow(RangeError)
		expect(getBatchDepth())
			.toBe(0)
	})

	it('restores the batch depth to its value at the outermost entry, not below it', () => {
		const { widget } = createRecursiveRuntime()

		startBatch()
		try {
			expect(() => widget.methods.ping())
				.toThrow(RangeError)
			expect(getBatchDepth())
				.toBe(1)
		}
		finally {
			endBatch()
		}
		expect(getBatchDepth())
			.toBe(0)
	})

	it('keeps notifying subscribers of another Runtime', () => {
		const { widget } = createRecursiveRuntime()

		expect(() => widget.methods.ping())
			.toThrow(RangeError)
		expect(probeFreshRuntime())
			.toEqual([1, 2])
	})

	it('flushes the writes committed before the overflow and keeps notifying this Runtime\'s subscribers', () => {
		const { widget } = createRecursiveRuntime()
		const sums: unknown[] = []
		const values: unknown[] = []
		widget.properties.sum.subscribe(result => sums.push(result.ok ? result.value : 'failed'))
		widget.state.a.subscribe(value => values.push(value))

		expect(() => widget.methods.ping())
			.toThrow(RangeError)

		// No rollback (Discussion #12 C0R18): the committed write stays and is still delivered.
		expect(widget.state.a.get())
			.toBe(1)
		expect(values)
			.toEqual([1])
		expect(sums)
			.toEqual([1])

		widget.state.a.set(5)

		expect(values)
			.toEqual([1, 5])
		expect(sums)
			.toEqual([1, 5])
	})
})
