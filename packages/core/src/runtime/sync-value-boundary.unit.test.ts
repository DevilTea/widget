/**
 * Regression coverage for PR #12 review finding 3773363789 (`runtime/state.ts` thenable state value)
 * and the runtime-side half of pass-1 finding 3773310833 (missing sync-boundary assertions on
 * `state.validate`, `state.default` and `method.validateArgs`).
 *
 * `runtime/contract-violations.unit.test.ts` already covers `property.compute` / `method.execute`
 * returning a thenable. This file covers the remaining framework-owned synchronous callbacks plus the
 * new amendment: even once a candidate has been *accepted* by `state.validate`, it must not become the
 * live State value if it is itself a `PromiseLike` — that is an implementation-contract throw (the same
 * `assertSyncValue` shape as every other sync-boundary violation), never an ordinary validation
 * failure. A candidate *rejected* by `state.validate` stays an ordinary validation failure even when it
 * happens to be thenable.
 *
 * Normative source: diagnostic #10 amendment "synchronous core boundary and future async seams" (COMMENT
 * 16) — "top-level semantic execution values must not be PromiseLike ... state values" — and
 * consolidated handoff §16.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

/** Asserts `caught` is a plain implementation exception: never an Diagnostic, never an ExecutionResult. */
function expectPlainException(caught: unknown): void {
	expect(caught)
		.toBeInstanceOf(Error)
	const record = caught as Record<string, unknown>
	expect(record.ok)
		.toBeUndefined()
	expect(record.diagnostics)
		.toBeUndefined()
	expect(record.source)
		.toBeUndefined()
}

function captureThrow(action: () => unknown): { readonly caught: unknown, readonly threw: boolean, readonly returned: unknown } {
	try {
		const returned = action()
		return { caught: undefined, threw: false, returned }
	}
	catch (error) {
		return { caught: error, threw: true, returned: undefined }
	}
}

