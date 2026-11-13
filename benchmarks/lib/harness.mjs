/**
 * The measurement loop. One "case" is one operation at one size:
 *
 *   {
 *     fresh?(i)   untimed; builds the input of one timed call (a new Blueprint, a new Runtime, ...)
 *                 so that an operation which caches or mutates is never measured as a cache hit.
 *     run(input)  the TIMED region: exactly one call of the operation under test. Its return value
 *                 is kept alive in a sink so the engine cannot drop the work.
 *     after?(input, output)  untimed; releases what the call produced (dispose, ...). Called for every
 *                 run() call, with `input` undefined when the case has no fresh().
 *     ops?        logical operations done by one run() call (default 1); the per-op figure divides by it.
 *     maxBatch?   upper bound of the batch size.
 *     maxRunMs?   (variant or scenario level) a size is skipped when the previous size predicts more.
 *     async?      run() returns a promise, awaited inside the timed region.
 *     warmPass?   true: with a forced collection before the sample, run() is called once more, untimed
 *                 (and after() for it), right after the collection and immediately before the clock starts.
 *                 For a pure read over a large live heap, the first pass after a full collection runs
 *                 cache-cold (2 to 5 times the steady state), which reads as a superlinear slope. Only valid
 *                 for a case without fresh(): a warm pass has no input of its own to consume. Not applied
 *                 to the single cold call, in profile mode, without --expose-gc, or in allocation mode.
 *     dispose?()  untimed; called once after the last sample (also when the measurement throws).
 *   }
 *
 * A sample is the time of one batch of `batch` run() calls divided by `batch`. Fast operations are batched
 * so a sample lasts at least a couple of milliseconds; inputs for a whole batch are built before the clock
 * starts. With --expose-gc a full collection runs before every sample (outside the timed region).
 * The samples kept in a result are the per-call nanoseconds of the timed samples only, in collection
 * order; the cold call and the warm-up samples never enter them.
 */

import { performance } from 'node:perf_hooks'
import v8 from 'node:v8'
import { flagsFor, summarize } from './stats.mjs'

const collectGarbage = typeof globalThis.gc === 'function' ? globalThis.gc : null

/**
 * Profile mode (see profile.mjs): no forced collection between samples, longer sampling, and the start and
 * end instant of the clocked region of every batch are recorded (`performance.now()`, milliseconds), so the
 * profile summary can keep exactly the samples taken while the clock was running and call everything else
 * set-up, clean-up or harness. Bounding the timed region by time instead of by a wrapper function name is
 * what makes the attribution immune to inlining.
 */
let profileMode = false
let windows = []
export function enableProfileMode() {
	profileMode = true
	windows = []
}

/** The clocked regions recorded since the last call, as [start, end] pairs of `performance.now()` milliseconds. */
export function takeProfileWindows() {
	const taken = windows
	windows = []
	return taken
}

/**
 * Busy-waits in a function with a fixed name, so that the samples taken inside it can be recognized in the
 * profile. The loop is long-running and the function is called a handful of times, so it runs as its own frame.
 */
function benchClockMarker(ms) {
	const end = now() + ms
	let x = 0
	while (now() < end)
		x += Math.sqrt(x + 1)
	return x
}
function benchClockGap(ms) {
	const end = now() + ms
	let x = 0
	while (now() < end)
		x += Math.sqrt(x + 3)
	return x
}

const MARKER_COUNT = 24
const MARKER_MS = 2
const MARKER_GAP_MS = 1.2

/**
 * Calibration of the profile's clock: MARKER_COUNT busy-waits of MARKER_MS ms in benchClockMarker, separated by
 * gaps in benchClockGap, and the instants at which each marker started and ended. Run right after the profiler
 * starts and right before it stops; the summarizer finds the samples inside benchClockMarker and fits the
 * offset between this clock and the profile's (see lib/cpuprofile.mjs). Returns [start, end] pairs of
 * `performance.now()` milliseconds.
 */
export function runClockMarkers() {
	const out = []
	for (let i = 0; i < MARKER_COUNT; i++) {
		benchClockGap(MARKER_GAP_MS)
		const start = now()
		benchClockMarker(MARKER_MS)
		out.push([start, now()])
	}
	benchClockGap(MARKER_GAP_MS)
	return out
}

/** Keeps the value of the last call reachable so the work that produced it cannot be optimized away. */
let sink
/** The only reader of the sink: it makes the stores observable (and satisfies the unused-variable rule). */
export function sinkValue() {
	return sink
}

export const TARGET_SAMPLE_MS = 2
export const MAX_SPREAD = 0.1
const HARD_WALL_MS = 60000
/** A large semi-space reports at least this much `new_space`; the default configuration reports at most 16 MiB. */
const MIN_ALLOC_NEW_SPACE = 256 * 1024 * 1024

function now() {
	return performance.now()
}

/**
 * Forced collection before a sample (outside the clock). Returns true when one ran. `warm` asks for the
 * case's warm pass (see `warmPass` in the header), which is skipped when no collection was forced.
 */
function collectBefore(c, warm) {
	if (!collectGarbage || profileMode)
		return false
	collectGarbage()
	return warm && c.warmPass === true
}

