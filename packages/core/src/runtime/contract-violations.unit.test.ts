/**
 * Conformance: diagnostic #10 COMMENT 26 §13 (implementation contract violations), cross-checked against
 * COMMENT 16/19/20 and consolidated handoff §16/§18.
 *
 * Scope: a semantic callback (`state.validate`, `property.compute`, `method.execute`, `state.default`,
 * `config.validate`) that throws propagates as a plain implementation/runtime exception:
 * - synchronously, out of the public call that triggered it,
 * - never converted into a `BlueprintDiagnostic`/`RuntimeDiagnostic`,
 * - never converted into an `ExecutionResult.failure`,
 * - discarding only the in-progress operation-local collector, so the previous *completed* diagnostic
 *   snapshot is preserved and any state writes that already succeeded earlier in the same callback
 *   remain committed.
 *
 * A throw during Blueprint/Runtime *creation* (e.g. `config.validate`, `state.default`) makes creation
 * itself throw rather than producing a normal Blueprint/Runtime.
 *
 * A semantic callback returning a thenable where synchronous completion is required is treated the same
 * way: an implementation contract violation that throws synchronously, not a semantic diagnostic.
 *
 * Only the public entry (`../index`) is imported; no internal module or `blueprintInternals` access.
 */

import type { JsonValue } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface ContractInterfaces {
	state: {
		count: number
		crashy: number
	}
	properties: {
		crashingDouble: number
	}
	methods: {
		crash: (mode: string) => number
	}
}

function createContractPlugin() {
	return createWidgetPlugin('contract')
		.description('Test widget')
		.interfaces<ContractInterfaces>()
		.state(section => section
			.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => 0,
			})
			.crashy({
				validate: (input): input is number => {
					if (input === 'THROW')
						throw new Error('state.validate boom')
					return typeof input === 'number' && input >= 0
				},
				default: () => 0,
			}))
		.properties(section => section
			.crashingDouble({
				compute: () => {
					throw new Error('property.compute boom')
				},
			}))
		.methods(section => section
			.crash({
				registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
				validateArgs: (args): args is [string] => typeof args[0] === 'string',
				execute: ({ args, deps, addDiagnostic }) => {
					const mode = args[0]
					if (mode === 'write-then-throw') {
						deps.setCount(99)
						throw new Error('method.execute boom after write')
					}
					if (mode === 'fail') {
						addDiagnostic({ message: 'deliberate failure' })
						return 0
					}
					if (mode === 'succeed')
						return 1

					throw new Error(`test fixture: unexpected mode "${mode}"`)
				},
			}))
		.done()
}

function createContractRuntime() {
	const plugin = createContractPlugin()
	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'contract' })

	if (blueprint.status !== 'valid')
		throw new Error('test fixture: expected a valid blueprint')

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')

	if (widget === null)
		throw new Error('test fixture: expected the root widget to resolve')

	return { runtime, widget }
}

/** Asserts `caught` is a plain implementation exception: never an Diagnostic, never an ExecutionResult. */
function expectPlainException(caught: unknown): void {
	expect(caught)
		.toBeInstanceOf(Error)
	const record = caught as Record<string, unknown>
	// Not an `ExecutionResult.failure` shape.
	expect(record.ok)
		.toBeUndefined()
	expect(record.diagnostics)
		.toBeUndefined()
	// Not an `Diagnostic` shape.
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

describe('method.execute throw', () => {
	it('propagates synchronously as a plain exception, is not an Diagnostic or ExecutionResult failure, preserves the previous completed diagnostic snapshot, and keeps prior successful writes committed', () => {
		const { widget } = createContractRuntime()

		// 1. Establish a known, non-canonical completed diagnostic snapshot to check preservation against.
		const failingResult = widget.methods.crash('fail')
		expect(failingResult.ok)
			.toBe(false)
		const snapshotBeforeThrow = widget.methods.crash.getDiagnostics()
		expect(snapshotBeforeThrow.length)
			.toBeGreaterThan(0)

		// 2. A mode that writes state successfully and then throws.
		const { caught, threw } = captureThrow(() => widget.methods.crash('write-then-throw'))

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		expect((caught as Error).message)
			.toBe('method.execute boom after write')

		// The write performed before the throw remains committed (propagation atomicity, not rollback).
		expect(widget.state.count.get())
			.toBe(99)

		// The in-progress collector for the throwing invocation was discarded; the previously completed
		// snapshot is untouched (same reference, not merely equal content).
		expect(widget.methods.crash.getDiagnostics())
			.toBe(snapshotBeforeThrow)
	})

	it('a subsequent successful invocation still works normally after a prior throw', () => {
		const { widget } = createContractRuntime()

		captureThrow(() => widget.methods.crash('write-then-throw'))

		const result = widget.methods.crash('succeed')
		expect(result)
			.toEqual({ ok: true, value: 1 })
	})
})

describe('property.compute throw', () => {
	it('propagates synchronously as a plain exception via .get() and never touches the diagnostic channel', () => {
		const { widget } = createContractRuntime()

		const diagnosticsBeforeThrow = widget.properties.crashingDouble.getDiagnostics()

		const { caught, threw } = captureThrow(() => widget.properties.crashingDouble.get())

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		expect((caught as Error).message)
			.toBe('property.compute boom')

		// The diagnostic signal is a side effect of a *completed* evaluation; a throw during evaluation never
		// reaches that write.
		expect(widget.properties.crashingDouble.getDiagnostics())
			.toBe(diagnosticsBeforeThrow)
	})
})

describe('state.validate throw', () => {
	it('propagates synchronously as a plain exception via .set(), preserves the previous completed diagnostic snapshot, and leaves the value signal untouched', () => {
		const { widget } = createContractRuntime()

		// 1. A normal (non-throwing) rejection first, to establish a known completed failure snapshot.
		const failing = widget.state.crashy.set(-1)
		expect(failing.ok)
			.toBe(false)
		const snapshotBeforeThrow = widget.state.crashy.getDiagnostics()
		const valueBeforeThrow = widget.state.crashy.get()

		// 2. A candidate whose validate() implementation throws instead of returning a boolean.
		const { caught, threw } = captureThrow(() => widget.state.crashy.set('THROW' as unknown as number))

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		expect((caught as Error).message)
			.toBe('state.validate boom')

		expect(widget.state.crashy.getDiagnostics())
			.toBe(snapshotBeforeThrow)
		expect(widget.state.crashy.get())
			.toBe(valueBeforeThrow)
	})
})

describe('blueprint creation-time callback throw', () => {
	it('a config.validate throw makes system.createBlueprint(...) itself throw', () => {
		interface ConfigThrowInterfaces {
			config: {
				raw: Record<string, JsonValue>
				resolved: Record<string, unknown>
			}
		}

		const plugin = createWidgetPlugin('config-throws')
			.description('Test widget')
			.interfaces<ConfigThrowInterfaces>()
			.config({
				description: 'Test config',
				validate: (input): input is Record<string, JsonValue> => {
					if (typeof input === 'object' && input !== null && (input as Record<string, JsonValue>).mode === 'THROW')
						throw new Error('config.validate boom')
					return typeof input === 'object' && input !== null
				},
				resolve: raw => raw ?? {},
			})
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })

		const { caught, threw } = captureThrow(() => system.createBlueprint({ id: 'root', type: 'config-throws', config: { mode: 'THROW' } }))

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		expect((caught as Error).message)
			.toBe('config.validate boom')
	})
})

