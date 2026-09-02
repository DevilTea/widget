/**
 * Conformance tests for `RuntimeMethod` — diagnostic #10 COMMENT 26 §8 (Method section).
 *
 * Normative source: consolidated handoff §15 (`RuntimeMethod`), §12 (dependency-failure 1:1
 * wrapping, absent-target materialization), COMMENT 4 (`ExecutionResult` semantics, "diagnostic
 * context only, not a degraded ok value").
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface MethodInterfaces {
	state: {
		count: number
	}
	methods: {
		guarded: (flag: boolean) => number
		ping: () => number
		flakyExecute: () => boolean
		viaFlaky: () => number
		incrementViaDep: () => number
		viaAbsentParent: () => unknown
	}
}

function createHarness() {
	let guardedValidateArgsCount = 0
	let guardedExecuteCount = 0
	let pingValidateArgsCount = 0
	let pingExecuteCount = 0
	let flakyExecuteCount = 0
	let flakyShouldFail = false

	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<MethodInterfaces>()
		.state(state => state
			.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
		.methods(methods => methods
			.guarded({
				validateArgs: (args): args is [boolean] => {
					guardedValidateArgsCount++
					return args.length === 1 && typeof args[0] === 'boolean'
				},
				execute: ({ args }) => {
					guardedExecuteCount++
					return args[0] ? 1 : 0
				},
			})
			.ping({
				validateArgs: (args): args is [] => {
					pingValidateArgsCount++
					return args.length === 0
				},
				execute: () => {
					pingExecuteCount++
					return 1
				},
			})
			.flakyExecute({
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ addDiagnostic }) => {
					flakyExecuteCount++
					if (flakyShouldFail)
						addDiagnostic({ message: 'flaky execute failed' })
					// Deliberately returns a truthy/ok-looking value even while failing: presence of
					// diagnostics, not the returned value, decides the ExecutionResult outcome.
					return true
				},
			})
			.viaFlaky({
				registerDeps: ({ dep }) => ({ flaky: dep.self.methods.invoke('flakyExecute') }),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					const result = deps.flaky()
					return result.ok ? 1 : 0
				},
			})
			.incrementViaDep({
				registerDeps: ({ dep }) => ({
					get: dep.self.state.get('count'),
					set: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					const current = deps.get()
					const next = (current.ok ? current.value ?? 0 : 0) + 1
					deps.set(next)
					return next
				},
			})
			.viaAbsentParent({
				registerDeps: ({ dep }) => ({
					read: dep.parent.optional().state.get('anything'),
					invoke: dep.parent.optional().methods.invoke('anything'),
					write: dep.parent.optional().state.set('anything'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => ({
					read: deps.read(),
					invoke: deps.invoke(),
					write: deps.write(42),
				}),
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
		counters: () => ({
			guardedValidateArgsCount,
			guardedExecuteCount,
			pingValidateArgsCount,
			pingExecuteCount,
			flakyExecuteCount,
		}),
		setFlakyShouldFail: (value: boolean) => {
			flakyShouldFail = value
		},
	}
}

describe('runtimeMethod', () => {
	it('a validateArgs failure prevents execute from ever running', () => {
		const { widget, counters } = createHarness()

		// @ts-expect-error — deliberately wrong argument type to trigger a validateArgs rejection.
		const result = widget.methods.guarded(123)

		expect(result.ok)
			.toBe(false)
		expect(counters().guardedExecuteCount)
			.toBe(0)
	})

	it('a successful validateArgs allows execute and returns a ok ExecutionResult', () => {
		const { widget, counters } = createHarness()

		const result = widget.methods.guarded(true)

		expect(result)
			.toEqual({ ok: true, value: 1 })
		expect(counters().guardedExecuteCount)
			.toBe(1)
	})

	it('validateArgs is still invoked for a zero-argument method', () => {
		const { widget, counters } = createHarness()

		const result = widget.methods.ping()

		expect(counters().pingValidateArgsCount)
			.toBe(1)
		expect(counters().pingExecuteCount)
			.toBe(1)
		expect(result)
			.toEqual({ ok: true, value: 1 })
	})

	it('plugin addDiagnostic diagnostics during execute produce operation failure even when the callback returns a truthy value', () => {
		const { widget, setFlakyShouldFail } = createHarness()

		expect(widget.methods.flakyExecute())
			.toEqual({ ok: true, value: true })

		setFlakyShouldFail(true)
		const result = widget.methods.flakyExecute()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
		const diagnostic = result.failure.diagnostics[0]
		expect(diagnostic.code)
			.toBe('invalid-method-result')
		if (diagnostic.code !== 'invalid-method-result')
			throw new Error('Expected a method-result diagnostic.')
		// The callback's own truthy return value is diagnostic context only, never a degraded ok.
		expect(diagnostic.result)
			.toBe(true)
		expect(diagnostic.message)
			.toBe('flaky execute failed')
	})

	it('a dependency failure becomes a method-dependency diagnostic wrapped 1:1 from the direct target', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.methods.viaFlaky()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
		const diagnostic = result.failure.diagnostics[0]
		expect(diagnostic.code)
			.toBe('dependency-target-failed')
		if (!('dependency' in diagnostic))
			throw new Error('Expected a method-dependency diagnostic.')

		expect(diagnostic.location.widgetId)
			.toBe('root')
		expect(diagnostic.location.name)
			.toBe('viaFlaky')
		expect(diagnostic.dependency)
			.toEqual({
				target: { type: 'self' },
				operation: { type: 'method-invoke', name: 'flakyExecute' },
			})
		expect(diagnostic.related)
			.toEqual([{ type: 'method', widgetId: 'root', name: 'flakyExecute' }])
		expect(diagnostic.message)
			.toBe('flaky execute failed')
	})

	it('a state.set dependency writes through the method pipeline and the write is externally observable', () => {
		const { widget } = createHarness()

		const result = widget.methods.incrementViaDep()

		expect(result)
			.toEqual({ ok: true, value: 1 })
		expect(widget.state.count.get())
			.toBe(1)

		const second = widget.methods.incrementViaDep()
		expect(second)
			.toEqual({ ok: true, value: 2 })
		expect(widget.state.count.get())
			.toBe(2)
	})

	it('an absent optional dependency materializes reads/invocations as ok(null) and state.set as a no-op ok(candidate)', () => {
		const { widget } = createHarness()

		const result = widget.methods.viaAbsentParent()

		expect(result.ok)
			.toBe(true)
		if (!result.ok)
			throw new Error('Expected a ok result.')

		expect(result.value)
			.toEqual({
				read: { ok: true, value: null },
				invoke: { ok: true, value: null },
				write: { ok: true, value: 42 },
			})
	})
})

describe('runtimeMethod — the wrapper is callable and exposes the diagnostic surface', () => {
	it('exposes getDiagnostics()/subscribeDiagnostics() alongside the call signature', () => {
		const { widget } = createHarness()

		expect(typeof widget.methods.ping)
			.toBe('function')
		expect(typeof widget.methods.ping.getDiagnostics)
			.toBe('function')
		expect(typeof widget.methods.ping.subscribeDiagnostics)
			.toBe('function')
		expect(widget.methods.ping.getDiagnostics())
			.toEqual([])

		const listener = vi.fn()
		widget.methods.ping.subscribeDiagnostics(listener)
		expect(listener)
			.not.toHaveBeenCalled()
	})
})
