/**
 * Regression coverage for PR #12 review findings 3773310820 (`runtime/state.ts`) and 3773310824
 * (`runtime/method.ts`): the locked validator truth table.
 *
 * Normative source: diagnostic #10 §7 / consolidated handoff §15 finalization table:
 *
 * ```text
 * true  + no diagnostics -> ok
 * true  + diagnostics    -> failure
 * false + diagnostics    -> failure
 * false + no diagnostics -> framework generic diagnostic
 * ```
 *
 * The implementation used to treat the boolean predicate as the sole authority: `validate()` /
 * `validateArgs()` returning `true` after calling `addDiagnostic()` committed the candidate / ran `execute()`
 * and silently discarded the authored diagnostics.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface StateInterfaces {
	state: {
		count: number
	}
}

function createStateHarness(validate: (input: unknown, addDiagnostic: (message: string) => void) => boolean) {
	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<StateInterfaces>()
		.state(state => state.count({
			validate: (input, ctx): input is number => validate(input, message => ctx.addDiagnostic({ message })),
			default: () => 0,
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

	return { widget }
}

interface MethodInterfaces {
	methods: {
		guarded: (value: number) => number
	}
}

function createMethodHarness(validateArgs: (args: readonly unknown[], addDiagnostic: (message: string) => void) => boolean) {
	let executeCount = 0

	const plugin = createWidgetPlugin('counter')
		.description('Test widget')
		.interfaces<MethodInterfaces>()
		.methods(methods => methods.guarded({
			validateArgs: (args, ctx): args is [number] => validateArgs(args, message => ctx.addDiagnostic({ message })),
			execute: ({ args }) => {
				executeCount++
				return args[0]
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

	return { widget, executeCount: () => executeCount }
}

describe('runtimeState.set — validator truth table (diagnostic #10 §7)', () => {
	it('true + no diagnostics => ok', () => {
		const { widget } = createStateHarness(input => typeof input === 'number')

		const result = widget.state.count.set(5)

		expect(result)
			.toEqual({ ok: true, value: 5 })
	})

	it('true + diagnostics present => failure, preserving the authored diagnostic and the previously accepted value', () => {
		const { widget } = createStateHarness((input, addDiagnostic) => {
			if (typeof input === 'number' && input > 100)
				addDiagnostic('suspiciously large')
			return typeof input === 'number'
		})

		widget.state.count.set(3)
		const result = widget.state.count.set(999)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')

		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.message)
			.toBe('suspiciously large')
		// The candidate rejected by the true+diagnostics rule must not commit.
		expect(widget.state.count.get())
			.toBe(3)
	})

	it('false + diagnostics present => failure carrying the authored diagnostic, not the generic fallback', () => {
		const { widget } = createStateHarness((_input, addDiagnostic) => {
			addDiagnostic('custom rejection')
			return false
		})

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.message)
			.toBe('custom rejection')
	})

	it('false + no diagnostics => framework generic diagnostic, then failure', () => {
		const { widget } = createStateHarness(() => false)

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.code)
			.toBe('invalid-state-value')
	})
})

describe('runtimeMethod invocation — validateArgs truth table (diagnostic #10 §7)', () => {
	it('true + no diagnostics => ok and execute runs', () => {
		const { widget, executeCount } = createMethodHarness(args => args.length === 1 && typeof args[0] === 'number')

		const result = widget.methods.guarded(7)

		expect(result)
			.toEqual({ ok: true, value: 7 })
		expect(executeCount())
			.toBe(1)
	})

	it('true + diagnostics present => failure, preserving the authored diagnostic, and execute never runs', () => {
		const { widget, executeCount } = createMethodHarness((args, addDiagnostic) => {
			if (typeof args[0] === 'number' && args[0] > 100)
				addDiagnostic('argument out of range')
			return args.length === 1 && typeof args[0] === 'number'
		})

		const result = widget.methods.guarded(999)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.message)
			.toBe('argument out of range')
		expect(executeCount())
			.toBe(0)
	})

	it('false + diagnostics present => failure carrying the authored diagnostic, not the generic fallback', () => {
		const { widget, executeCount } = createMethodHarness((_args, addDiagnostic) => {
			addDiagnostic('custom argument rejection')
			return false
		})

		const result = widget.methods.guarded(1)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.message)
			.toBe('custom argument rejection')
		expect(executeCount())
			.toBe(0)
	})

	it('false + no diagnostics => framework generic diagnostic, then failure, and execute never runs', () => {
		const { widget, executeCount } = createMethodHarness(() => false)

		const result = widget.methods.guarded(1)

		expect(result.ok)
			.toBe(false)
		if (result.ok)
			throw new Error('Expected a failure result.')
		expect(result.failure.diagnostics)
			.toHaveLength(1)
		expect(result.failure.diagnostics[0]!.code)
			.toBe('invalid-method-arguments')
		expect(executeCount())
			.toBe(0)
	})
})