describe('runtime creation-time callback throw', () => {
	it('a state.default throw makes blueprint.createRuntime() itself throw', () => {
		interface DefaultThrowInterfaces {
			state: {
				count: number
			}
		}

		const plugin = createWidgetPlugin('default-throws')
			.description('Test widget')
			.interfaces<DefaultThrowInterfaces>()
			.state(section => section.count({
				validate: (input): input is number => typeof input === 'number',
				default: () => {
					throw new Error('state.default boom')
				},
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'default-throws' })

		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const { caught, threw } = captureThrow(() => blueprint.createRuntime())

		expect(threw)
			.toBe(true)
		expectPlainException(caught)
		expect((caught as Error).message)
			.toBe('state.default boom')
	})
})

describe('semantic callback returning a thenable is an implementation contract violation', () => {
	it('method.execute returning a thenable throws synchronously instead of completing with an ExecutionResult', () => {
		interface AsyncMethodInterfaces {
			methods: {
				run: () => number
			}
		}

		const plugin = createWidgetPlugin('async-method-violation')
			.description('Test widget')
			.interfaces<AsyncMethodInterfaces>()
			.methods(section => section.run({
				validateArgs: (args): args is [] => args.length === 0,
				// Deliberately lies about its declared synchronous return type to simulate a
				// misbehaving plugin implementation, per diagnostic #10 consolidated handoff §16.
				execute: () => Promise.resolve(1) as unknown as number,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'async-method-violation' })

		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')

		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		const { caught, threw, returned } = captureThrow(() => widget.methods.run())

		if (!threw) {
			// Spec requires a synchronous throw (diagnostic #10 consolidated handoff §16/§18; matrix §13),
			// not a normally-completed ExecutionResult. Reporting as a suspected implementation bug
			// rather than weakening the assertion.
			expect.fail(`suspected implementation bug: widget.methods.run() returning a thenable was expected to throw synchronously (diagnostic #10 §16/§18), but it returned: ${JSON.stringify(returned)}`)
		}

		expectPlainException(caught)
	})

	it('property.compute returning a thenable throws synchronously via .get() instead of completing with an ExecutionResult', () => {
		interface AsyncPropertyInterfaces {
			properties: {
				value: number
			}
		}

		const plugin = createWidgetPlugin('async-property-violation')
			.description('Test widget')
			.interfaces<AsyncPropertyInterfaces>()
			.properties(section => section.value({
				// Same deliberate lie as above, on a Property's `compute` this time.
				compute: () => Promise.resolve(2) as unknown as number,
			}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'async-property-violation' })

		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')

		if (widget === null)
			throw new Error('test fixture: expected the root widget to resolve')

		const { caught, threw, returned } = captureThrow(() => widget.properties.value.get())

		if (!threw) {
			expect.fail(`suspected implementation bug: widget.properties.value.get() returning a thenable was expected to throw synchronously (diagnostic #10 §16/§18), but it returned: ${JSON.stringify(returned)}`)
		}

		expectPlainException(caught)
	})
})
