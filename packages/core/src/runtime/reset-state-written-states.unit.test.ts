/**
 * Conformance coverage for what `resetState()` observes of States that were written, rewritten to their
 * initial value, rejected, or written by a listener while the reset runs: the observable behavior is that of
 * restoring every State in creation order (a write-order-sensitive sequence of notifications), with
 * unchanged States staying silent.
 */

import type { WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectRuntime } from '../inspection'

interface CellInterfaces extends WidgetInterfaces {
	state: {
		a: number
		b: number
		c: number
	}
}

const cell = createWidgetPlugin('cell')
	.description('Test widget')
	.interfaces<CellInterfaces>()
	.state(state => state
		.a({ validate: (input): input is number => typeof input === 'number', default: () => 1 })
		.b({ validate: (input): input is number => typeof input === 'number', default: () => 2 })
		.c({ validate: (input): input is number => typeof input === 'number', default: () => 3 }))
	.done()

interface NanInterfaces extends WidgetInterfaces {
	state: { value: number }
}

const nan = createWidgetPlugin('nan')
	.description('Test widget')
	.interfaces<NanInterfaces>()
	.state(state => state.value({ validate: (input): input is number => typeof input === 'number', default: () => Number.NaN }))
	.done()

const group = createWidgetPlugin('group')
	.description('Test widget')
	.interfaces<{ slots: 'children' }>()
	.slots({ children: { description: 'Children' } })
	.done()

const system = createWidgetSystem({ plugins: [cell, nan, group] })
const compiled = system.createBlueprint({
	id: 'root',
	type: 'group',
	slots: {
		children: [
			{ id: 'w1', type: 'cell' },
			{ id: 'w2', type: 'cell' },
			{ id: 'w3', type: 'cell' },
			{ id: 'n', type: 'nan' },
		],
	},
})
if (compiled.status !== 'valid')
	throw new Error('fixture setup error: expected a valid Blueprint')
const blueprint = compiled

type Runtime = ReturnType<typeof blueprint.createRuntime>

function cellOf(runtime: Runtime, id: string) {
	const widget = runtime.getWidget(id)
	if (widget === null || widget.type !== 'cell')
		throw new Error('expected a cell widget')
	return widget
}

function valuesOf(runtime: Runtime): number[] {
	return ['w1', 'w2', 'w3'].flatMap((id) => {
		const widget = cellOf(runtime, id)
		return [widget.state.a.get()!, widget.state.b.get()!, widget.state.c.get()!]
	})
}

const INITIAL = [1, 2, 3, 1, 2, 3, 1, 2, 3]

function inspectWidget(runtime: Runtime, id: string) {
	const inspection = inspectRuntime(runtime)
	const node = inspection.blueprint.nodes.find(candidate => candidate.node.id === id)
	return inspection.getWidget(node!.nodeId)!
}

/** Records, in order, the `id.key` of every State inspection notification (synchronous with the write). */
function recordInspection(runtime: Runtime, log: string[]): void {
	for (const id of ['w1', 'w2', 'w3']) {
		for (const key of ['a', 'b', 'c'] as const) {
			inspectWidget(runtime, id)
				.getState(key)!.subscribe(() => log.push(`${id}.${key}`))
		}
	}
}