/** Times one batch and returns nanoseconds per call. */
function timeBatch(c, batch, warm) {
	const inputs = c.fresh ? Array.from({ length: batch }) : null
	if (inputs) {
		for (let i = 0; i < batch; i++)
			inputs[i] = c.fresh(i)
	}
	const outputs = c.after ? Array.from({ length: batch }) : null
	if (collectBefore(c, warm)) {
		const out = c.run(undefined)
		sink = out
		if (c.after)
			c.after(undefined, out)
	}

	let start
	let end
	if (inputs === null && outputs === null) {
		// The bare loop: no input to fetch and no output to keep.
		start = now()
		for (let i = 0; i < batch; i++)
			sink = c.run(undefined)
		end = now()
	}
	else if (outputs === null) {
		start = now()
		for (let i = 0; i < batch; i++)
			sink = c.run(inputs[i])
		end = now()
	}
	else {
		start = now()
		for (let i = 0; i < batch; i++)
			outputs[i] = c.run(inputs === null ? undefined : inputs[i])
		end = now()
		for (let i = 0; i < batch; i++)
			c.after(inputs === null ? undefined : inputs[i], outputs[i])
	}
	if (profileMode)
		windows.push([start, end])
	return ((end - start) * 1e6) / batch
}

/** Same as timeBatch for a case whose run() returns a promise (awaited inside the timed region). */
async function timeBatchAsync(c, batch, warm) {
	const inputs = c.fresh ? Array.from({ length: batch }) : null
	if (inputs) {
		for (let i = 0; i < batch; i++)
			inputs[i] = c.fresh(i)
	}
	const outputs = c.after ? Array.from({ length: batch }) : null
	if (collectBefore(c, warm)) {
		const out = await c.run(undefined)
		sink = out
		if (c.after)
			c.after(undefined, out)
	}
	const start = now()
	for (let i = 0; i < batch; i++) {
		const out = await c.run(inputs === null ? undefined : inputs[i])
		sink = out
		if (outputs !== null)
			outputs[i] = out
	}
	const end = now()
	if (profileMode)
		windows.push([start, end])
	if (outputs !== null) {
		for (let i = 0; i < batch; i++)
			c.after(inputs === null ? undefined : inputs[i], outputs[i])
	}
	return ((end - start) * 1e6) / batch
}

function pickBatch(singleNs, cap) {
	const target = TARGET_SAMPLE_MS * 1e6
	if (singleNs >= target)
		return 1
	return Math.max(1, Math.min(cap, Math.ceil(target / Math.max(singleNs, 1))))
}

/**
 * Measures one case. Returns the summary of per-call nanoseconds plus how it was obtained.
 *
 * @param {object} c the case (see above)
 * @param {{ quick?: boolean }} [options]
 */
export async function measureCase(c, options = {}) {
	try {
		if (c.warmPass && c.fresh)
			throw new Error('a case with warmPass: true must not define fresh(): the warm pass has no input to consume')
		return await measureCaseBody(c, options)
	}
	finally {
		if (c.dispose)
			c.dispose()
	}
}

async function measureCaseBody(c, options) {
	const quick = options.quick === true
	const batchCap = c.maxBatch ?? (c.fresh ? 40 : 100000)
	const timeOne = (n, warm = true) => (c.async ? timeBatchAsync(c, n, warm) : timeBatch(c, n, warm))

	// 1. Single cold call: tells us roughly how slow the operation is. It is also the first warm-up call.
	// It gets no warm pass: it is the cold measurement.
	const first = await timeOne(1, false)
	let batch = pickBatch(first, batchCap)

	// 2. Warm-up until stable: the last four samples agree within 5%, bounded in count and time.
	const maxWarmups = first > 5e8 ? 1 : first > 1e8 ? 3 : quick ? 8 : 40
	const warmupDeadline = now() + (quick ? 1000 : 4000)
	const recent = []
	let warmups = 0
	while (warmups < maxWarmups && now() < warmupDeadline) {
		const t = await timeOne(batch)
		warmups++
		recent.push(t)
		if (recent.length > 4)
			recent.shift()
		if (recent.length === 4) {
			const lo = Math.min(...recent)
			const hi = Math.max(...recent)
			if ((hi - lo) / lo < 0.05)
				break
		}
	}
	// Re-pick the batch now that the operation is warm (it is usually faster than the cold call).
	const warm = recent.length > 0 ? recent[recent.length - 1] : first
	batch = pickBatch(warm, batchCap)

	// 3. Sampling.
	const minSamples = quick ? 5 : warm > 1e9 ? 5 : warm > 1e8 ? 9 : 21
	const maxSamples = profileMode ? 600 : quick ? 15 : 120
	const timedBudgetMs = profileMode ? 4000 : quick ? 300 : 1500
	const wallBudgetMs = quick ? 3000 : 20000
	const samples = []
	let timedMs = 0
	const startedAt = now()
	async function collect(extraBudget) {
		const budget = timedBudgetMs * extraBudget
		const wall = wallBudgetMs * extraBudget
		const roundStart = now()
		let roundTimed = 0
		while (samples.length < maxSamples * extraBudget) {
			const t = await timeOne(batch)
			samples.push(t)
			const sampleMs = (t * batch) / 1e6
			timedMs += sampleMs
			roundTimed += sampleMs
			if (samples.length >= minSamples && (roundTimed >= budget || now() - roundStart >= wall))
				break
			// Hard stop for very expensive set-up: never spend more than a minute on one size.
			if (now() - startedAt >= HARD_WALL_MS && samples.length >= 3)
				break
		}
	}
	await collect(1)
	let stats = summarize(samples)
	// 4. A spread above the threshold is not a result: take more samples once, then give up and flag it.
	let extended = false
	if (stats.spread > MAX_SPREAD) {
		extended = true
		await collect(2)
		stats = summarize(samples)
	}
	return {
		...stats,
		samples,
		minSamples,
		flags: flagsFor(stats, minSamples),
		batch,
		warmups,
		timedMs,
		wallMs: now() - startedAt,
		extended,
		unreliable: stats.spread > MAX_SPREAD,
		firstNs: first,
	}
}

