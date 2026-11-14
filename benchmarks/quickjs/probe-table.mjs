/**
 * Text of stack-probe results, shared by compare.mjs (A against B) and the stack-size sweep of the CI driver
 * (one column per stack size). Node only; the in-engine code never imports it.
 *
 * A probe that still worked at the cap of its search has `ceiling: true` and `maxOk` equal to the cap: that is a
 * lower bound, written "at least <cap>". A probe whose first attempt (`start`) already failed has `maxOk: 0`: "< <start>".
 */

import { PROBE_PHASES, PROBE_SHAPES } from './probe-defs.mjs'

/** One probe record as table text; `undefined` (the probe was not run) is "-". */
export function probeText(probe) {
	if (probe === undefined)
		return '-'
	const flag = probe.inconclusive ? ' (process failure)' : ''
	if (probe.ceiling)
		return `at least ${probe.maxOk}${flag}`
	if (probe.maxOk === 0)
		return `< ${probe.start ?? '?'}${flag}`
	return `${probe.maxOk}${flag}`
}

/** Several records of the same probe (repeated runs of one build) as one cell: a numeric range, or the distinct texts. */
export function probeCellText(probes) {
	if (probes.length === 0)
		return '-'
	const plain = probes.every(probe => !probe.ceiling && !probe.inconclusive && probe.maxOk > 0)
	if (plain) {
		const values = probes.map(probe => probe.maxOk)
		const low = Math.min(...values)
		const high = Math.max(...values)
		return low === high ? String(low) : `${low}..${high}`
	}
	return [...new Set(probes.map(probeText))].join(' / ')
}

export function findProbe(data, shape, phase) {
	return (data.probes ?? []).find(probe => probe.shape === shape && probe.phase === phase)
}

/** The rows of a probe table: `{ shape, unit, phase, label }` for every shape and phase, in the table's order. */
export function probeRows() {
	return PROBE_SHAPES.flatMap(({ shape, unit }) => PROBE_PHASES.map(({ phase, label }) => ({ shape, unit, phase, label })))
}

export const SHAPE_NOTE = 'Chain: one widget, Properties each reading the next, head declared first (counted in Properties). Survey: `visible` reads the next widget\'s `value`, `value` reads its own State and `visible` (counted in widgets, two Properties each).'

/**
 * Markdown table with one column per entry of `columns` (`{ label, data }`, `data` a parsed result file of run.mjs):
 * rows are shape and phase, preceded by the plain-recursion calibration of the engine. Rows no column ran are left out.
 */
export function renderSweepTable(columns) {
	const lines = []
	lines.push(`| shape and phase | ${columns.map(column => column.label)
		.join(' | ')} |`)
	lines.push(`| --- | ${columns.map(() => '---:')
		.join(' | ')} |`)
	lines.push(`| plain recursion depth of the engine (calibration, no Widget code) | ${columns.map(column => column.data.engine?.plainRecursionDepth ?? '-')
		.join(' | ')} |`)
	for (const { shape, unit, phase, label } of probeRows()) {
		const probes = columns.map(column => findProbe(column.data, shape, phase))
		if (probes.every(probe => probe === undefined))
			continue
		lines.push(`| ${shape} (${unit}): ${label} | ${probes.map(probeText)
			.join(' | ')} |`)
	}
	return lines.join('\n')
}
