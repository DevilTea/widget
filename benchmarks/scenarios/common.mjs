/** Shared constants and small helpers for scenario modules. */

export const SIZES = [100, 1000, 4000, 16000]

/**
 * Upper bound on how many fresh Blueprints/Runtimes of `n` widgets the harness may build ahead of one timed
 * batch (a Runtime of a few thousand widgets is tens of megabytes).
 */
export function freshBatch(n) {
	return Math.max(1, Math.floor(2000 / n))
}

/** The documents a "tree" variant uses. Profiles are defined in lib/gen.mjs. */
export function treeOf(profile, extra = {}) {
	return { ...profile, shape: 'tree', ...extra }
}

/** Counter used to produce a different value on every write (a write of an equal value notifies nobody). */
export function counter(start = 1) {
	let n = start
	return () => n++
}
