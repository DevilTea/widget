/**
 * The timed workloads, on the standard 8-ary tree fixture of `benchmarks/lib/gen.mjs`. Plain ECMAScript only
 * (see `measure.mjs`). The per-input logic of the `embedded.*` workloads replicates the `embedded.loop` scenario of
 * `benchmarks/scenarios/core-runtime.mjs` (that module cannot be imported here: it has a top-level
 * `await` on a Node-only loader and keeps the logic private), so the figures are comparable with the Node harness.
 */

import { createFixture, PROFILES } from '../lib/gen.mjs'
import { fineClock, now } from './measure.mjs'

/** The documents the Node scenarios call `treeOf(PROFILES.standard)`. */
export const STANDARD_TREE = { ...PROFILES.standard, shape: 'tree' }

/** Inputs per cycle, as in the Node scenario (input values depend on the input index alone). */
const INPUTS = 10

/** A Runtime of N widgets is retained once per repetition of a batch; this bounds the batch (widgets held at once). */
const HELD_WIDGETS = 8000

const heldCap = n => Math.max(1, Math.floor(HELD_WIDGETS / n))

export function createStandard(n) {
	const fixture = createFixture(STANDARD_TREE, n)
	const blueprint = fixture.compileValid()
	return { fixture, blueprint, ids: fixture.unitIds() }
}

// ----- the per-input logic (same as the embedded.loop scenario) ---------------------------------------

function actions(runtime, ids, i, trace) {
	const a = runtime.getWidget(ids[0])
	const b = runtime.getWidget(ids[1])
	const c = runtime.getWidget(ids[2])
	const rw = a.methods.rw()
	const emit = b.methods.emit(1000 + i)
	const invokeSelf = c.methods.invokeSelf()
	const p0 = a.properties.ps0.get().value
	const p1 = b.properties.ps0.get().value
	const p2 = a.properties.pw0.get().value
	const p3 = b.properties.pp0.get().value
	if (trace !== undefined)
		trace.push(JSON.stringify(rw), JSON.stringify(emit), JSON.stringify(invokeSelf), p0, p1, p2, p3)
	return p0 + p1 + p2 + p3
}

function makeOverrides(ids, i) {
	const overrideStateDefaults = {}
	for (let k = 0; k < 5; k++)
		overrideStateDefaults[ids[k]] = { s0: i + k, s1: i }
	return { overrideStateDefaults }
}

function applyByWrite(runtime, ids, i) {
	for (let k = 0; k < 5; k++) {
		const w = runtime.getWidget(ids[k])
		w.state.s0.set(i + k)
		w.state.s1.set(i)
	}
}

const logic = {
	createOverrides(blueprint, ids, i, trace) {
		const runtime = blueprint.createRuntime(makeOverrides(ids, i))
		const total = actions(runtime, ids, i, trace)
		runtime.dispose()
		return total
	},
	createWrites(blueprint, ids, i, trace) {
		const runtime = blueprint.createRuntime()
		applyByWrite(runtime, ids, i)
		const total = actions(runtime, ids, i, trace)
		runtime.dispose()
		return total
	},
	reuse(runtime, ids, i, trace) {
		runtime.resetState()
		applyByWrite(runtime, ids, i)
		return actions(runtime, ids, i, trace)
	},
}

// ----- correctness guard --------------------------------------------------------------------------

/**
 * Throws unless the document is valid and the embedded paths do real, identical work: the three paths give the same
 * 3 Method results and 4 Property values for the same inputs (the check the Node scenario makes), every result is
 * `ok` with a finite number where one is expected, and the values change from one input to the next.
 */
