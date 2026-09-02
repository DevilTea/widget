/**
 * Conformance tests for diagnostic #10 COMMENT 26 §10 — the `RuntimeMethod` invocation as an
 * `alien-signals` batch boundary, observed only through public behavior.
 *
 * Normative source: consolidated handoff §15, amendment "RuntimeMethod invocation as alien-signals
 * batch boundary" (COMMENT 17): one batch per invocation, nested invocations nest depth and only the
 * outermost flushes, synchronous reads inside the batch observe the latest writes, and batching is
 * propagation atomicity only — not a transaction/rollback.
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface BatchInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
	methods: {
		bumpTwice: () => number
		inner: () => number
		outer: () => number
		syncRead: () => number | null
		propertyRecompute: () => number | null
		failAfterWrite: () => number
		throwAfterWrite: () => number
	}
}

function createHarness() {
	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<BatchInterfaces>()
		.state(state => state
			.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			}))
		.properties(properties => properties
			.doubled({
				registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
				compute: ({ deps }) => {
					const result = deps.count()
					return result.ok ? (result.value ?? 0) * 2 : -1
				},
			}))
		.methods(methods => methods
			.bumpTwice({
				registerDeps: ({ dep }) => ({
					get: dep.self.state.get('count'),
					set: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					const current = deps.get()
					const base = current.ok ? current.value ?? 0 : 0
					deps.set(base + 1)
					deps.set(base + 2)
					return base + 2
				},
			})
			.inner({
				registerDeps: ({ dep }) => ({
					get: dep.self.state.get('count'),
					set: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					const current = deps.get()
					const next = (current.ok ? current.value ?? 0 : 0) + 10
					deps.set(next)
					return next
				},
			})
			.outer({
				registerDeps: ({ dep }) => ({
					invokeInner: dep.self.methods.invoke('inner'),
					get: dep.self.state.get('count'),
					set: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps.invokeInner()
					const current = deps.get()
					const next = (current.ok ? current.value ?? 0 : 0) + 1
					deps.set(next)
					return next
				},
			})
			.syncRead({
				registerDeps: ({ dep }) => ({
					get: dep.self.state.get('count'),
					set: dep.self.state.set('count'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps.set(999)
					const after = deps.get()
					return after.ok ? after.value : null
				},
			})
			.propertyRecompute({
				registerDeps: ({ dep }) => ({
					set: dep.self.state.set('count'),
					doubled: dep.self.properties.get('doubled'),
				}),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps.set(50)
					const result = deps.doubled()
					return result.ok ? result.value : null
				},
			})
			.failAfterWrite({
				registerDeps: ({ dep }) => ({ set: dep.self.state.set('count') }),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, addDiagnostic }) => {
					deps.set(777)
					addDiagnostic({ message: 'semantic failure after a committed write' })
					return 0
				},
			})
			.throwAfterWrite({
				registerDeps: ({ dep }) => ({ set: dep.self.state.set('count') }),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps.set(888)
					throw new Error('implementation exception after a committed write')
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

	return { runtime, widget }
}

describe('runtimeMethod as an alien-signals batch boundary', () => {
	it('multiple writes inside one Method invocation are collapsed into a single external notification of only the final value', () => {
		const { widget } = createHarness()
		const listener = vi.fn()
		widget.state.count.subscribe(listener)

		const result = widget.methods.bumpTwice()

		expect(result)
			.toEqual({ ok: true, value: 2 })
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener)
			.toHaveBeenCalledWith(2)
	})

	it('a nested dependency-invoked Method does not flush before the outermost invocation boundary', () => {
		const { widget } = createHarness()
		const listener = vi.fn()
		widget.state.count.subscribe(listener)

		const result = widget.methods.outer()

		// inner writes count -> 10, outer then writes count -> 11; only one stabilized notification for
		// the whole nested call, carrying the final value only.
		expect(result)
			.toEqual({ ok: true, value: 11 })
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener)
			.toHaveBeenCalledWith(11)
	})

	it('a synchronous read inside the batch observes the latest write from earlier in the same invocation', () => {
		const { widget } = createHarness()

		const result = widget.methods.syncRead()

		expect(result)
			.toEqual({ ok: true, value: 999 })
	})

	it('an explicit Property get inside a Method recomputes against the batch\'s pending writes', () => {
		const { widget } = createHarness()

		const result = widget.methods.propertyRecompute()

		expect(result)
			.toEqual({ ok: true, value: 100 })
	})

	it('is not rollback/transaction semantics: a later semantic failure does not undo an already-committed write', () => {
		const { widget } = createHarness()

		const result = widget.methods.failAfterWrite()

		expect(result.ok)
			.toBe(false)
		expect(widget.state.count.get())
			.toBe(777)
	})

	it('is not rollback/transaction semantics: a later implementation exception does not undo an already-committed write', () => {
		const { widget } = createHarness()

		expect(() => widget.methods.throwAfterWrite())
			.toThrow('implementation exception after a committed write')
		expect(widget.state.count.get())
			.toBe(888)
	})

	it('a direct public RuntimeState.set() outside of any Method also propagates normally to external subscribers', () => {
		const { widget } = createHarness()
		const listener = vi.fn()
		widget.state.count.subscribe(listener)

		const result = widget.state.count.set(42)

		expect(result)
			.toEqual({ ok: true, value: 42 })
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(listener)
			.toHaveBeenCalledWith(42)
	})
})
