/**
 * The measurement loop. One "case" is one operation at one size:
 *
 *   {
 *     fresh?(i)   untimed; builds the input of one timed call (a new Blueprint, a new Runtime, ...)
 *                 so that an operation which caches or mutates is never measured as a cache hit.
 *     run(input)  the TIMED region: exactly one call of the operation under test. Its return value
 *                 is kept alive in a sink so the engine cannot drop the work.
 *     after?(input, output)  untimed; releases what the call produced (dispose, ...).
 *     ops?        logical operations done by one run() call (default 1); the per-op figure divides by it.
 *     dispose?()  untimed; called once after the last sample.
 *   }
 *
 * A sample is the time of one batch of `batch` run() calls divided by `batch`. Fast operations are batched
 * so a sample lasts at least a couple of milliseconds; inputs for a whole batch are built before the clock
 * starts. With --expose-gc a full collection runs before every sample (outside the timed region).
 */

import { performance } from 'node:perf_hooks'
import v8 from 'node:v8'
import { summarize } from './stats.mjs'

const collectGarbage = typeof globalThis.gc === 'function' ? globalThis.gc : null

/**
 * Profile mode (see profile.mjs): no forced collection between samples, longer sampling, and the case's
 * un-timed callbacks are wrapped in functions with fixed names so the profile summary can drop the samples
 * that belong to set-up and clean-up.
 */
let profileMode = false
export function enableProfileMode() {
	profileMode = true
}
function instrumentForProfile(c) {
	const wrapped = { ...c }
	if (c.fresh)
		wrapped.fresh = function benchUntimedFresh(i) { return c.fresh(i) }
	if (c.after)
		wrapped.after = function benchUntimedAfter(i, o) { return c.after(i, o) }
	return wrapped
}

let sink
/** Keeps a value reachable so the work that produced it cannot be optimized away. */
export function consume(value) {
	sink = value
	return value
}
export function sinkValue() {
	return sink
}

export const TARGET_SAMPLE_MS = 2
export const MAX_SPREAD = 0.1
const HARD_WALL_MS = 60000

function now() {
	return performance.now()
}

/** Times one batch and returns nanoseconds per call. */
function timeBatch(c, batch) {
	const inputs = c.fresh ? Array.from({ length: batch }) : null
	if (inputs) {
		for (let i = 0; i < batch; i++)
			inputs[i] = c.fresh(i)
	}
	const outputs = c.after ? Array.from({ length: batch }) : null
	if (collectGarbage && !profileMode)
		collectGarbage()

	let start
	let end
	if (inputs === null) {
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
			outputs[i] = c.run(inputs[i])
		end = now()
		for (let i = 0; i < batch; i++)
			c.after(inputs[i], outputs[i])
	}
	return ((end - start) * 1e6) / batch
}

/** Same as timeBatch for a case whose run() returns a promise (awaited inside the timed region). */
async function timeBatchAsync(c, batch) {
	const inputs = c.fresh ? Array.from({ length: batch }) : null
	if (inputs) {
		for (let i = 0; i < batch; i++)
			inputs[i] = c.fresh(i)
	}
	const outputs = c.after ? Array.from({ length: batch }) : null
	if (collectGarbage && !profileMode)
		collectGarbage()
	const start = now()
	for (let i = 0; i < batch; i++) {
		const out = await c.run(inputs === null ? undefined : inputs[i])
		sink = out
		if (outputs !== null)
			outputs[i] = out
	}
	const end = now()
	if (outputs !== null) {
		for (let i = 0; i < batch; i++)
			c.after(inputs[i], outputs[i])
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
 * @param {object} original the case (see above)
 * @param {{ quick?: boolean }} [options]
 */
export async function measureCase(original, options = {}) {
	const c = profileMode ? instrumentForProfile(original) : original
	const quick = options.quick === true
	const batchCap = c.maxBatch ?? (c.fresh ? 40 : 100000)
	const timeOne = n => (c.async ? timeBatchAsync(c, n) : timeBatch(c, n))

	// 1. Single cold call: tells us roughly how slow the operation is. It is also the first warm-up call.
	const first = await timeOne(1)
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
	if (c.dispose)
		c.dispose()
	return {
		...stats,
		batch,
		warmups,
		timedMs,
		wallMs: now() - startedAt,
		extended,
		unreliable: stats.spread > MAX_SPREAD,
		firstNs: first,
	}
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
	if (c.dispose)
		c.dispose()
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
