/**
 * Conformance tests for diagnostic #10 COMMENT 26 §9 — the latest-completed diagnostic snapshot lifecycle,
 * exercised across every Runtime primitive that owns one (State, Property, Method).
 *
 * Normative source: consolidated handoff §16 ("ok -> canonical EMPTY_DIAGNOSTICS", "failure ->
 * failure replaces snapshot", "callback throw -> in-progress collector discarded; previous completed
 * snapshot preserved") and COMMENT 4 ("the canonical empty snapshot identity is intentionally reused
 * so ok->ok does not emit diagnostic notifications").
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_DIAGNOSTICS } from '../index'

interface SnapshotInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
	methods: {
		bump: () => number
	}
}

function createHarness() {
	let stateThrowNow = false
	let propertyThrowNow = false
	let methodThrowNow = false
	let propertyFailNow = false
	let methodFailNow = false

	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<SnapshotInterfaces>()
		.state(state => state
			.count({
				validate: (input, ctx): input is number => {
					if (stateThrowNow) {
						stateThrowNow = false
						throw new Error('state validate boom')
					}
					if (typeof input !== 'number') {
						ctx.addDiagnostic({ message: `invalid count: ${JSON.stringify(input)}` })
						return false
					}
					return true
				},
				default: () => 0,
			}))
		.properties(properties => properties
			.doubled({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps, addDiagnostic }) => {
					if (propertyThrowNow) {
						propertyThrowNow = false
						throw new Error('property boom')
					}
					const result = deps.count()
					const value = result.ok ? result.value ?? 0 : 0
					if (propertyFailNow)
						addDiagnostic({ message: `doubled failed at ${value}` })
					return value * 2
				},
			}))
		.methods(methods => methods
			.bump({
				registerDeps: ({ dep }) => ({
					get: dep.self.state.get('count'),
					set: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, addDiagnostic }) => {
					if (methodThrowNow) {
						methodThrowNow = false
						throw new Error('method boom')
					}
					const current = deps.get()
					const next = (current.ok ? current.value ?? 0 : 0) + 1
					deps.set(next)
					if (methodFailNow)
						addDiagnostic({ message: `bump failed at ${next}` })
					return next
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })

	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')

	if (widget === null)
		throw new Error('Expected the "root" widget to exist.')

	return {
		runtime,
		widget,
		setStateThrowNow: (value: boolean) => {
			stateThrowNow = value
		},
		setPropertyThrowNow: (value: boolean) => {
			propertyThrowNow = value
		},
		setMethodThrowNow: (value: boolean) => {
			methodThrowNow = value
		},
		setPropertyFailNow: (value: boolean) => {
			propertyFailNow = value
		},
		setMethodFailNow: (value: boolean) => {
			methodFailNow = value
		},
	}
}

describe('latest-completed diagnostic snapshot — ok commits the canonical empty snapshot', () => {
	it('runtimeState: repeated successful writes reuse the exact canonical EMPTY_DIAGNOSTICS reference', () => {
		const { widget } = createHarness()

		expect(widget.state.count.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		widget.state.count.set(5)
		expect(widget.state.count.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		widget.state.count.set(6)
		expect(widget.state.count.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})

	it('runtimeProperty: repeated actual successful recomputes reuse the exact canonical EMPTY_DIAGNOSTICS reference', () => {
		const { widget } = createHarness()

		expect(widget.properties.doubled.get())
			.toEqual({ ok: true, value: 0 })
		expect(widget.properties.doubled.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		// Force a second, genuinely different, successful recompute.
		widget.state.count.set(5)
		expect(widget.properties.doubled.get())
			.toEqual({ ok: true, value: 10 })
		expect(widget.properties.doubled.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})

	it('runtimeMethod: repeated successful invocations reuse the exact canonical EMPTY_DIAGNOSTICS reference', () => {
		const { widget } = createHarness()

		expect(widget.methods.bump())
			.toEqual({ ok: true, value: 1 })
		expect(widget.methods.bump.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		expect(widget.methods.bump())
			.toEqual({ ok: true, value: 2 })
		expect(widget.methods.bump.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})
})

describe('latest-completed diagnostic snapshot — failure replaces rather than appends', () => {
	it('runtimeState: a second, differently-shaped failure replaces the first snapshot instead of accumulating', () => {
		const { widget } = createHarness()

		const first = widget.state.count.set('a' as unknown as number)
		expect(first.ok)
			.toBe(false)
		expect(widget.state.count.getDiagnostics())
			.toHaveLength(1)
		const firstMessage = widget.state.count.getDiagnostics()[0]!.message

		const second = widget.state.count.set('b' as unknown as number)
		expect(second.ok)
			.toBe(false)
		const snapshot = widget.state.count.getDiagnostics()
		expect(snapshot)
			.toHaveLength(1)
		expect(snapshot[0]!.message)
			.not.toBe(firstMessage)
	})

	it('runtimeProperty: a second, differently-shaped failure replaces the first snapshot instead of accumulating', () => {
		const { widget, setPropertyFailNow } = createHarness()
		setPropertyFailNow(true)

		widget.state.count.set(5)
		const first = widget.properties.doubled.get()
		expect(first.ok)
			.toBe(false)
		const firstDiagnostics = widget.properties.doubled.getDiagnostics()
		expect(firstDiagnostics)
			.toHaveLength(1)

		// Force another actual recompute; still failing, but with a different diagnosed value.
		widget.state.count.set(7)
		const second = widget.properties.doubled.get()
		expect(second.ok)
			.toBe(false)
		const secondDiagnostics = widget.properties.doubled.getDiagnostics()
		expect(secondDiagnostics)
			.toHaveLength(1)
		expect(secondDiagnostics[0]!.message)
			.not.toBe(firstDiagnostics[0]!.message)
	})

	it('runtimeMethod: a second, differently-shaped failure replaces the first snapshot instead of accumulating', () => {
		const { widget, setMethodFailNow } = createHarness()
		setMethodFailNow(true)

		const first = widget.methods.bump()
		expect(first.ok)
			.toBe(false)
		const firstDiagnostics = widget.methods.bump.getDiagnostics()
		expect(firstDiagnostics)
			.toHaveLength(1)

		const second = widget.methods.bump()
		expect(second.ok)
			.toBe(false)
		const secondDiagnostics = widget.methods.bump.getDiagnostics()
		expect(secondDiagnostics)
			.toHaveLength(1)
		expect(secondDiagnostics[0]!.message)
			.not.toBe(firstDiagnostics[0]!.message)
	})
})

describe('latest-completed diagnostic snapshot — a semantic callback throw discards the in-progress collector', () => {
	it('runtimeState: a validate() throw leaves the previous completed snapshot untouched', () => {
		const { widget, setStateThrowNow } = createHarness()

		expect(widget.state.count.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		setStateThrowNow(true)
		expect(() => widget.state.count.set(9))
			.toThrow('state validate boom')

		expect(widget.state.count.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})

	it('runtimeProperty: a compute() throw leaves the previous completed snapshot untouched', () => {
		const { widget, setPropertyThrowNow } = createHarness()

		expect(widget.properties.doubled.get())
			.toEqual({ ok: true, value: 0 })
		expect(widget.properties.doubled.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		setPropertyThrowNow(true)
		widget.state.count.set(3) // force a fresh recompute attempt
		expect(() => widget.properties.doubled.get())
			.toThrow('property boom')

		expect(widget.properties.doubled.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})

	it('runtimeMethod: an execute() throw leaves the previous completed snapshot untouched', () => {
		const { widget, setMethodThrowNow } = createHarness()

		expect(widget.methods.bump())
			.toEqual({ ok: true, value: 1 })
		expect(widget.methods.bump.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)

		setMethodThrowNow(true)
		expect(() => widget.methods.bump())
			.toThrow('method boom')

		expect(widget.methods.bump.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})
})
