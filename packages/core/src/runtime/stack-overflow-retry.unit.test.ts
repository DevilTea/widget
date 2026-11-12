/**
 * Conformance: a stack overflow is not a Property's cached outcome.
 *
 * A throwing `compute` is cached until a dependency changes, so every read in between rethrows it without
 * re-running `compute`. An engine stack overflow depends on how deep the stack was when the evaluation ran,
 * not on the compute's inputs, so it is the exception: the next read re-evaluates, which is what lets a long
 * chain whose first read was too deep be warmed bottom-up from a shallow stack.
 */

import type { ExecutionResult } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

/** A genuine engine stack overflow, captured once at a shallow stack so a compute can rethrow it. */
function captureEngineStackOverflow(): unknown {
	const exhaust = (): number => 1 + exhaust()
	try {
		exhaust()
	}
	catch (error) {
		return error
	}
	throw new Error('expected the engine to report stack exhaustion')
}

const engineOverflow = captureEngineStackOverflow()

interface HostInterfaces {
	state: {
		n: number
	}
	properties: {
		flaky: number
		dependent: number
	}
}

function numberOf(result: ExecutionResult<number | null, unknown>): number {
	return result.ok ? result.value ?? 0 : 0
}

function createHarness() {
	const control = { throwing: null as unknown, computeRuns: 0 }
	const plugin = createWidgetPlugin('host')
		.description('Test widget')
		.interfaces<HostInterfaces>()
		.state(state => state.n({ validate: (input): input is number => typeof input === 'number', default: () => 1 }))
		.properties(properties => properties
			.flaky({
				registerDeps: ({ dep }) => ({ n: dep.self.state.get('n') }),
				compute: ({ deps }) => {
					control.computeRuns++
					// Read first, so the outcome depends on `n` like any evaluation that got this far.
					const n = numberOf(deps.n())
					if (control.throwing !== null)
						throw control.throwing
					return n * 10
				},
			})
			.dependent({
				registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
				compute: ({ deps }) => numberOf(deps.flaky()) + 1,
			}))
		.done()
	const blueprint = createWidgetSystem({ plugins: [plugin] })
		.createBlueprint({ id: 'host', type: 'host' })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const widget = blueprint.createRuntime()
		.getWidget('host')!
	return { widget, control }
}

const reported: unknown[] = []
function onUncaughtException(error: unknown): void {
	reported.push(error)
}

beforeEach(() => {
	reported.length = 0
	process.on('uncaughtException', onUncaughtException)
})

afterEach(async () => {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	process.off('uncaughtException', onUncaughtException)
})

describe('a stack overflow outcome', () => {
	it('is re-evaluated by the next read instead of being rethrown from the cache', () => {
		const { widget, control } = createHarness()
		control.throwing = engineOverflow

		expect(() => widget.properties.flaky.get())
			.toThrow(engineOverflow as Error)

		control.throwing = null

		expect(widget.properties.flaky.get())
			.toEqual({ ok: true, value: 10 })
		expect(control.computeRuns)
			.toBe(2)
		// Completed outcomes stay cached as usual.
		expect(widget.properties.flaky.get())
			.toEqual({ ok: true, value: 10 })
		expect(control.computeRuns)
			.toBe(2)
	})

	it('lets a dependent Property that cached the same overflow recover too', () => {
		const { widget, control } = createHarness()
		control.throwing = engineOverflow

		expect(() => widget.properties.dependent.get())
			.toThrow(engineOverflow as Error)

		control.throwing = null

		expect(widget.properties.dependent.get())
			.toEqual({ ok: true, value: 11 })
	})

	it('is retried on every read while the overflow persists', () => {
		const { widget, control } = createHarness()
		control.throwing = engineOverflow

		expect(() => widget.properties.flaky.get())
			.toThrow(engineOverflow as Error)
		expect(() => widget.properties.flaky.get())
			.toThrow(engineOverflow as Error)
		expect(control.computeRuns)
			.toBe(2)
	})

	it('notifies a subscriber once the retried evaluation completes', () => {
		const { widget, control } = createHarness()
		const seen: unknown[] = []
		widget.properties.flaky.subscribe(result => seen.push(result.ok ? result.value : 'failed'))
		control.throwing = engineOverflow
		widget.state.n.set(2)

		expect(seen)
			.toEqual([])

		control.throwing = null

		expect(widget.properties.flaky.get())
			.toEqual({ ok: true, value: 20 })
		expect(seen)
			.toEqual([20])
	})
})

describe('a semantic compute exception', () => {
	it('stays cached until a dependency changes', () => {
		const { widget, control } = createHarness()
		const semantic = new RangeError('Invalid time value')
		control.throwing = semantic

		expect(() => widget.properties.flaky.get())
			.toThrow(semantic)

		control.throwing = null

		expect(() => widget.properties.flaky.get())
			.toThrow(semantic)
		expect(control.computeRuns)
			.toBe(1)

		widget.state.n.set(3)

		expect(widget.properties.flaky.get())
			.toEqual({ ok: true, value: 30 })
	})
})

describe('a chain of Properties too long for its first read', () => {
	interface RowInterfaces {
		config: {
			raw: { prev: string | null }
			resolved: { prev: string | null }
		}
		properties: {
			total: number
		}
	}

	const rowPlugin = createWidgetPlugin('row')
		.description('Test widget')
		.interfaces<RowInterfaces>()
		.config({
			description: 'The previous row',
			validate: (input): input is { prev: string | null } => typeof input === 'object' && input !== null,
			resolve: raw => raw ?? { prev: null },
		})
		.properties(properties => properties.total({
			// The first row's previous row is absent.
			registerDeps: ({ dep, config }) => ({
				prev: dep.widget(config.prev ?? 'none')
					.optional()
					.properties
					.get('total'),
			}),
			compute: ({ deps }) => {
				const prev = deps.prev()
				return (prev.ok && typeof prev.value === 'number' ? prev.value : 0) + 1
			},
		}))
		.done()
	const tablePlugin = createWidgetPlugin('table')
		.description('Test widget')
		.interfaces<{ slots: 'rows' }>()
		.slots({ rows: { description: 'Rows' } })
		.done()
	const chainSystem = createWidgetSystem({ plugins: [rowPlugin, tablePlugin] })

	it('is warmed bottom-up from a shallow stack after the first read overflowed', () => {
		const length = 20_000
		const rows = Array.from({ length }, (_, index) => ({ id: `r${index}`, type: 'row', config: { prev: index === 0 ? null : `r${index - 1}` } }))
		const blueprint = chainSystem.createBlueprint({ id: 'table', type: 'table', slots: { rows } })
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const runtime = blueprint.createRuntime()
		const read = (index: number) => {
			const widget = runtime.getWidget(`r${index}`)
			if (widget?.type !== 'row')
				throw new Error('expected a row widget')
			return widget.properties.total.get()
		}

		expect(() => read(length - 1))
			.toThrow(RangeError)

		for (let index = 0; index < length; index += 100) {
			expect(read(index))
				.toEqual({ ok: true, value: index + 1 })
		}

		expect(read(length - 1))
			.toEqual({ ok: true, value: length })
	})
})