describe('state.validate returning a thenable (async validator) is a sync-boundary violation', () => {
	interface AsyncValidateInterfaces {
		state: {
			count: number
		}
	}

	function createRuntime() {
		const plugin = createWidgetPlugin('async-validate')
			.description('Test widget')
			.interfaces<AsyncValidateInterfaces>()
			.state(state => state.count({
				// `validate()`'s return type is `boolean`, but nothing stops a misbehaving async
				// validator implementation from returning a `Promise` (itself truthy) at runtime.
				validate: (input): input is number => {
					if (input === 'ASYNC')
						return Promise.resolve(true) as unknown as boolean
					return typeof input === 'number'
				},
				default: () => 0,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'async-validate' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')
		return { widget }
	}

	it('throws synchronously via .set() instead of being used as a boolean', () => {
		const { widget } = createRuntime()

		const { caught, threw } = captureThrow(() => widget.state.count.set('ASYNC' as unknown as number))

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		// The previous accepted value stays untouched: the throw preempts any commit.
		expect(widget.state.count.get())
			.toBe(0)
	})
})

describe('method.validateArgs returning a thenable (async validator) is a sync-boundary violation', () => {
	interface AsyncArgsInterfaces {
		methods: {
			run: (n: number) => number
		}
	}

	function createRuntime() {
		let executeCount = 0

		const plugin = createWidgetPlugin('async-args')
			.description('Test widget')
			.interfaces<AsyncArgsInterfaces>()
			.methods(methods => methods.run({
				validateArgs: (args): args is [number] => {
					if (args[0] === -1)
						return Promise.resolve(true) as unknown as boolean
					return args.length === 1 && typeof args[0] === 'number'
				},
				execute: ({ args }) => {
					executeCount++
					return args[0]
				},
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'async-args' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')
		return { widget, executeCount: () => executeCount }
	}

	it('throws synchronously via the method call, and execute never runs', () => {
		const { widget, executeCount } = createRuntime()

		const { caught, threw } = captureThrow(() => widget.methods.run(-1))

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		expect(executeCount())
			.toBe(0)
	})
})

describe('state.default returning a thenable is a sync-boundary violation at Runtime creation', () => {
	interface DefaultThenableInterfaces {
		state: {
			count: number
		}
	}

	it('makes blueprint.createRuntime() itself throw synchronously', () => {
		const plugin = createWidgetPlugin('default-thenable')
			.description('Test widget')
			.interfaces<DefaultThenableInterfaces>()
			.state(state => state.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => Promise.resolve(1) as unknown as number,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'default-thenable' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const { caught, threw } = captureThrow(() => blueprint.createRuntime())

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
	})
})

describe('an accepted thenable candidate must not become the live State value', () => {
	interface AcceptsAnythingInterfaces {
		state: {
			anything: unknown
		}
	}

	function createRuntime() {
		const plugin = createWidgetPlugin('accepts-anything')
			.description('Test widget')
			.interfaces<AcceptsAnythingInterfaces>()
			.state(state => state.anything({
				// Accepts every candidate — including a thenable — so acceptance alone cannot be relied
				// upon to keep thenables out of the live value.
				validate: (_input): _input is unknown => true,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'accepts-anything' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')
		return { widget }
	}

	it('throws synchronously — an implementation-contract violation, not a validation ExecutionResult.failure', () => {
		const { widget } = createRuntime()

		widget.state.anything.set(1)
		const { caught, threw } = captureThrow(() => widget.state.anything.set(Promise.resolve('nope')))

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		// The previously accepted value stays committed; the throw preempts the new commit.
		expect(widget.state.anything.get())
			.toBe(1)
	})

	it('a candidate rejected by validate() stays an ordinary validation failure even when it is thenable', () => {
		interface RejectsThenableInterfaces {
			state: {
				value: unknown
			}
		}

		const isThenable = (input: unknown): boolean =>
			typeof input === 'object' && input !== null && typeof (input as { then?: unknown }).then === 'function'

		const plugin = createWidgetPlugin('rejects-thenable')
			.description('Test widget')
			.interfaces<RejectsThenableInterfaces>()
			.state(state => state.value({
				validate: (input): input is unknown => !isThenable(input),
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'rejects-thenable' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		const { caught, threw, returned } = captureThrow(() => widget.state.value.set(Promise.resolve('nope')))

		expect(threw)
			.toBe(false)
		const result = returned as { ok: boolean, diagnostics?: readonly unknown[] }
		expect(result.ok)
			.toBe(false)
		expect(caught)
			.toBeUndefined()
	})
})

describe('a function-valued thenable is a sync-boundary violation too (round-2 finding 3773696016)', () => {
	function makeCallableThenable(): (() => void) & { then: (...args: unknown[]) => unknown } {
		const fn = (() => {}) as (() => void) & { then?: unknown }
		// `PromiseLike` is a structural contract; a function value with a `.then` property is still
		// thenable. `typeof fn === 'function'`, not `'object'`, so a guard that only checks
		// `typeof value === 'object'` misses this entirely.
		fn.then = () => {}
		return fn as (() => void) & { then: (...args: unknown[]) => unknown }
	}

	interface AcceptsAnythingInterfaces {
		state: {
			anything: unknown
		}
	}

	it('an accepted callable-thenable candidate must not become the live State value', () => {
		const plugin = createWidgetPlugin('accepts-anything-fn')
			.description('Test widget')
			.interfaces<AcceptsAnythingInterfaces>()
			.state(state => state.anything({
				validate: (_input): _input is unknown => true,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'accepts-anything-fn' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		widget.state.anything.set(1)
		const { caught, threw } = captureThrow(() => widget.state.anything.set(makeCallableThenable()))

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		expect(widget.state.anything.get())
			.toBe(1)
	})

	it('a callback (method.execute) returning a callable thenable throws synchronously', () => {
		interface CallableThenableMethodInterfaces {
			methods: {
				run: () => unknown
			}
		}

		const plugin = createWidgetPlugin('callable-thenable-execute')
			.description('Test widget')
			.interfaces<CallableThenableMethodInterfaces>()
			.methods(methods => methods.run({
				validateArgs: (args): args is [] => args.length === 0,
				execute: () => makeCallableThenable() as unknown,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'callable-thenable-execute' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		const { caught, threw } = captureThrow(() => widget.methods.run())

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
	})
})

describe('a dependency .validate() refinement returning a thenable is a sync-boundary violation (round-2 finding 3773696018)', () => {
	interface RefinementInterfaces {
		state: {
			count: number
		}
		properties: {
			viaAsyncRefinement: number
		}
	}

	it('throws synchronously via the consuming Property\'s .get(), instead of treating the truthy Promise as an accepted refinement', () => {
		const plugin = createWidgetPlugin('async-refinement')
			.description('Test widget')
			.interfaces<RefinementInterfaces>()
			.state(state => state.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 5,
			}))
			.properties(properties => properties.viaAsyncRefinement({
				registerDeps: ({ dep }) => ({
					count: dep.self.state.get('count')
						// A `Promise` is truthy, so `if (!refine(value))` alone would read this as an
						// *accepted* refinement rather than a sync-boundary violation.
						.validate((_value): _value is never => Promise.resolve(false) as unknown as boolean),
				}),
				compute: ({ deps }) => {
					const result = deps.count()
					return result.ok ? 1 : 0
				},
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'async-refinement' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		const { caught, threw, returned } = captureThrow(() => widget.properties.viaAsyncRefinement.get())

		if (!threw) {
			expect.fail(`suspected implementation bug: a thenable-returning dependency refinement was expected to throw synchronously, but it returned: ${JSON.stringify(returned)}`)
		}
		expectPlainException(caught)
	})
})