function newSpaceBytes() {
	return v8.getHeapSpaceStatistics()
		.find(space => space.space_name === 'new_space')?.space_size ?? 0
}

/**
 * Approximate bytes allocated per call (garbage included), measured as the growth of the V8 heap across
 * one batch with no collection in between. Only meaningful in a process started with a semi-space large
 * enough that no scavenge happens inside the window (`--min-semi-space-size`), which the runner arranges for
 * the "alloc" mode. Trials during which the heap shrank are discarded. Approximate by construction.
 */
export async function measureAllocation(c) {
	if (!collectGarbage)
		throw new Error('measureAllocation needs --expose-gc')
	try {
		return await measureAllocationBody(c)
	}
	finally {
		if (c.dispose)
			c.dispose()
	}
}

async function measureAllocationBody(c) {
	const requireLargeSemiSpace = () => {
		const bytes = newSpaceBytes()
		if (bytes < MIN_ALLOC_NEW_SPACE)
			throw new Error(`allocation mode needs the large semi-space, but new_space is ${(bytes / 1048576).toFixed(0)} MiB; start node with --expose-gc --min-semi-space-size=512 --max-semi-space-size=512 (pnpm bench --mode alloc does)`)
	}
	requireLargeSemiSpace()
	// One untimed, uncounted call (with its fresh and after), so that the first trial is not a cold call.
	{
		const input = c.fresh ? c.fresh(0) : undefined
		const out = c.async ? await c.run(input) : c.run(input)
		sink = out
		if (c.after)
			c.after(input, out)
	}
	const trials = []
	let discarded = 0
	let batch = 1
	let exceeded = false
	// A window that allocates more than this may have run a scavenge in spite of the huge semi-space (observed
	// above roughly 300 MB), which would make the heap growth under-count; such a size is reported as not measured.
	const windowLimit = 200 * 1024 * 1024
	for (let attempt = 0; attempt < 14; attempt++) {
		const inputs = c.fresh ? Array.from({ length: batch }, (_, i) => c.fresh(i)) : null
		const outputs = c.after ? Array.from({ length: batch }) : null
		collectGarbage()
		collectGarbage()
		requireLargeSemiSpace()
		const before = v8.getHeapStatistics().used_heap_size
		const startedAt = now()
		for (let i = 0; i < batch; i++) {
			const out = c.async ? await c.run(inputs === null ? undefined : inputs[i]) : c.run(inputs === null ? undefined : inputs[i])
			sink = out
			if (outputs !== null)
				outputs[i] = out
		}
		const elapsedMs = now() - startedAt
		const after = v8.getHeapStatistics().used_heap_size
		if (c.after) {
			for (let i = 0; i < batch; i++)
				c.after(inputs === null ? undefined : inputs[i], outputs[i])
		}
		if (after < before) {
			discarded++
			continue
		}
		if (after - before > windowLimit) {
			exceeded = true
			break
		}
		const perCall = (after - before) / batch
		// First attempts size the batch so the window allocates about a megabyte (heap-counter granularity),
		// without letting one trial run longer than about 150 ms.
		if (attempt < 3 && perCall < 262144) {
			const byBytes = Math.ceil(1048576 / Math.max(perCall, 64))
			const byTime = Math.floor(150 / Math.max(elapsedMs / batch, 0.0005))
			batch = Math.max(1, Math.min(c.fresh ? 400 : 20000, byBytes, byTime))
			continue
		}
		trials.push(perCall)
		if (trials.length >= 7)
			break
	}
	if (trials.length === 0)
		return { bytes: Number.NaN, trials: 0, discarded, batch, exceeded }
	const stats = summarize(trials)
	return { bytes: stats.median, spread: stats.spread, trials: trials.length, discarded, batch, exceeded }
}

export function heapUsedAfterGc() {
	if (!collectGarbage)
		throw new Error('heapUsedAfterGc needs --expose-gc')
	for (let i = 0; i < 4; i++)
		collectGarbage()
	return v8.getHeapStatistics().used_heap_size
}

export { collectGarbage }
