/**
 * Small statistics helpers shared by the harness and the report code. No dependencies.
 */

export function median(sortedOrNot) {
	const values = [...sortedOrNot].sort((a, b) => a - b)
	const n = values.length
	if (n === 0)
		return Number.NaN
	const mid = n >> 1
	return n % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

/** Nearest-rank percentile (p in 0..100) over an unsorted list. */
export function percentile(values, p) {
	const sorted = [...values].sort((a, b) => a - b)
	if (sorted.length === 0)
		return Number.NaN
	const rank = Math.ceil((p / 100) * sorted.length)
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

/** Median absolute deviation. */
export function mad(values) {
	const m = median(values)
	return median(values.map(v => Math.abs(v - m)))
}

export const SPREAD_LIMIT = 0.1
export const TAIL_LIMIT = 1.25
export const DRIFT_LIMIT = 0.05

/**
 * Summary of one list of per-operation sample times (all in the same unit, nanoseconds here), given in
 * collection order.
 *
 * - `spread` is MAD / median: a robust relative dispersion. A result with `spread` above 0.10 is not
 *   considered a result (see README.md). MAD / median is blind to a slow tail and to drift, hence:
 * - `tail` is p95 / median;
 * - `drift` is |median(second half) - median(first half)| / median, halves taken in collection order (an odd
 *   middle sample belongs to neither);
 * - `iqr` is (q3 - q1) / median, quartiles by nearest rank.
 */
export function summarize(samples) {
	const med = median(samples)
	const relative = value => (med === 0 ? 0 : value / med)
	const half = samples.length >> 1
	const drift = half === 0 ? 0 : Math.abs(median(samples.slice(samples.length - half)) - median(samples.slice(0, half)))
	const m = mad(samples)
	const p95 = percentile(samples, 95)
	return {
		n: samples.length,
		median: med,
		p95,
		min: Math.min(...samples),
		max: Math.max(...samples),
		mad: m,
		spread: relative(m),
		tail: relative(p95),
		drift: relative(drift),
		iqr: relative(percentile(samples, 75) - percentile(samples, 25)),
	}
}

/**
 * Quality flags of a summary: `spread` (spread > 0.10), `tail` (n >= 20 and p95 / median > 1.25), `drift`
 * (n >= 10 and drift > 0.05), `few` (fewer samples than the sampler required).
 */
export function flagsFor(stats, minSamples) {
	const flags = []
	if (stats.spread > SPREAD_LIMIT)
		flags.push('spread')
	if (stats.n >= 20 && stats.tail > TAIL_LIMIT)
		flags.push('tail')
	if (stats.n >= 10 && stats.drift > DRIFT_LIMIT)
		flags.push('drift')
	if (stats.n < minSamples)
		flags.push('few')
	return flags
}

/** Log-log slope between two (size, value) points: 1.0 is linear, 2.0 is quadratic. */
export function slope(size1, value1, size2, value2) {
	if (!(value1 > 0) || !(value2 > 0) || size1 === size2)
		return Number.NaN
	return Math.log(value2 / value1) / Math.log(size2 / size1)
}