export function guardStandard({ fixture, blueprint, ids }) {
	if (blueprint.status !== 'valid')
		throw new Error(`guard: the document is not valid (status ${blueprint.status})`)
	if (ids.length < 5 || ids.length !== fixture.layout.units)
		throw new Error(`guard: expected ${fixture.layout.units} unit widgets, got ${ids.length}`)
	const runtime = blueprint.createRuntime()
	const snapshot = runtime.snapshotState()
	const snapshotWidgets = Object.keys(snapshot).length
	if (snapshotWidgets !== fixture.widgets)
		throw new Error(`guard: the snapshot holds ${snapshotWidgets} widgets, expected ${fixture.widgets}`)
	const traces = []
	for (let i = 0; i < INPUTS; i++) {
		const reference = []
		logic.createOverrides(blueprint, ids, i, reference)
		const writes = []
		logic.createWrites(blueprint, ids, i, writes)
		const reused = []
		logic.reuse(runtime, ids, i, reused)
		for (const [name, trace] of [['createWrites', writes], ['reuse', reused]]) {
			if (trace.length !== reference.length || trace.some((value, k) => value !== reference[k]))
				throw new Error(`guard: ${name} does not do the same work as createRuntime({ overrideStateDefaults }) on input ${i}: [${trace}] vs [${reference}]`)
		}
		for (let k = 0; k < 3; k++) {
			if (!String(reference[k])
				.startsWith('{"ok":true')) {
				throw new Error(`guard: Method ${k} did not succeed on input ${i}: ${reference[k]}`)
			}
		}
		for (let k = 3; k < 7; k++) {
			if (typeof reference[k] !== 'number' || !Number.isFinite(reference[k]))
				throw new Error(`guard: Property read ${k - 3} is not a finite number on input ${i}: ${reference[k]}`)
		}
		traces.push(reference.join('|'))
	}
	runtime.dispose()
	if (new Set(traces).size !== INPUTS)
		throw new Error('guard: the results do not depend on the input (the workload would measure nothing)')
	// resetState really restores the defaults and a write really lands.
	const probe = blueprint.createRuntime()
	const s0 = probe.getWidget(ids[0]).state.s0
	const before = s0.get()
	s0.set(before + 41)
	if (s0.get() !== before + 41)
		throw new Error('guard: a State write did not land')
	probe.resetState()
	if (s0.get() !== before)
		throw new Error('guard: resetState did not restore the default')
	probe.dispose()
}

// ----- operations ---------------------------------------------------------------------------------

const noPrepare = () => undefined
function noCleanup() {}

let sink = 0
/** Prevents an operation from being optimised away by an engine that could (QuickJS does not, Node might). */
export function consume(value) {
	sink += typeof value === 'number' ? value : 1
	return sink
}

let writeCounter = 1000

/** Each workload takes the standard fixture (built once per process) and returns an operation (see measure.mjs). */
export const WORKLOADS = {
	'compile': ({ fixture }) => ({
		cap: 1000000,
		prepare: noPrepare,
		run(_, reps) {
			for (let r = 0; r < reps; r++) {
				const blueprint = fixture.system.createBlueprint(fixture.source)
				if (blueprint.status !== 'valid')
					throw new Error('compile: the document is not valid')
			}
		},
		cleanup: noCleanup,
	}),
	'createRuntime': ({ fixture, blueprint }) => ({
		cap: heldCap(fixture.widgets),
		prepare: noPrepare,
		run(_, reps) {
			// Runtimes are kept in a batch and disposed after the clock stops.
			const held = []
			let own = 0
			for (let r = 0; r < reps; r++) {
				const start = now()
				const runtime = blueprint.createRuntime()
				own += now() - start
				held.push(runtime)
			}
			for (const runtime of held)
				runtime.dispose()
			return fineClock ? own : undefined
		},
		cleanup: noCleanup,
	}),
	'embedded.create-per-input': ({ blueprint, ids }) => ({
		cap: 1000000,
		prepare: noPrepare,
		run(_, reps) {
			let total = 0
			for (let r = 0; r < reps; r++)
				total += logic.createOverrides(blueprint, ids, r % INPUTS)
			consume(total)
		},
		cleanup: noCleanup,
	}),
	'embedded.reuse-resetState': ({ blueprint, ids }) => {
		const runtime = blueprint.createRuntime()
		return {
			cap: 1000000,
			prepare: noPrepare,
			run(_, reps) {
				let total = 0
				for (let r = 0; r < reps; r++)
					total += logic.reuse(runtime, ids, r % INPUTS)
				consume(total)
			},
			cleanup: noCleanup,
		}
	},
	'resetState': ({ blueprint, ids }) => {
		const runtime = blueprint.createRuntime()
		// 5 units, s0 and s1 each, written with a value that always differs (an equal write notifies nobody).
		const states = []
		for (let k = 0; k < 5; k++) {
			const w = runtime.getWidget(ids[k])
			states.push(w.state.s0, w.state.s1)
		}
		return {
			cap: 1000000,
			prepare: noPrepare,
			run(_, reps) {
				let own = 0
				for (let r = 0; r < reps; r++) {
					const v = writeCounter++
					for (const state of states)
						state.set(v)
					if (fineClock) {
						const start = now()
						runtime.resetState()
						own += now() - start
					}
					else {
						runtime.resetState()
					}
				}
				return fineClock ? own : undefined
			},
			cleanup: noCleanup,
		}
	},
	'snapshotState': ({ blueprint, ids }) => {
		const runtime = blueprint.createRuntime()
		runtime.getWidget(ids[0]).state.s0.set(7)
		return {
			cap: 1000000,
			prepare: noPrepare,
			run(_, reps) {
				let count = 0
				for (let r = 0; r < reps; r++)
					count += runtime.snapshotState() === undefined ? 0 : 1
				consume(count)
			},
			cleanup: noCleanup,
		}
	},
}
