/**
 * Plain-text (Markdown) tables from worker results.
 */

import { slope } from './stats.mjs'

export function formatNs(ns) {
	if (!Number.isFinite(ns))
		return '-'
	if (ns < 1e3)
		return `${ns.toFixed(ns < 10 ? 2 : 1)} ns`
	if (ns < 1e6)
		return `${(ns / 1e3).toFixed(ns < 1e4 ? 2 : 1)} us`
	if (ns < 1e9)
		return `${(ns / 1e6).toFixed(ns < 1e7 ? 2 : 1)} ms`
	return `${(ns / 1e9).toFixed(2)} s`
}

export function formatBytes(bytes) {
	if (!Number.isFinite(bytes))
		return '-'
	if (bytes < 1024)
		return `${Math.round(bytes)} B`
	if (bytes < 1024 * 1024)
		return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const pct = value => `${(value * 100).toFixed(1)}%`

/**
 * Spread cell text: the percentage, the `UNRELIABLE` marker for the `spread` flag, then the other flags
 * (tail, drift, few) in lower case. Rows from before the flags existed fall back to `unreliable`.
 */
export function spreadCell(row) {
	const flags = row.flags ?? (row.unreliable ? ['spread'] : [])
	const parts = [pct(row.spread)]
	if (flags.includes('spread'))
		parts.push('UNRELIABLE')
	parts.push(...flags.filter(flag => flag !== 'spread'))
	return parts.join(' ')
}

function slopeText(value) {
	if (!Number.isFinite(value))
		return '-'
	return `${value.toFixed(2)}${value > 1.15 ? ' !' : ''}`
}

export function markdownTable(columns, rows) {
	const widths = columns.map((column, i) => Math.max(String(column).length, ...rows.map(row => String(row[i] ?? '').length)))
	const line = cells => `| ${cells.map((cell, i) => String(cell ?? '')
		.padEnd(widths[i]))
		.join(' | ')} |`
	return [line(columns), `| ${widths.map(w => '-'.repeat(w))
		.join(' | ')} |`, ...rows.map(line)].join('\n')
}

function perUnit(variant, row) {
	if (row.skipped || !Number.isFinite(row.median))
		return '-'
	if ((row.ops ?? 1) > 1)
		return formatNs(row.median / row.ops)
	if (variant.perWidget && row.size > 0)
		return formatNs(row.median / row.size)
	return '-'
}

function perUnitHeader(variant) {
	if (variant.rows.some(row => (row.ops ?? 1) > 1))
		return '/op'
	if (variant.perWidget)
		return '/unit'
	return null
}

function slopesFor(rows) {
	const out = new Map()
	let previous = null
	for (const row of rows) {
		if (row.skipped || !Number.isFinite(row.median))
			continue
		out.set(row.size, previous === null ? Number.NaN : slope(previous.size, previous.median, row.size, row.median))
		previous = row
	}
	return out
}

/** One variant, normal and (optionally) jitless side by side. */
export function timingTable(variantName, sizeLabel, normal, jitless) {
	const header = perUnitHeader(normal)
	const columns = [sizeLabel, 'n', 'median', 'p95', 'spread', ...(header ? [header] : []), 'slope']
	if (jitless)
		columns.push('| jitless:', 'n', 'median', 'p95', 'spread', ...(header ? [header] : []), 'slope')
	const normalSlopes = slopesFor(normal.rows)
	const jitlessSlopes = jitless ? slopesFor(jitless.rows) : null
	const sizes = normal.rows.map(row => row.size)
	const rows = sizes.map((size, index) => {
		const a = normal.rows[index]
		const cells = [size]
		if (a.skipped) {
			cells.push('', 'skipped', '', '', ...(header ? [''] : []), '')
		}
		else {
			cells.push(
				a.n,
				formatNs(a.median),
				formatNs(a.p95),
				spreadCell(a),
				...(header ? [perUnit(normal, a)] : []),
				slopeText(normalSlopes.get(size)),
			)
		}
		if (jitless) {
			const b = jitless.rows.find(row => row.size === size)
			cells.push('|')
			if (b === undefined || b.skipped) {
				cells.push('', b?.skipped ? 'skipped' : '-', '', '', ...(header ? [''] : []), '')
			}
			else {
				cells.push(
					b.n,
					formatNs(b.median),
					formatNs(b.p95),
					spreadCell(b),
					...(header ? [perUnit(jitless, b)] : []),
					slopeText(jitlessSlopes.get(size)),
				)
			}
		}
		return cells
	})
	return markdownTable(columns, rows)
}

export function allocTable(variant) {
	const header = perUnitHeader(variant)
	const columns = ['size', 'bytes/run', ...(header ? [`bytes${header}`] : []), 'trials']
	const rows = variant.rows.map(row => [
		row.size,
		row.skipped ? 'skipped' : row.exceeded ? 'not measured (window > 200 MB)' : formatBytes(row.bytes),
		...(header ? [row.skipped || !Number.isFinite(row.bytes) ? '-' : formatBytes(row.bytes / ((row.ops ?? 1) > 1 ? row.ops : variant.perWidget && row.size > 0 ? row.size : 1))] : []),
		row.skipped ? '' : `${row.trials} (+${row.discarded} discarded)`,
	])
	return markdownTable(columns, rows)
}

/** Scaling summary for the ranked list: overall and tail slope of the median across sizes. */
export function scalingSummary(variant) {
	const rows = variant.rows.filter(row => !row.skipped && Number.isFinite(row.median) && row.size > 0)
	if (rows.length < 2)
		return null
	const first = rows[0]
	const last = rows[rows.length - 1]
	const before = rows[rows.length - 2]
	return {
		overall: slope(first.size, first.median, last.size, last.median),
		tail: slope(before.size, before.median, last.size, last.median),
		firstSize: first.size,
		lastSize: last.size,
		lastMedian: last.median,
	}
}

export function customTable(custom) {
	return `${custom.title}\n\n${markdownTable(custom.columns, custom.rows)}`
}
