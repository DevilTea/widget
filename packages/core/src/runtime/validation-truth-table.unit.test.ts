/**
 * Regression coverage for PR #12 review findings 3773310820 (`runtime/state.ts`) and 3773310824
 * (`runtime/method.ts`): the locked validator truth table.
 *
 * Normative source: issue #10 §7 / consolidated handoff §15 finalization table:
 *
 * ```text
 * true  + no issues -> success
 * true  + issues    -> failure
 * false + issues    -> failure
 * false + no issues -> framework generic issue
 * ```
 *
 * The implementation used to treat the boolean predicate as the sole authority: `validate()` /
 * `validateArgs()` returning `true` after calling `addIssue()` committed the candidate / ran `execute()`
 * and silently discarded the authored diagnostics.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface StateInterfaces {
	state: {
		count: number
	}
}

function createStateHarness(validate: (input: unknown, addIssue: (message: string) => void) => boolean) {
	const plugin = createWidgetPlugin('counter')
		.interfaces<StateInterfaces>()
		.state(state => state.count({
			validate: (input, ctx): input is number => validate(input, message => ctx.addIssue({ message })),
			default: () => 0,
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

	return { widget }
}

interface MethodInterfaces {
	methods: {
		guarded: (value: number) => number
	}
}

function createMethodHarness(validateArgs: (args: readonly unknown[], addIssue: (message: string) => void) => boolean) {
	let executeCount = 0

	const plugin = createWidgetPlugin('counter')
		.interfaces<MethodInterfaces>()
		.methods(methods => methods.guarded({
			validateArgs: (args, ctx): args is [number] => validateArgs(args, message => ctx.addIssue({ message })),
			execute: ({ args }) => {
				executeCount++
				return args[0]
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

	return { widget, executeCount: () => executeCount }
}

describe('runtimeState.set — validator truth table (issue #10 §7)', () => {
	it('true + no issues => success', () => {
		const { widget } = createStateHarness(input => typeof input === 'number')

		const result = widget.state.count.set(5)

		expect(result)
			.toEqual({ success: true, value: 5 })
	})

	it('true + issues present => failure, preserving the authored issue and the previously accepted value', () => {
		const { widget } = createStateHarness((input, addIssue) => {
			if (typeof input === 'number' && input > 100)
				addIssue('suspiciously large')
			return typeof input === 'number'
		})

		widget.state.count.set(3)
		const result = widget.state.count.set(999)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.message)
			.toBe('suspiciously large')
		// The candidate rejected by the true+issues rule must not commit.
		expect(widget.state.count.get())
			.toBe(3)
	})

	it('false + issues present => failure carrying the authored issue, not the generic fallback', () => {
		const { widget } = createStateHarness((_input, addIssue) => {
			addIssue('custom rejection')
			return false
		})

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')
		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.message)
			.toBe('custom rejection')
	})

	it('false + no issues => framework generic issue, then failure', () => {
		const { widget } = createStateHarness(() => false)

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')
		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.source.type)
			.toBe('state-validation')
	})
})

describe('runtimeMethod invocation — validateArgs truth table (issue #10 §7)', () => {
	it('true + no issues => success and execute runs', () => {
		const { widget, executeCount } = createMethodHarness(args => args.length === 1 && typeof args[0] === 'number')

		const result = widget.methods.guarded(7)

		expect(result)
			.toEqual({ success: true, value: 7 })
		expect(executeCount())
			.toBe(1)
	})

	it('true + issues present => failure, preserving the authored issue, and execute never runs', () => {
		const { widget, executeCount } = createMethodHarness((args, addIssue) => {
			if (typeof args[0] === 'number' && args[0] > 100)
				addIssue('argument out of range')
			return args.length === 1 && typeof args[0] === 'number'
		})

		const result = widget.methods.guarded(999)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')
		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.message)
			.toBe('argument out of range')
		expect(executeCount())
			.toBe(0)
	})

	it('false + issues present => failure carrying the authored issue, not the generic fallback', () => {
		const { widget, executeCount } = createMethodHarness((_args, addIssue) => {
			addIssue('custom argument rejection')
			return false
		})

		const result = widget.methods.guarded(1)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')
		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.message)
			.toBe('custom argument rejection')
		expect(executeCount())
			.toBe(0)
	})

	it('false + no issues => framework generic issue, then failure, and execute never runs', () => {
		const { widget, executeCount } = createMethodHarness(() => false)

		const result = widget.methods.guarded(1)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')
		expect(result.issues)
			.toHaveLength(1)
		expect(result.issues[0]!.source.type)
			.toBe('method-args')
		expect(executeCount())
			.toBe(0)
	})
})
