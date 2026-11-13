/**
 * Observable shape of the State write path and the Method invoke path: the State inspection envelope is
 * frozen and identity-stable between changes, a Method's arguments reach `validateArgs` and `execute` as one
 * fresh array per invocation, and a thenable from any semantic callback names its callback in the error.
 */

import type { WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectRuntime } from '../inspection'

interface PathInterfaces extends WidgetInterfaces {
	state: { count: number }
	properties: { thenableProperty: number }
	methods: { echo: (...values: number[]) => number[], thenableMethod: () => number }
}

let validatedArgs: readonly unknown[] | null = null
let executedArgs: readonly unknown[] | null = null
let thenableValue = false
const thenable = { then: () => {} }

const path = createWidgetPlugin('path')
	.description('Test widget')
	.interfaces<PathInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => thenableValue ? (thenable as never) : typeof input === 'number',
		default: () => 0,
	}))
	.properties(properties => properties.thenableProperty({ compute: () => thenable as never }))
	.methods(methods => methods
		.echo({
			validateArgs: (args): args is number[] => {
				validatedArgs = args
				return true
			},
			execute: ({ args }) => {
				executedArgs = args
				return args
			},
		})
		.thenableMethod({ validateArgs: (args): args is [] => args.length === 0, execute: () => thenable as never }))
	.done()

const system = createWidgetSystem({ plugins: [path] })
const compiled = system.createBlueprint({ id: 'root', type: 'path' })
if (compiled.status !== 'valid')
	throw new Error('fixture setup error: expected a valid Blueprint')
const blueprint = compiled

function stateInspection(runtime: ReturnType<typeof blueprint.createRuntime>) {
	const inspection = inspectRuntime(runtime)
	return inspection.getWidget(inspection.blueprint.rootNodeId)!.getState('count')!
}

describe('state inspection envelope', () => {
	it('is frozen, equal to the current value and the same object until the value changes', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		const inspection = stateInspection(runtime)

		const initial = inspection.getSnapshot()
		expect(initial)
			.toEqual({ value: 0 })
		expect(Object.isFrozen(initial))
			.toBe(true)
		expect(inspection.getSnapshot())
			.toBe(initial)

		widget.state.count.set(0)
		expect(inspection.getSnapshot())
			.toBe(initial)

		widget.state.count.set(4)
		const changed = inspection.getSnapshot()
		expect(changed)
			.toEqual({ value: 4 })
		expect(changed)
			.not
			.toBe(initial)
		expect(Object.isFrozen(changed))
			.toBe(true)
		expect(inspection.getSnapshot())
			.toBe(changed)

		widget.state.count.set('x' as unknown as number)
		expect(inspection.getSnapshot())
			.toBe(changed)
	})

	it('delivers the very object getSnapshot() returns afterwards, and a new one after every change', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		const inspection = stateInspection(runtime)
		const delivered: unknown[] = []
		inspection.subscribe(snapshot => delivered.push(snapshot))

		widget.state.count.set(1)
		widget.state.count.set(2)
		widget.state.count.set(2)
		runtime.resetState()

		expect(delivered.map(snapshot => (snapshot as { value: number }).value))
			.toEqual([1, 2, 0])
		expect(delivered[2])
			.toBe(inspection.getSnapshot())
		expect(new Set(delivered).size)
			.toBe(3)
	})
})

describe('method invocation arguments', () => {
	it('hands validateArgs and execute the same fresh array holding the call\'s arguments', () => {
		const widget = blueprint.createRuntime()
			.getWidget('root')!

		widget.methods.echo(1, 2)
		const first = validatedArgs
		expect(first)
			.toEqual([1, 2])
		expect(executedArgs)
			.toBe(first)

		const result = widget.methods.echo(3)
		expect(result)
			.toEqual({ ok: true, value: [3] })
		expect(validatedArgs)
			.not
			.toBe(first)
		expect(first)
			.toEqual([1, 2])
		expect(executedArgs)
			.toBe(validatedArgs)
	})
})

describe('thenable from a semantic callback', () => {
	it('names the State, Property and Method callback in the error', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!

		expect(() => widget.properties.thenableProperty.get())
			.toThrow('Property "thenableProperty"\'s compute returned a thenable. The widget-core semantic boundary is synchronous only.')
		expect(() => widget.methods.thenableMethod())
			.toThrow('Method "thenableMethod"\'s execute returned a thenable. The widget-core semantic boundary is synchronous only.')
		thenableValue = true
		try {
			expect(() => widget.state.count.set(1))
				.toThrow('State "count"\'s validate returned a thenable. The widget-core semantic boundary is synchronous only.')
		}
		finally {
			thenableValue = false
		}
	})
})

describe('state inspection listeners writing the State again', () => {
	it('hands each listener the envelope that is current when it is called, also after an earlier listener wrote again', () => {
		const runtime = blueprint.createRuntime()
		const count = runtime.getWidget('root')!.state.count
		const state = stateInspection(runtime)
		const log: string[] = []
		state.subscribe((snapshot) => {
			log.push(`first:${snapshot.value}`)
			if (snapshot.value === 2)
				count.set(7)
		})
		state.subscribe((snapshot) => {
			log.push(`second:${snapshot.value}:${snapshot === state.getSnapshot() ? 'current' : 'stale'}`)
		})

		count.set(2)

		expect(log)
			.toEqual(['first:2', 'first:7', 'second:7:current', 'second:7:current'])
		expect(state.getSnapshot())
			.toEqual({ value: 7 })
	})
})
