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

/**
 * Summary of one list of per-operation sample times (all in the same unit, nanoseconds here).
 * `spread` is MAD / median: a robust relative dispersion. A result with `spread` above 0.10 is not
 * considered a result (see README.md).
 */
export function summarize(samples) {
	const med = median(samples)
	return {
		n: samples.length,
		median: med,
		p95: percentile(samples, 95),
		min: Math.min(...samples),
		max: Math.max(...samples),
		mad: mad(samples),
		spread: med === 0 ? 0 : mad(samples) / med,
	}
}

/** Log-log slope between two (size, value) points: 1.0 is linear, 2.0 is quadratic. */
export function slope(size1, value1, size2, value2) {
	if (!(value1 > 0) || !(value2 > 0) || size1 === size2)
		return Number.NaN
	return Math.log(value2 / value1) / Math.log(size2 / size1)
}
