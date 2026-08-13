/**
 * Regression coverage for PR #12 round-2 review finding 3773696025 (`runtime/collector.ts` mutable
 * completed issue snapshot).
 *
 * `ExecutionResult.failure.issues` is an immutable final snapshot for that operation, and `getIssues()`
 * is the latest *completed* snapshot — the very same array/reference, per
 * `issue-snapshot.unit.test.ts`. Before this fix, `finalize()` returned a plain `entries.map(...)`
 * array, so `result.issues.push(fakeIssue)` (or any other external mutation, including through `as
 * any`) silently corrupted the primitive's own `getIssues()` state without any Runtime operation or
 * signal update ever running. `EMPTY_ISSUES` was already frozen; this closes the same gap for every
 * non-empty completed snapshot across State, Property and Method.
 *
 * Normative source: issue #10 issue-snapshot contract (consolidated handoff §16).
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface SnapshotInterfaces {
	state: {
		count: number
	}
	properties: {
		flaky: number
	}
	methods: {
		flakyMethod: () => number
	}
}

function createHarness() {
	let propertyShouldFail = false
	let methodShouldFail = false

	const plugin = createWidgetPlugin('counter')
		.interfaces<SnapshotInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties(properties => properties.flaky({
			compute: ({ addIssue }) => {
				if (propertyShouldFail)
					addIssue({ message: 'property flaky failed' })
				return 0
			},
		}))
		.methods(methods => methods.flakyMethod({
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ addIssue }) => {
				if (methodShouldFail)
					addIssue({ message: 'method flaky failed' })
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
		runtime,
		widget,
		setPropertyShouldFail: (value: boolean) => {
			propertyShouldFail = value
		},
		setMethodShouldFail: (value: boolean) => {
			methodShouldFail = value
		},
	}
}

/** A stand-in issue shaped closely enough to pass structurally as a `RuntimeIssue` under `any`. */
const fakeIssue = { source: { type: 'forged' }, message: 'forged' }

describe('completed non-empty issue snapshots are frozen (round-2 finding 3773696025)', () => {
	it('state.set failure: `result.issues` is frozen, is the same reference as getIssues(), and a mutation attempt does not corrupt subsequent reads', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.issues))
			.toBe(true)
		expect(Object.isFrozen(result.issues[0]))
			.toBe(true)
		expect(widget.state.count.getIssues())
			.toBe(result.issues)

		expect(() => (result.issues as unknown as unknown[]).push(fakeIssue))
			.toThrow(TypeError)
		expect(widget.state.count.getIssues())
			.toHaveLength(1)
		expect(widget.state.count.getIssues())
			.toBe(result.issues)
	})

	it('property.get failure: `result.issues` is frozen and immune to external mutation attempts', () => {
		const { widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.flaky.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.issues))
			.toBe(true)
		expect(widget.properties.flaky.getIssues())
			.toBe(result.issues)

		expect(() => (result.issues as unknown as unknown[]).push(fakeIssue))
			.toThrow(TypeError)
		expect(widget.properties.flaky.getIssues())
			.toHaveLength(1)
	})

	it('method call failure: `result.issues` is frozen and immune to external mutation attempts', () => {
		const { widget, setMethodShouldFail } = createHarness()
		setMethodShouldFail(true)

		const result = widget.methods.flakyMethod()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(Object.isFrozen(result.issues))
			.toBe(true)
		expect(widget.methods.flakyMethod.getIssues())
			.toBe(result.issues)

		expect(() => (result.issues as unknown as unknown[]).push(fakeIssue))
			.toThrow(TypeError)
		expect(widget.methods.flakyMethod.getIssues())
			.toHaveLength(1)
	})

	it('the framework generic-fallback issue array (no addIssue call) is frozen too', () => {
		const { widget } = createHarness()

		const result = widget.state.count.set('nope' as unknown as number)

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues[0]!.source.type)
			.toBe('state-validation')
		expect(Object.isFrozen(result.issues))
			.toBe(true)
	})

	it('an attempted mutation of a failure snapshot does not leak a forged issue into the Runtime aggregate', () => {
		const { runtime, widget, setPropertyShouldFail } = createHarness()
		setPropertyShouldFail(true)

		const result = widget.properties.flaky.get()
		if (result.success)
			throw new Error('Expected a failure result.')

		try {
			(result.issues as unknown as unknown[]).push(fakeIssue)
		}
		catch {
			// Expected: frozen arrays throw on mutation in strict mode (ESM is always strict).
		}

		expect(widget.properties.flaky.getIssues())
			.toHaveLength(1)
		expect(runtime.getCollectedIssues())
			.toHaveLength(1)
		expect(runtime.getCollectedIssues())
			.not.toContain(fakeIssue)
	})
})
