/**
 * Plain data shared by the in-engine probes (probes.mjs, bundled into the engine script), the bisection driver
 * (run.mjs) and the tables (probe-table.mjs, compare.mjs). No imports, no host API.
 */

/** `start`: first length tried; `ceiling`: the cap of the bisection (a probe that still works there reports "at least <cap>"). */
export const PROBE_SHAPES = [
	{ shape: 'chain', unit: 'properties', start: 100, ceiling: 65536, label: 'chain' },
	{ shape: 'survey', unit: 'widgets', start: 50, ceiling: 32768, label: 'survey' },
]

/**
 * `warm`: the phase builds its state with a bottom-up read of every Property (tail first), never with a deep cold read,
 * and uses the "live" survey (see probes.mjs) in which a write to the tail reaches the head's value.
 */
export const PROBE_PHASES = [
	{ phase: 'compile', label: 'compile', warm: false },
	{ phase: 'evaluate', label: 'cold read of the head', warm: false },
	{ phase: 'warm-reread', label: 'warm re-read (write the tail, read the head)', warm: true },
	{ phase: 'unsubscribe', label: 'unsubscribe from the head', warm: true },
	{ phase: 'reread-after-unsubscribe', label: 're-read after unsubscribe', warm: true },
	{ phase: 'dispose', label: 'dispose with a subscriber', warm: true },
]

export const PROBE_PHASE_NAMES = PROBE_PHASES.map(item => item.phase)
