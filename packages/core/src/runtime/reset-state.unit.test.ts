/**
 * Conformance coverage for `WidgetSystemRuntime.resetState()`.
 *
 * Normative source: Discussion #12 C0 amendment "Runtime reuse: `resetState()`, callback-context
 * lifetime and `createBlueprintFromJson`". After a reset, every State member carries the same value and
 * diagnostic snapshot as in a Runtime freshly created from the same Blueprint and options, `validate` is
 * not re-run, and the writes form one batch.
 */

import type { WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'

interface ResetInterfaces extends WidgetInterfaces {
	state: {
		plain: string
		withDefault: number
		badDefault: number
	}
	properties: {
		summary: string
	}
	methods: {
		fail: () => null
	}
}

let validateCalls = 0
let summaryComputes = 0

const resetPlugin = createWidgetPlugin('reset')
	.description('Test widget')
	.interfaces<ResetInterfaces>()
	.state(state => state
		.plain({
			validate: (input): input is string => {
				validateCalls++
				return typeof input === 'string'
			},
		})
		.withDefault({
			validate: (input): input is number => {
				validateCalls++
				return typeof input === 'number'
			},
			default: () => 1,
		})
		.badDefault({
			validate: (input, ctx): input is number => {
				validateCalls++
				if (typeof input !== 'number' || input < 0) {
					ctx.addDiagnostic({ message: 'must be a non-negative number' })
					return false
				}
				return true
			},
			default: () => -1,
		}))
	.properties(properties => properties.summary({
		registerDeps: ({ dep }) => ({
			plain: dep.self.state.get('plain'),
			withDefault: dep.self.state.get('withDefault'),
		}),
		compute: ({ deps }) => {
			summaryComputes++
			const plain = deps.plain()
			const withDefault = deps.withDefault()
			return `${plain.ok ? plain.value ?? '-' : '!'}:${withDefault.ok ? withDefault.value ?? '-' : '!'}`
		},
	}))
	.methods(methods => methods.fail({
		validateArgs: (_args, ctx): _args is [] => {
			ctx.addDiagnostic({ message: 'always fails' })
			return false
		},
		execute: () => null,
	}))
	.done()

const system = createWidgetSystem({ plugins: [resetPlugin] })
const compiled = system.createBlueprint({ id: 'root', type: 'reset' })
if (compiled.status !== 'valid')
	throw new Error('fixture setup error: expected a valid Blueprint')
const blueprint = compiled

function snapshot(runtime: ReturnType<typeof blueprint.createRuntime>) {
	const widget = runtime.getWidget('root')!
	return {
		values: [widget.state.plain.get(), widget.state.withDefault.get(), widget.state.badDefault.get()],
		diagnostics: [widget.state.plain.getDiagnostics(), widget.state.withDefault.getDiagnostics(), widget.state.badDefault.getDiagnostics()],
		summary: widget.properties.summary.get(),
	}
}

function mutate(runtime: ReturnType<typeof blueprint.createRuntime>) {
	const widget = runtime.getWidget('root')!
	widget.state.plain.set('changed')
	widget.state.withDefault.set(42)
	widget.state.badDefault.set(7)
	// A rejected write leaves its own diagnostic snapshot behind.
	widget.state.plain.set(123 as unknown as string)
	widget.properties.summary.get()
}

describe('resetState', () => {
	it('restores every State member to the same value and diagnostic snapshot as a fresh Runtime', () => {
		const fresh = blueprint.createRuntime()
		const reused = blueprint.createRuntime()
		mutate(reused)
		expect(snapshot(reused).values)
			.toEqual(['changed', 42, 7])

		reused.resetState()

		expect(snapshot(reused))
			.toEqual(snapshot(fresh))
		// The failed default stays `null` with its initialization diagnostic, exactly like creation.
		expect(snapshot(reused).values)
			.toEqual([null, 1, null])
		expect(snapshot(reused).diagnostics[2]!.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-state-value'])
		expect(snapshot(reused).diagnostics[0])
			.toEqual([])
	})

	it('restores the overridden initial value, not the plugin default', () => {
		const options = { overrideStateDefaults: { root: { withDefault: 5, plain: 'seed' } } }
		const fresh = blueprint.createRuntime(options)
		const reused = blueprint.createRuntime(options)
		mutate(reused)

		reused.resetState()

		expect(snapshot(reused))
			.toEqual(snapshot(fresh))
		expect(snapshot(reused).values.slice(0, 2))
			.toEqual(['seed', 5])
	})

	it('does not run validate', () => {
		const runtime = blueprint.createRuntime()
		mutate(runtime)
		validateCalls = 0

		runtime.resetState()

		expect(validateCalls)
			.toBe(0)
	})

	it('batches the writes: a dependent Property subscriber is notified once', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		mutate(runtime)

		const notified: unknown[] = []
		widget.properties.summary.subscribe(result => notified.push(result.ok ? result.value : null))
		summaryComputes = 0

		runtime.resetState()

		expect(notified)
			.toEqual(['-:1'])
		expect(summaryComputes)
			.toBe(1)
	})

	it('notifies only State subscribers whose value changed', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		widget.state.plain.set('changed')

		const plainValues: unknown[] = []
		const withDefaultValues: unknown[] = []
		widget.state.plain.subscribe(value => plainValues.push(value))
		widget.state.withDefault.subscribe(value => withDefaultValues.push(value))

		runtime.resetState()

		expect(plainValues)
			.toEqual([null])
		expect(withDefaultValues)
			.toEqual([])
	})

	it('keeps Method diagnostic snapshots', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		widget.methods.fail()
		const before = widget.methods.fail.getDiagnostics()
		expect(before)
			.toHaveLength(1)

		runtime.resetState()

		expect(widget.methods.fail.getDiagnostics())
			.toBe(before)
	})

	it('throws WidgetSystemRuntimeDisposedError after dispose', () => {
		const runtime = blueprint.createRuntime()
		runtime.dispose()

		expect(() => runtime.resetState())
			.toThrow(WidgetSystemRuntimeDisposedError)
	})
})
