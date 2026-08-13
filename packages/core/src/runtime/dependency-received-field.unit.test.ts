/**
 * Regression coverage for PR #12 review finding 3773310844 (`runtime/issues.ts` `received` sentinel
 * conflation).
 *
 * `undefined` is a valid dependency value, so it cannot double as the sentinel for "no `received`
 * field". A `.validate()` refinement that rejects an actual `undefined` candidate must still produce a
 * `received: undefined` *own property* on `source` — distinguishable, by key presence, from a wrapped
 * target-primitive failure, which never carries a `received` field at all.
 *
 * Normative source: issue #10 consolidated handoff §12 ("a dependency refinement failure ... becomes a
 * consumer-local dependency Issue carrying the rejected `received` value").
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface ReceivedInterfaces {
	properties: {
		source: unknown
		rejectsUndefined: number
		viaFlaky: number
	}
	methods: {
		flakyMethod: () => number
	}
}

function createHarness() {
	let flakyShouldFail = false

	const plugin = createWidgetPlugin('probe')
		.interfaces<ReceivedInterfaces>()
		.properties(properties => properties
			// Always reads back as `undefined`.
			.source({
				compute: () => undefined,
			})
			// Refinement rejects everything, including the actual `undefined` produced by `source`.
			.rejectsUndefined({
				registerDeps: ({ dep }) => ({
					source: dep.self.properties.get('source')
						.validate((_value): _value is never => false),
				}),
				compute: ({ deps }) => {
					const result = deps.source()
					return result.success ? 1 : 0
				},
			})
			.viaFlaky({
				registerDeps: ({ dep }) => ({ flaky: dep.self.methods.invoke('flakyMethod') }),
				compute: ({ deps }) => {
					const result = deps.flaky()
					return result.success ? 1 : 0
				},
			}))
		.methods(methods => methods.flakyMethod({
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ addIssue }) => {
				if (flakyShouldFail)
					addIssue({ message: 'flaky method failed' })
				return 0
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'probe' })
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
	}
}

describe('dependency-issue `received` field presence vs. value (issue #10 §12)', () => {
	it('a refinement rejecting an actual `undefined` value emits `received: undefined` as an own property', () => {
		const { widget } = createHarness()

		const result = widget.properties.rejectsUndefined.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
			.toHaveLength(1)
		const source = result.issues[0]!.source
		expect(source.type)
			.toBe('property-dependency')

		// Own-property presence, not value equality: `.toBeUndefined()` alone cannot distinguish
		// "field absent" from "field present with value undefined".
		expect(Object.hasOwn(source, 'received'))
			.toBe(true)
		expect((source as { received?: unknown }).received)
			.toBeUndefined()
	})

	it('a wrapped target-primitive failure never carries a `received` field at all', () => {
		const { widget, setFlakyShouldFail } = createHarness()
		setFlakyShouldFail(true)

		const result = widget.properties.viaFlaky.get()

		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('Expected a failure result.')

		expect(result.issues)
			.toHaveLength(1)
		const source = result.issues[0]!.source
		expect(source.type)
			.toBe('property-dependency')

		expect(Object.hasOwn(source, 'received'))
			.toBe(false)
	})
})
