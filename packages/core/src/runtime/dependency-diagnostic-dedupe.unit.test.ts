/**
 * Regression coverage for PR #12 review finding 3773310841 (`runtime/collector.ts` unconditional
 * dependency-diagnostic insertion).
 *
 * Normative source: diagnostic #10 consolidated handoff §12 — "repeated reads of the same failing
 * dependency within one execution scope should avoid duplicating the same dependency diagnostic insertion."
 * The operation-local collector used to append every wrapped/refinement dependency diagnostic
 * unconditionally, so reading the same failing dependency twice inside one Property compute / Method
 * execute inserted two semantically identical `property-dependency` / `method-dependency` diagnostics into
 * the finalized snapshot — while each individual dependency call still correctly reports its own
 * `ExecutionResult` failure.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface DedupeInterfaces {
	properties: {
		flaky: number
		readsFlakyTwice: number
		refinedTwice: number
	}
	methods: {
		invokesFlakyTwice: () => number
	}
}

function createHarness() {
	let flakyShouldFail = false
	let lastPropertyCallResults: readonly boolean[] = []
	let lastMethodCallResults: readonly boolean[] = []

	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<DedupeInterfaces>()
		.properties(properties => properties
			.flaky({
				compute: ({ addDiagnostic }) => {
					if (flakyShouldFail)
						addDiagnostic({ message: 'flaky failed' })
					return 0
				},
			})
			// Reads the same failing dependency (`flaky`) twice within one compute.
			.readsFlakyTwice({
				registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
				compute: ({ deps }) => {
					const first = deps.flaky()
					const second = deps.flaky()
					lastPropertyCallResults = [first.ok, second.ok]
					return 0
				},
			})
			// The same refinement rejects the same read value twice within one compute.
			.refinedTwice({
				registerDeps: ({ dep }) => ({
					flaky: dep.self.properties.get('flaky')
						.validate((_value): _value is never => false),
				}),
				compute: ({ deps }) => {
					deps.flaky()
					deps.flaky()
					return 0
				},
			}))
		.methods(methods => methods.invokesFlakyTwice({
			registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps }) => {
				const first = deps.flaky()
				const second = deps.flaky()
				lastMethodCallResults = [first.ok, second.ok]
				return 0
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
		widget,
		setFlakyShouldFail: (value: boolean) => {
			flakyShouldFail = value
		},
		getLastPropertyCallResults: () => lastPropertyCallResults,
		getLastMethodCallResults: () => lastMethodCallResults,
	}
}

describe('operation-local collector dedupes repeated dependency-diagnostic insertion', () => {
	it('reading the same failing dependency twice inserts exactly one wrapped property-dependency diagnostic', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.properties.readsFlakyTwice.get()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		// Exactly one dependency diagnostic was inserted, not two, even though the failing target was read
		// twice within the same compute.
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.code)
			.toBe('dependency-target-failed')
	})

	it('each individual dependency call still reports its own ExecutionResult failure despite the dedupe', () => {
		const { widget, setFlakyShouldFail, getLastPropertyCallResults } = createHarness()
		setFlakyShouldFail(true)

		widget.properties.readsFlakyTwice.get()

		expect(getLastPropertyCallResults())
			.toEqual([false, false])
	})

	it('dedupe also applies to a Method invoking the same failing dependency twice, one diagnostic only', () => {
		const { widget, setFlakyShouldFail, getLastMethodCallResults } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.methods.invokesFlakyTwice()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.code)
			.toBe('dependency-target-failed')
		expect(getLastMethodCallResults())
			.toEqual([false, false])
	})

	it('a repeated refinement rejection of the same value inserts exactly one dependency diagnostic', () => {
		const { widget } = createHarness()

		const result = widget.properties.refinedTwice.get()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
	})
})

describe('dedupe anchor identity is collision-free for Symbols (review finding 3774271404)', () => {
	interface SymbolDedupeInterfaces {
		methods: {
			distinctSymbol: () => symbol
			stableSymbol: () => symbol
			viaDistinctSymbolTwice: () => number
			viaStableSymbolTwice: () => number
		}
	}

	function createSymbolHarness() {
		// One stable instance, reused by `stableSymbol` on every call — the dedupe control group.
		const stableSymbol = Symbol('x')

		const plugin = createWidgetPlugin('symbol-dedupe')
			.description('Test widget')
			.interfaces<SymbolDedupeInterfaces>()
			.methods(methods => methods
				// A fresh `Symbol('x')` every call: same description, different instance each time.
				.distinctSymbol({
					validateArgs: (args): args is [] => args.length === 0,
					execute: () => Symbol('x'),
				})
				.stableSymbol({
					validateArgs: (args): args is [] => args.length === 0,
					execute: () => stableSymbol,
				})
				// A refinement that unconditionally rejects, so every read's rejected value (a fresh or
				// stable Symbol, depending on which target it depends on) becomes `source.received`.
				.viaDistinctSymbolTwice({
					registerDeps: ({ dep }) => ({
						sym: dep.self.methods.invoke('distinctSymbol')
							.validate((_value): _value is never => false),
					}),
					validateArgs: (args): args is [] => args.length === 0,
					execute: ({ deps }) => {
						deps.sym()
						deps.sym()
						return 0
					},
				})
				.viaStableSymbolTwice({
					registerDeps: ({ dep }) => ({
						sym: dep.self.methods.invoke('stableSymbol')
							.validate((_value): _value is never => false),
					}),
					validateArgs: (args): args is [] => args.length === 0,
					execute: ({ deps }) => {
						deps.sym()
						deps.sym()
						return 0
					},
				}))
			.done()

		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'symbol-dedupe' })
		if (blueprint.status !== 'valid')
			throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('Expected the "root" widget to exist.')

		return { widget }
	}

	it('rejecting two distinct same-description Symbols within one execution keeps both consumer diagnostics, each with its own `received`', () => {
		const { widget } = createSymbolHarness()

		const result = widget.methods.viaDistinctSymbolTwice()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		// Not deduped: two distinct Symbol instances are two distinct failures, even though a
		// `typeof`+`String()` encoding would have stringified both to the same `"symbol:Symbol(x)"`.
		expect(result.failure.diagnostics)
			.toHaveLength(2)

		const received = result.failure.diagnostics.map((diagnostic) => {
			if (diagnostic.code !== 'dependency-value-rejected')
				throw new Error('Expected a dependency-value-rejected diagnostic.')
			return diagnostic.received
		})

		expect(typeof received[0])
			.toBe('symbol')
		expect(typeof received[1])
			.toBe('symbol')
		// Two fresh `Symbol('x')` calls never produce the same value, even with an identical description.
		expect(received[0])
			.not.toBe(received[1])
	})

	it('rejecting the same Symbol instance twice within one execution still dedupes to exactly one diagnostic', () => {
		const { widget } = createSymbolHarness()

		const result = widget.methods.viaStableSymbolTwice()

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
		if (result.failure.diagnostics[0]!.code !== 'dependency-value-rejected')
			throw new Error('Expected a dependency-value-rejected diagnostic.')
		expect(typeof result.failure.diagnostics[0]!.received)
			.toBe('symbol')
	})
})
