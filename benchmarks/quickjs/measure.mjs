/**
 * In-engine timing. Plain ECMAScript only: this file is bundled and run by `qjs` (and by Node for the
 * calibration rows), so it must not touch any host API except the feature-detected clock below.
 *
 * An operation is `{ cap, prepare(reps), run(prepared, reps), cleanup(prepared) }`:
 *   - `prepare` builds whatever one timed call needs for `reps` repetitions (outside the clock);
 *   - `run` performs `reps` repetitions. If it returns a number, that number is the milliseconds it measured itself
 *     (an operation that needs untimed work between repetitions times only the part it cares about);
 *     otherwise the whole call is timed;
 *   - `cleanup` releases the batch (outside the clock);
 *   - `cap` bounds `reps` (the batch may hold one Runtime per repetition, so memory limits it).
 *
 * The engine has no `gc()` we may rely on, so nothing here collects garbage; a collection that happens during a
 * sample is part of that sample, and the median / MAD statistics absorb the occasional slow one.
 */

const TARGET_SAMPLE_MS = 20

const hasPerformanceNow = typeof performance !== 'undefined' && performance !== null && typeof performance.now === 'function'

/** Milliseconds, fractional when the engine allows it. */
export const now = hasPerformanceNow ? () => performance.now() : () => Date.now()
/** Whether `now()` is a high-resolution clock (operations that time only a part of themselves need it). */
export const fineClock = hasPerformanceNow
export const clockName = hasPerformanceNow ? 'performance.now' : 'Date.now'

export function median(values) {
	const sorted = values.slice()
		.sort((a, b) => a - b)
	const mid = sorted.length >> 1
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function summarize(values) {
	const med = median(values)
	const mad = median(values.map(v => Math.abs(v - med)))
	return {
		median: med,
		min: Math.min(...values),
		max: Math.max(...values),
		spread: med === 0 ? 0 : mad / med,
	}
}

function timeOnce(operation, prepared, reps) {
	const start = now()
	const own = operation.run(prepared, reps)
	const elapsed = now() - start
	return typeof own === 'number' ? own : elapsed
}

/**
 * Measures one operation: calibrates the repetitions per sample so a sample lasts at least about
 * TARGET_SAMPLE_MS, warms up, then takes `samples` samples. Returns nanoseconds per repetition.
 * `maxSeconds` bounds the timed work of one operation (at least 5 samples are always taken).
 */
export function measure(operation, { samples, maxSeconds = 60 }) {
	const cap = operation.cap ?? 1000000
	const began = now()
	let reps = 1
	let perRepMs = 0
	// Calibration doubles as the first warm-up: the first call is cold and is not trusted for the estimate alone.
	for (;;) {
		const prepared = operation.prepare(reps)
		let elapsed
		try {
			elapsed = timeOnce(operation, prepared, reps)
		}
		finally {
			operation.cleanup(prepared)
		}
		perRepMs = elapsed / reps
		if (elapsed >= TARGET_SAMPLE_MS * 1.25 || reps >= cap)
			break
		const wanted = perRepMs > 0 ? Math.ceil((TARGET_SAMPLE_MS * 1.5) / perRepMs) : reps * 8
		reps = Math.min(cap, Math.max(reps * 2, wanted))
	}
	// One more warm-up call at the final batch size (skipped when a single call already takes a long time).
	if (reps * perRepMs < 1000) {
		const prepared = operation.prepare(reps)
		try {
			timeOnce(operation, prepared, reps)
		}
		finally {
			operation.cleanup(prepared)
		}
	}
	const perRepNs = []
	let truncated = false
	for (let i = 0; i < samples; i++) {
		const prepared = operation.prepare(reps)
		let elapsed
		try {
			elapsed = timeOnce(operation, prepared, reps)
		}
		finally {
			operation.cleanup(prepared)
		}
		perRepNs.push(elapsed * 1e6 / reps)
		if (i + 1 >= 5 && (now() - began) / 1000 > maxSeconds) {
			truncated = i + 1 < samples
			break
		}
	}
	return {
		...summarize(perRepNs),
		samples: perRepNs.length,
		reps,
		truncated,
		raw: perRepNs,
	}
}
