/**
 * Conformance tests for issue #10 COMMENT 26 §9 — the latest-completed issue snapshot lifecycle,
 * exercised across every Runtime primitive that owns one (State, Property, Method).
 *
 * Normative source: consolidated handoff §16 ("success -> canonical EMPTY_ISSUES", "failure ->
 * failure replaces snapshot", "callback throw -> in-progress collector discarded; previous completed
 * snapshot preserved") and COMMENT 4 ("the canonical empty snapshot identity is intentionally reused
 * so success->success does not emit issue notifications").
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_ISSUES } from '../index'

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
		.interfaces<SnapshotInterfaces>()
		.state(state => state
			.count({
				validate: (input, ctx): input is number => {
					if (stateThrowNow) {
						stateThrowNow = false
						throw new Error('state validate boom')
					}
					if (typeof input !== 'number') {
						ctx.addIssue({ message: `invalid count: ${JSON.stringify(input)}` })
						return false
					}
					return true
				},
				default: () => 0,
			}))
		.properties(properties => properties
			.doubled({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps, addIssue }) => {
					if (propertyThrowNow) {
						propertyThrowNow = false
						throw new Error('property boom')
					}
					const result = deps.count()
					const value = result.success ? result.value ?? 0 : 0
					if (propertyFailNow)
						addIssue({ message: `doubled failed at ${value}` })
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
				execute: ({ deps, addIssue }) => {
					if (methodThrowNow) {
						methodThrowNow = false
						throw new Error('method boom')
					}
					const current = deps.get()
					const next = (current.success ? current.value ?? 0 : 0) + 1
					deps.set(next)
					if (methodFailNow)
						addIssue({ message: `bump failed at ${next}` })
					return next
				},
			}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'counter' })

	if (blueprint.status !== 'valid')
		throw new Error(`Expected a valid blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

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

describe('latest-completed issue snapshot — success commits the canonical empty snapshot', () => {
	it('runtimeState: repeated successful writes reuse the exact canonical EMPTY_ISSUES reference', () => {
		const { widget } = createHarness()

		expect(widget.state.count.getIssues())
			.toBe(EMPTY_ISSUES)

		widget.state.count.set(5)
		expect(widget.state.count.getIssues())
			.toBe(EMPTY_ISSUES)

		widget.state.count.set(6)
		expect(widget.state.count.getIssues())
			.toBe(EMPTY_ISSUES)
	})

	it('runtimeProperty: repeated actual successful recomputes reuse the exact canonical EMPTY_ISSUES reference', () => {
		const { widget } = createHarness()

		expect(widget.properties.doubled.get())
			.toEqual({ success: true, value: 0 })
		expect(widget.properties.doubled.getIssues())
			.toBe(EMPTY_ISSUES)

		// Force a second, genuinely different, successful recompute.
		widget.state.count.set(5)
		expect(widget.properties.doubled.get())
			.toEqual({ success: true, value: 10 })
		expect(widget.properties.doubled.getIssues())
			.toBe(EMPTY_ISSUES)
	})

	it('runtimeMethod: repeated successful invocations reuse the exact canonical EMPTY_ISSUES reference', () => {
		const { widget } = createHarness()

		expect(widget.methods.bump())
			.toEqual({ success: true, value: 1 })
		expect(widget.methods.bump.getIssues())
			.toBe(EMPTY_ISSUES)

		expect(widget.methods.bump())
			.toEqual({ success: true, value: 2 })
		expect(widget.methods.bump.getIssues())
			.toBe(EMPTY_ISSUES)
	})
})

describe('latest-completed issue snapshot — failure replaces rather than appends', () => {
	it('runtimeState: a second, differently-shaped failure replaces the first snapshot instead of accumulating', () => {
		const { widget } = createHarness()

		const first = widget.state.count.set('a' as unknown as number)
		expect(first.success)
			.toBe(false)
		expect(widget.state.count.getIssues())
			.toHaveLength(1)
		const firstMessage = widget.state.count.getIssues()[0]!.message

		const second = widget.state.count.set('b' as unknown as number)
		expect(second.success)
			.toBe(false)
		const snapshot = widget.state.count.getIssues()
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
		expect(first.success)
			.toBe(false)
		const firstIssues = widget.properties.doubled.getIssues()
		expect(firstIssues)
			.toHaveLength(1)

		// Force another actual recompute; still failing, but with a different diagnosed value.
		widget.state.count.set(7)
		const second = widget.properties.doubled.get()
		expect(second.success)
			.toBe(false)
		const secondIssues = widget.properties.doubled.getIssues()
		expect(secondIssues)
			.toHaveLength(1)
		expect(secondIssues[0]!.message)
			.not.toBe(firstIssues[0]!.message)
	})

	it('runtimeMethod: a second, differently-shaped failure replaces the first snapshot instead of accumulating', () => {
		const { widget, setMethodFailNow } = createHarness()
		setMethodFailNow(true)

		const first = widget.methods.bump()
		expect(first.success)
			.toBe(false)
		const firstIssues = widget.methods.bump.getIssues()
		expect(firstIssues)
			.toHaveLength(1)

		const second = widget.methods.bump()
		expect(second.success)
			.toBe(false)
		const secondIssues = widget.methods.bump.getIssues()
		expect(secondIssues)
			.toHaveLength(1)
		expect(secondIssues[0]!.message)
			.not.toBe(firstIssues[0]!.message)
	})
})

describe('latest-completed issue snapshot — a semantic callback throw discards the in-progress collector', () => {
	it('runtimeState: a validate() throw leaves the previous completed snapshot untouched', () => {
		const { widget, setStateThrowNow } = createHarness()

		expect(widget.state.count.getIssues())
			.toBe(EMPTY_ISSUES)

		setStateThrowNow(true)
		expect(() => widget.state.count.set(9))
			.toThrow('state validate boom')

		expect(widget.state.count.getIssues())
			.toBe(EMPTY_ISSUES)
	})

	it('runtimeProperty: a compute() throw leaves the previous completed snapshot untouched', () => {
		const { widget, setPropertyThrowNow } = createHarness()

		expect(widget.properties.doubled.get())
			.toEqual({ success: true, value: 0 })
		expect(widget.properties.doubled.getIssues())
			.toBe(EMPTY_ISSUES)

		setPropertyThrowNow(true)
		widget.state.count.set(3) // force a fresh recompute attempt
		expect(() => widget.properties.doubled.get())
			.toThrow('property boom')

		expect(widget.properties.doubled.getIssues())
			.toBe(EMPTY_ISSUES)
	})

	it('runtimeMethod: an execute() throw leaves the previous completed snapshot untouched', () => {
		const { widget, setMethodThrowNow } = createHarness()

		expect(widget.methods.bump())
			.toEqual({ success: true, value: 1 })
		expect(widget.methods.bump.getIssues())
			.toBe(EMPTY_ISSUES)

		setMethodThrowNow(true)
		expect(() => widget.methods.bump())
			.toThrow('method boom')

		expect(widget.methods.bump.getIssues())
			.toBe(EMPTY_ISSUES)
	})
})
