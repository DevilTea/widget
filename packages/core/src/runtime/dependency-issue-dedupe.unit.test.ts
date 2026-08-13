/**
 * Regression coverage for PR #12 review finding 3773310841 (`runtime/collector.ts` unconditional
 * dependency-issue insertion).
 *
 * Normative source: issue #10 consolidated handoff §12 — "repeated reads of the same failing
 * dependency within one execution scope should avoid duplicating the same dependency issue insertion."
 * The operation-local collector used to append every wrapped/refinement dependency issue
 * unconditionally, so reading the same failing dependency twice inside one Property compute / Method
 * execute inserted two semantically identical `property-dependency` / `method-dependency` issues into
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
		.interfaces<DedupeInterfaces>()
		.properties(properties => properties
			.flaky({
				compute: ({ addIssue }) => {
					if (flakyShouldFail)
						addIssue({ message: 'flaky failed' })
					return 0
				},
			})
			// Reads the same failing dependency (`flaky`) twice within one compute.
			.readsFlakyTwice({
				registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
				compute: ({ deps }) => {
					const first = deps.flaky()
					const second = deps.flaky()
					lastPropertyCallResults = [first.success, second.success]
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
				lastMethodCallResults = [first.success, second.success]
				return 0
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
		widget,
		setFlakyShouldFail: (value: boolean) => {
			flakyShouldFail = value
		},
		getLastPropertyCallResults: () => lastPropertyCallResults,
		getLastMethodCallResults: () => lastMethodCallResults,
	}
}

describe('operation-local collector dedupes repeated dependency-issue insertion', () => {
	it('reading the same failing dependency twice inserts exactly one wrapped property-dependency issue', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.properties.readsFlakyTwice.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		// Exactly one dependency issue was inserted, not two, even though the failing target was read
		// twice within the same compute.
		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.source.type)
			.toBe('property-dependency')
	})

	it('each individual dependency call still reports its own ExecutionResult failure despite the dedupe', () => {
		const { widget, setFlakyShouldFail, getLastPropertyCallResults } = createHarness()
		setFlakyShouldFail(true)

		widget.properties.readsFlakyTwice.get()

		expect(getLastPropertyCallResults())
			.toEqual([false, false])
	})

	it('dedupe also applies to a Method invoking the same failing dependency twice, one issue only', () => {
		const { widget, setFlakyShouldFail, getLastMethodCallResults } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.methods.invokesFlakyTwice()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')
		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.source.type)
			.toBe('method-dependency')
		expect(getLastMethodCallResults())
			.toEqual([false, false])
	})

	it('a repeated refinement rejection of the same value inserts exactly one dependency issue', () => {
		const { widget } = createHarness()

		const result = widget.properties.refinedTwice.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
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
			throw new Error(`Expected a valid blueprint, got issues: ${JSON.stringify(blueprint.getCollectedIssues())}`)

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('Expected the "root" widget to exist.')

		return { widget }
	}

	it('rejecting two distinct same-description Symbols within one execution keeps both consumer issues, each with its own `received`', () => {
		const { widget } = createSymbolHarness()

		const result = widget.methods.viaDistinctSymbolTwice()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		// Not deduped: two distinct Symbol instances are two distinct failures, even though a
		// `typeof`+`String()` encoding would have stringified both to the same `"symbol:Symbol(x)"`.
		expect(result.issues)
			.toHaveLength(2)

		const received = result.issues.map((issue) => {
			if (issue.source.type !== 'method-dependency')
				throw new Error('Expected a method-dependency issue.')
			return issue.source.received
		})

		expect(typeof received[0])
			.toBe('symbol')
		expect(typeof received[1])
			.toBe('symbol')
		// Two fresh `Symbol('x')` calls never produce the same value, even with an identical description.
		expect(received[0])
			.not.toBe(received[1])
	})

	it('rejecting the same Symbol instance twice within one execution still dedupes to exactly one issue', () => {
		const { widget } = createSymbolHarness()

		const result = widget.methods.viaStableSymbolTwice()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
			.toHaveLength(1)
		if (result.issues[0]!.source.type !== 'method-dependency')
			throw new Error('Expected a method-dependency issue.')
		expect(typeof result.issues[0]!.source.received)
			.toBe('symbol')
	})
})
