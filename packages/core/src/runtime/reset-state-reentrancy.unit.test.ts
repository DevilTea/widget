/**
 * `resetState()` called from inside Runtime code (a listener, a Property `compute`) behaves exactly as a
 * reset that visits every State: such a reset reads each State's signal, so it is tracked by the running
 * computed and it commits whatever an enclosing write has not committed yet.
 */

import type { WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

const isNumber = (input: unknown): input is number => typeof input === 'number'

describe('resetState inside a listener of the write that is still running', () => {
	interface BadDefaultInterfaces extends WidgetInterfaces {
		state: { a: number }
	}

	const badDefault = createWidgetPlugin('bad-default')
		.description('Test widget')
		.interfaces<BadDefaultInterfaces>()
		.state(state => state.a({ validate: isNumber, default: () => 'bad' as unknown as number }))
		.done()
	const badDefaultBlueprint = createWidgetSystem({ plugins: [badDefault] })
		.createBlueprint({ id: 'root', type: 'bad-default' })
	if (badDefaultBlueprint.status !== 'valid')
		throw new Error('fixture setup error: expected a valid Blueprint')

	it('still restores the failed initialization diagnostics of a State a listener reset while it was written', () => {
		const runtime = badDefaultBlueprint.createRuntime()
		const a = runtime.getWidget('root')!.state.a
		const codes = () => a.getDiagnostics()
			.map(diagnostic => diagnostic.code)
		expect(codes())
			.toEqual(['invalid-state-value'])
		let reset = false
		a.subscribe(() => {
			if (!reset) {
				reset = true
				runtime.resetState()
			}
		})

		a.set(2)
		expect(codes())
			.toEqual([])

		runtime.resetState()
		expect(a.get())
			.toBeNull()
		expect(codes())
			.toEqual(['invalid-state-value'])
	})

	interface UnsetInterfaces extends WidgetInterfaces {
		state: { n: number, u: number, m: number }
	}

	const unset = createWidgetPlugin('unset')
		.description('Test widget')
		.interfaces<UnsetInterfaces>()
		.state(state => state
			.n({ validate: isNumber, default: () => Number.NaN })
			.u({ validate: isNumber })
			.m({ validate: isNumber, default: () => Number.NaN }))
		.done()
	const unsetBlueprint = createWidgetSystem({ plugins: [unset] })
		.createBlueprint({ id: 'root', type: 'unset' })
	if (unsetBlueprint.status !== 'valid')
		throw new Error('fixture setup error: expected a valid Blueprint')

	it('still notifies the subscribers when a later reset restores States a listener-triggered reset left uncommitted', () => {
		const runtime = unsetBlueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		const log: string[] = []
		for (const key of ['n', 'u', 'm'] as const) {
			widget.state[key].subscribe((value) => {
				log.push(`${key}=${value}`)
				if (key === 'u')
					runtime.resetState()
			})
		}

		widget.state.u.set(0)
		log.push('--reset')
		runtime.resetState()

		expect(log)
			.toEqual(['u=0', 'n=NaN', 'm=NaN', '--reset', 'n=NaN', 'u=null', 'm=NaN', 'n=NaN'])
		expect(widget.state.u.get())
			.toBeNull()
	})
})

describe('resetState inside a Property compute', () => {
	interface ComputeInterfaces extends WidgetInterfaces {
		state: { a: number, b: number }
		properties: { r: number }
	}

	let runtimeRef: { resetState: () => void } | null = null
	let computes = 0
	const plugin = createWidgetPlugin('reset-in-compute')
		.description('Test widget')
		.interfaces<ComputeInterfaces>()
		.state(state => state
			.a({ validate: isNumber, default: () => 1 })
			.b({ validate: isNumber, default: () => 2 }))
		.properties(properties => properties.r({
			compute: () => {
				runtimeRef!.resetState()
				return ++computes
			},
		}))
		.done()
	const blueprint = createWidgetSystem({ plugins: [plugin] })
		.createBlueprint({ id: 'root', type: 'reset-in-compute' })
	if (blueprint.status !== 'valid')
		throw new Error('fixture setup error: expected a valid Blueprint')

	it('makes the Property depend on every State, so a later write recomputes it and the reset undoes the write', () => {
		computes = 0
		const runtime = blueprint.createRuntime()
		runtimeRef = runtime
		const widget = runtime.getWidget('root')!
		const notified: unknown[] = []
		widget.properties.r.subscribe(result => notified.push(result.ok ? result.value : null))

		expect(widget.properties.r.get())
			.toEqual({ ok: true, value: 1 })
		expect(widget.state.b.set(5))
			.toEqual({ ok: true, value: 5 })

		expect(notified)
			.toEqual([3])
		expect(widget.state.b.get())
			.toBe(2)
		expect(widget.properties.r.get())
			.toEqual({ ok: true, value: 3 })
		expect(computes)
			.toBe(3)
	})
})

describe('resetState after a reset ran inside the flush of a Method write', () => {
	interface PutInterfaces extends WidgetInterfaces {
		state: { t: unknown }
		methods: { put: (value: unknown) => unknown }
	}

	const put = createWidgetPlugin('put')
		.description('Test widget')
		.interfaces<PutInterfaces>()
		.state(state => state.t({ validate: (input): input is unknown => typeof input === 'string' || typeof input === 'object', default: () => 'x' }))
		.methods(methods => methods.put({
			registerDeps: ({ dep }) => ({ setT: dep.self.state.set('t') }),
			validateArgs: (args): args is [unknown] => args.length === 1,
			execute: ({ deps, args }) => deps.setT(args[0]),
		}))
		.done()
	const putBlueprint = createWidgetSystem({ plugins: [put] })
		.createBlueprint({ id: 'root', type: 'put' })
	if (putBlueprint.status !== 'valid')
		throw new Error('fixture setup error: expected a valid Blueprint')

	it('still tells a subscriber the restored value the nested reset could not deliver while it was running', () => {
		const runtime = putBlueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		const log: string[] = []
		let reset = false
		widget.state.t.subscribe((value) => {
			log.push(`t=${JSON.stringify(value)}`)
			if (!reset) {
				reset = true
				runtime.resetState()
			}
		})

		widget.methods.put({ o: 1 })
		log.push('--widget reset')
		widget.resetState()

		expect(log)
			.toEqual(['t={"o":1}', '--widget reset', 't="x"'])
		expect(widget.state.t.get())
			.toBe('x')
	})
})
