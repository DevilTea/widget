/**
 * The script run inside the engine. Plain ECMAScript plus a feature-detected `print`, `queueMicrotask` and a clock;
 * no imports at run time (the bundle is self-contained), no Node APIs. run.mjs prepends
 * `globalThis.__WIDGET_BENCH__ = <config>` and parses the one result line this prints.
 *
 * config.kind:
 *   timing  { workload, size, samples, maxSeconds }  -> { rows: [...] }
 *   probe   { shape, phase, length }                 -> { outcome: { ok, stage, error? } }
 *   info                                            -> { engine facts, including the plain recursion depth }
 */

import { clockName, fineClock, measure } from './measure.mjs'
import { attempt } from './probes.mjs'
import { createStandard, guardStandard, WORKLOADS } from './workloads.mjs'

const MARKER = '@@QJSBENCH@@ '

// Some embedded engines lack queueMicrotask; the library needs it for its deferred notifications.
if (typeof queueMicrotask !== 'function') {
	globalThis.queueMicrotask = callback => Promise.resolve()
		.then(callback)
}

// Not named `print`: a classic-script load would turn this declaration into the global it is looking for.
function printLine(text) {
	if (typeof globalThis.print === 'function')
		globalThis.print(text)
	else if (typeof console !== 'undefined')
		console.log(text)
	else
		throw new TypeError('no print function (expected print or console.log)')
}

function emit(payload) {
	printLine(MARKER + JSON.stringify(payload))
}

/**
 * How many nested calls of a function that does nothing else fit before the engine reports stack exhaustion: a
 * calibration of the engine's stack limit that depends on nothing of Core (the sweep of stack sizes prints it, so a
 * `--stack-size` that the engine reads in another unit shows up as a depth that does not scale).
 */
function plainRecursionDepth() {
	let depth = 0
	function recurse() {
		depth++
		recurse()
	}
	try {
		recurse()
	}
	catch {}
	return depth
}

function engineFacts() {
	const facts = { clock: clockName, fineClock }
	if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string')
		facts.userAgent = navigator.userAgent
	return facts
}

function runTiming(config) {
	const workload = WORKLOADS[config.workload]
	if (workload === undefined)
		throw new Error(`unknown workload ${config.workload}`)
	const standard = createStandard(config.size)
	guardStandard(standard)
	const operation = workload(standard)
	const result = measure(operation, { samples: config.samples, maxSeconds: config.maxSeconds })
	return {
		rows: [{
			workload: config.workload,
			size: config.size,
			unit: 'ns/op',
			median: result.median,
			min: result.min,
			max: result.max,
			spread: result.spread,
			samples: result.samples,
			reps: result.reps,
			truncated: result.truncated,
			raw: result.raw,
		}],
	}
}

function main() {
	const config = globalThis.__WIDGET_BENCH__
	if (config === undefined)
		throw new Error('missing globalThis.__WIDGET_BENCH__ (run this bundle through benchmarks/quickjs/run.mjs)')
	try {
		if (config.kind === 'info')
			emit({ ...engineFacts(), plainRecursionDepth: plainRecursionDepth() })
		else if (config.kind === 'timing')
			emit({ ...engineFacts(), ...runTiming(config) })
		else if (config.kind === 'probe')
			emit({ outcome: attempt(config) })
		else
			throw new Error(`unknown config kind ${config.kind}`)
	}
	catch (error) {
		emit({ error: { name: String(error?.name), message: String(error?.message), stack: String(error?.stack) } })
	}
}

main()
