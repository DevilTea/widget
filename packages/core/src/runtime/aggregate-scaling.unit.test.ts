/**
 * Scaling regression for the Runtime-level diagnostic aggregate: re-aggregation must only revisit the
 * widgets whose diagnostic snapshot changed, and an unchanged aggregate must be served from cache.
 *
 * Work is counted, not timed: every alien-signals signal read is counted through a pass-through wrapper,
 * so "the work one change costs does not depend on how many widgets the Runtime has" is asserted as exact
 * equality between two Runtime sizes. A per-change rescan of every widget (the O(N) per change / O(N²)
 * per N changes behavior this guards against) makes the counts differ.
 */

import { endBatch, startBatch } from 'alien-signals'
import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_DIAGNOSTICS } from '../index'

const counter = vi.hoisted(() => ({ signalReads: 0 }))

vi.mock('alien-signals', async (importOriginal) => {
	const actual = await importOriginal<typeof import('alien-signals')>()
	function countingSignal<T>(initialValue: T): { (): T, (value: T): void } {
		const inner = actual.signal(initialValue)
		function access(...args: [] | [T]): T | void {
			if (args.length === 0) {
				counter.signalReads++
				return inner()
			}
			inner(args[0])
		}
		return access as { (): T, (value: T): void }
	}
	return { ...actual, signal: countingSignal }
})

interface LeafInterfaces {
	state: {
		n: number
	}
}

const leaf = createWidgetPlugin('leaf')
	.description('Test widget')
	.interfaces<LeafInterfaces>()
	.state(state => state.n({
		validate: (input, ctx): input is number => {
			if (typeof input !== 'number')
				return false
			if (input < 0)
				ctx.addDiagnostic({ message: 'negative' })
			return input >= 0
		},
		default: () => 0,
	}))
	.done()

const group = createWidgetPlugin('group')
	.description('Test widget')
	.interfaces<{ slots: 'children' }>()
	.slots({ children: { description: 'Children' } })
	.done()

const system = createWidgetSystem({ plugins: [leaf, group] })

function createRuntime(size: number) {
	const blueprint = system.createBlueprint({
		id: 'root',
		type: 'group',
		slots: { children: Array.from({ length: size }, (_, index) => ({ id: `w${index}`, type: 'leaf' })) },
	})
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const leafWidget = (index: number) => {
		const widget = runtime.getWidget(`w${index}`)
		if (widget === null || widget.type !== 'leaf')
			throw new Error('expected a leaf widget')
		return widget
	}
	return { runtime, leafWidget }
}

function countReads(fn: () => void): number {
	const before = counter.signalReads
	fn()
	return counter.signalReads - before
}

describe('runtime diagnostic aggregate scaling', () => {
	it('serves an unchanged aggregate without revisiting widgets', () => {
		const work = [50, 500].map((size) => {
			const { runtime } = createRuntime(size)
			runtime.getDiagnostics()
			return countReads(() => {
				for (let i = 0; i < 10; i++)
					runtime.getDiagnostics()
			})
		})

		expect(work[1])
			.toBe(work[0])
	})

	it('re-aggregates only the changed widget for each change under a root subscription', () => {
		const work = [50, 500].map((size) => {
			const { runtime, leafWidget } = createRuntime(size)
			runtime.subscribeDiagnostics(() => {})
			const widget = leafWidget(Math.floor(size / 2))
			return countReads(() => {
				for (let i = 0; i < 10; i++) {
					widget.state.n.set(-1)
					widget.state.n.set(1)
				}
			})
		})

		expect(work[1])
			.toBe(work[0])
	})
})

describe('runtime diagnostic aggregate semantics under incremental aggregation', () => {
	it('publishes the accumulated diagnostics in Blueprint order, once per change', () => {
		const { runtime, leafWidget } = createRuntime(6)
		const published: string[][] = []
		runtime.subscribeDiagnostics(diagnostics => published.push(diagnostics.map(diagnostic => (diagnostic.location as { widgetId: string }).widgetId)))

		for (const index of [4, 1, 3])
			leafWidget(index).state.n.set(-1)
		leafWidget(1).state.n.set(2)

		expect(published)
			.toEqual([['w4'], ['w1', 'w4'], ['w1', 'w3', 'w4'], ['w3', 'w4']])
		expect(runtime.getDiagnostics())
			.toBe(runtime.getDiagnostics())
	})

	it('returns to the canonical empty snapshot and does not notify a change that was undone in one batch', () => {
		const { runtime, leafWidget } = createRuntime(3)
		const published: unknown[] = []
		runtime.subscribeDiagnostics(diagnostics => published.push(diagnostics))

		// A failure snapshot committed and then replaced by the empty one inside one batch: no net change.
		startBatch()
		try {
			leafWidget(0).state.n.set(-1)
			leafWidget(0).state.n.set(1)
		}
		finally {
			endBatch()
		}

		expect(published)
			.toEqual([])

		leafWidget(2).state.n.set(-1)
		leafWidget(2).state.n.set(0)

		expect(published)
			.toHaveLength(2)
		expect(published[1])
			.toBe(EMPTY_DIAGNOSTICS)
		expect(runtime.getDiagnostics())
			.toBe(EMPTY_DIAGNOSTICS)
	})
})