describe('resetState with written States', () => {
	it('restores States in creation order whatever order they were written in, for every listener kind', () => {
		const runtime = blueprint.createRuntime()
		const inspectionLog: string[] = []
		recordInspection(runtime, inspectionLog)
		const stateLog: string[] = []
		for (const id of ['w1', 'w2', 'w3']) {
			for (const key of ['a', 'b', 'c'] as const)
				cellOf(runtime, id).state[key].subscribe(() => stateLog.push(`${id}.${key}`))
		}

		cellOf(runtime, 'w3').state.b.set(20)
		cellOf(runtime, 'w1').state.c.set(30)
		cellOf(runtime, 'w2').state.a.set(40)
		cellOf(runtime, 'w1').state.a.set(50)
		cellOf(runtime, 'w3').state.c.set(60)
		inspectionLog.length = 0
		stateLog.length = 0

		runtime.resetState()

		expect(inspectionLog)
			.toEqual(['w1.a', 'w1.c', 'w2.a', 'w3.b', 'w3.c'])
		expect(stateLog)
			.toEqual(['w1.a', 'w1.c', 'w2.a', 'w3.b', 'w3.c'])
		expect(valuesOf(runtime))
			.toEqual(INITIAL)
	})

	it('keeps a State written back to its initial value silent: no notification, same diagnostic snapshot', () => {
		const runtime = blueprint.createRuntime()
		const widget = cellOf(runtime, 'w2')
		widget.state.b.set(99)
		widget.state.b.set(2)
		const diagnosticsBefore = widget.state.b.getDiagnostics()
		const inspectionLog: string[] = []
		recordInspection(runtime, inspectionLog)
		const notified: number[] = []
		widget.state.b.subscribe(value => notified.push(value!))
		const diagnosticNotifications: unknown[] = []
		widget.state.b.subscribeDiagnostics(diagnostics => diagnosticNotifications.push(diagnostics))

		runtime.resetState()

		expect(notified)
			.toEqual([])
		expect(inspectionLog)
			.toEqual([])
		expect(diagnosticNotifications)
			.toEqual([])
		expect(widget.state.b.getDiagnostics())
			.toBe(diagnosticsBefore)
		expect(widget.state.b.get())
			.toBe(2)
	})

	it('restores the diagnostic snapshot of a State whose only write attempt was rejected', () => {
		const runtime = blueprint.createRuntime()
		const widget = cellOf(runtime, 'w3')
		const initialDiagnostics = widget.state.a.getDiagnostics()
		expect(widget.state.a.set('nope' as unknown as number).ok)
			.toBe(false)
		expect(widget.state.a.getDiagnostics())
			.not
			.toBe(initialDiagnostics)
		const diagnosticNotifications: unknown[] = []
		widget.state.a.subscribeDiagnostics(diagnostics => diagnosticNotifications.push(diagnostics))
		const valueNotifications: unknown[] = []
		widget.state.a.subscribe(value => valueNotifications.push(value))

		runtime.resetState()

		expect(widget.state.a.getDiagnostics())
			.toBe(initialDiagnostics)
		expect(diagnosticNotifications)
			.toEqual([initialDiagnostics])
		expect(valueNotifications)
			.toEqual([])
		expect(widget.state.a.get())
			.toBe(1)
	})

	it('restores a State only once: a second reset is silent, and so is one after a widget-level reset', () => {
		const runtime = blueprint.createRuntime()
		const first = cellOf(runtime, 'w1')
		const second = cellOf(runtime, 'w2')
		first.state.a.set(10)
		second.state.a.set(20)
		const log: string[] = []
		recordInspection(runtime, log)

		first.resetState()
		expect(log)
			.toEqual(['w1.a'])
		log.length = 0

		// The Runtime-level reset restores what the widget-level one left alone, and nothing else.
		runtime.resetState()
		expect(log)
			.toEqual(['w2.a'])
		expect(valuesOf(runtime))
			.toEqual(INITIAL)
		log.length = 0

		runtime.resetState()
		first.resetState()
		expect(log)
			.toEqual([])
	})

	it('a widget-level reset leaves the other widgets\' written States for the next Runtime-level reset', () => {
		const runtime = blueprint.createRuntime()
		const first = cellOf(runtime, 'w1')
		const third = cellOf(runtime, 'w3')
		first.state.c.set(10)
		third.state.a.set(30)

		third.resetState()
		expect(valuesOf(runtime))
			.toEqual([1, 2, 10, 1, 2, 3, 1, 2, 3])

		runtime.resetState()
		expect(valuesOf(runtime))
			.toEqual(INITIAL)
	})

	it('restores a State a listener writes during the reset only when the reset has not passed it yet', () => {
		const runtime = blueprint.createRuntime()
		cellOf(runtime, 'w2').state.b.set(20)
		let armed = false
		// While w2.b is restored: w1.c (already passed) and w3.a (not reached yet) are written.
		inspectWidget(runtime, 'w2')
			.getState('b')!.subscribe(() => {
			if (!armed)
				return
			armed = false
			cellOf(runtime, 'w1').state.c.set(100)
			cellOf(runtime, 'w3').state.a.set(300)
		})
		const log: string[] = []
		cellOf(runtime, 'w1').state.c.subscribe(value => log.push(`w1.c=${value}`))
		cellOf(runtime, 'w3').state.a.subscribe(value => log.push(`w3.a=${value}`))

		armed = true
		runtime.resetState()

		// w3.a was written before the scan reached it, so the same reset restored it again (the batch coalesces the
		// two writes into one notification); w1.c, behind the
		// scan, keeps the listener's value.
		expect(valuesOf(runtime))
			.toEqual([1, 2, 100, 1, 2, 3, 1, 2, 3])
		expect(log)
			.toEqual(['w1.c=100', 'w3.a=1'])

		// ... and is restored by the next one.
		log.length = 0
		runtime.resetState()
		expect(valuesOf(runtime))
			.toEqual(INITIAL)
		expect(log)
			.toEqual(['w1.c=3'])
	})

	it('leaves a State its own restoration listener rewrote written, and restores it on the next reset', () => {
		const runtime = blueprint.createRuntime()
		const widget = cellOf(runtime, 'w1')
		widget.state.a.set(10)
		let rewrote = false
		inspectWidget(runtime, 'w1')
			.getState('a')!.subscribe(() => {
			if (!rewrote) {
				rewrote = true
				widget.state.a.set(77)
			}
		})

		runtime.resetState()
		expect(widget.state.a.get())
			.toBe(77)

		runtime.resetState()
		expect(widget.state.a.get())
			.toBe(1)
	})

	it('notifies on every reset for a State whose initial value is NaN, as writing NaN over NaN counts as a change', () => {
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('n')
		if (widget === null || widget.type !== 'nan')
			throw new Error('expected a nan widget')
		const notified: number[] = []
		widget.state.value.subscribe(value => notified.push(value!))
		const inspected: unknown[] = []
		inspectWidget(runtime, 'n')
			.getState('value')!.subscribe(snapshot => inspected.push(snapshot))

		runtime.resetState()
		runtime.resetState()
		widget.resetState()

		expect(notified)
			.toHaveLength(3)
		expect(inspected)
			.toHaveLength(3)
		expect(widget.state.value.get())
			.toBeNaN()
	})
})
