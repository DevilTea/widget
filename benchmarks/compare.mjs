/**
 * `node benchmarks/compare.mjs <A> <B> [--threshold <percent, default 5>] [--mode normal,jitless,alloc]
 *                              [--only-significant] [--json <file>]`
 *
 * A and B are each one `pnpm bench --json` result file or a comma-separated list of them (`a1.json,a2.json`).
 * The files are joined by scenario id, mode, variant name and size, and per mode one table is printed: the value
 * of each side (the median of the files' medians, or of their `bytes` for allocation rows), with a side's
 * min..max across its files when there are several, the B/A ratio, the spread of each side, the quality flags of
 * any file, and a verdict. Output is GitHub-flavoured markdown on stdout.
 *
 * With one file per side the verdict is today's: a marker where the values differ by more than the threshold,
 * and significance cannot be judged. With several files on a side a row is `significant` only when the values
 * differ by more than the threshold AND the two sides' min..max ranges do not overlap. Rows present in only one
 * side, rows skipped or not measured, and failed runs are listed separately. It serves both to test
 * reproducibility (same code on both sides: nothing should be significant) and for before/after comparisons.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { formatBytes, formatNs, markdownTable } from './lib/report.mjs'
import { median } from './lib/stats.mjs'

const MODES = ['normal', 'jitless', 'alloc']
const USAGE = 'usage: node benchmarks/compare.mjs <a.json[,a2.json...]> <b.json[,b2.json...]> [--threshold <percent>] [--mode normal,jitless,alloc] [--only-significant] [--json <file>]'

function parseArgs(argv) {
	const args = { sides: [], threshold: 5, modes: [...MODES], onlySignificant: false, json: null }
	const value = (i, option) => {
		if (i >= argv.length || argv[i].startsWith('--'))
			throw new Error(`${option} needs a value`)
		return argv[i]
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--threshold') {
			args.threshold = Number(value(++i, arg))
			if (!(args.threshold >= 0))
				throw new Error('--threshold must be a non-negative number (percent)')
		}
		else if (arg === '--mode') {
			args.modes = value(++i, arg)
				.split(',')
			const unknown = args.modes.filter(mode => !MODES.includes(mode))
			if (unknown.length > 0 || args.modes.length === 0)
				throw new Error(`unknown mode ${unknown.join(', ')} (known: ${MODES.join(', ')})`)
		}
		else if (arg === '--only-significant') {
			args.onlySignificant = true
		}
		else if (arg === '--json') {
			args.json = value(++i, arg)
		}
		else if (arg.startsWith('--')) {
			throw new Error(`unknown option ${arg}`)
		}
		else {
			args.sides.push(arg.split(',')
				.map(file => file.trim())
				.filter(file => file !== ''))
		}
	}
	if (args.sides.length !== 2 || args.sides.some(files => files.length === 0))
		throw new Error(USAGE)
	return args
}

/** Flattens a result file to a Map key -> row, plus the failed runs and the custom results it holds. */
function index(file, document) {
	const rows = new Map()
	const failed = []
	let custom = 0
	for (const result of document.results ?? []) {
		if (result.failed !== undefined) {
			failed.push(`${result.id} [${result.mode}]: ${result.failed}`)
			continue
		}
		if (result.custom) {
			custom++
			continue
		}
		for (const variant of result.variants ?? []) {
			for (const row of variant.rows) {
				const key = [result.mode, result.id, variant.name, row.size].join('\u0000')
				rows.set(key, { mode: result.mode, id: result.id, variant: variant.name, size: row.size, row })
			}
		}
	}
	return { file, document, rows, failed, custom }
}

const value = (mode, row) => (mode === 'alloc' ? row.bytes : row.median)
const format = (mode, number) => (mode === 'alloc' ? formatBytes(number) : formatNs(number))
const percent = number => (Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : '-')
const signed = ratio => `${ratio > 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)}%`

function flagsOf(row) {
	return row.flags ?? (row.unreliable ? ['spread'] : [])
}

function machineOf(document) {
	return document.info?.machine ?? document.info ?? {}
}

/** What one side says about one row: the values of its files that have it, their median and range, flags and spread. */
function sideOf(side, key, mode) {
	const entries = side.files.map(file => file.rows.get(key))
	const present = entries.filter(Boolean)
	const valid = present.filter(entry => value(mode, entry.row) > 0)
	const values = valid.map(entry => value(mode, entry.row))
	const flags = new Map()
	for (const entry of present) {
		for (const flag of flagsOf(entry.row))
			flags.set(flag, (flags.get(flag) ?? 0) + 1)
	}
	return {
		present: present.length,
		skipped: present.length - valid.length,
		n: values.length,
		values,
		perFile: entries.map(entry => (entry === undefined ? null : value(mode, entry.row) > 0 ? value(mode, entry.row) : null)),
		median: values.length > 0 ? median(values) : Number.NaN,
		min: values.length > 0 ? Math.min(...values) : Number.NaN,
		max: values.length > 0 ? Math.max(...values) : Number.NaN,
		spread: valid.length > 0 ? Math.max(...valid.map(entry => entry.row.spread ?? 0)) : Number.NaN,
		flags: Object.fromEntries(flags),
	}
}

function flagText(name, side, files) {
	const parts = Object.entries(side.flags)
		.map(([flag, count]) => (files > 1 ? `${flag}(${count}/${side.present})` : flag))
	return parts.length > 0 ? `${name}:${parts.join(',')}` : ''
}

function rangeText(mode, side) {
	if (side.n === 0)
		return '-'
	const range = side.min === side.max ? format(mode, side.min) : `${format(mode, side.min)}..${format(mode, side.max)}`
	return `${range} (n=${side.n})`
}

function describeFile(label, file) {
	const { document } = file
	const machine = machineOf(document)
	const info = document.info ?? {}
	const memory = machine.totalMemoryBytes ? `${(machine.totalMemoryBytes / 2 ** 30).toFixed(0)} GiB` : '?'
	return [
		label,
		file.file,
		`${info.git ?? '?'}${info.dirty ? ' (dirty)' : ''}`,
		info.harnessGit ? `${info.harnessGit}${info.harnessDirty ? ' (dirty)' : ''}` : '-',
		info.packagesRoot ?? '-',
		info.dist
			? Object.entries(info.dist)
					.map(([pkg, hash]) => `${pkg}:${hash ?? '-'}`)
					.join(' ')
			: '?',
		info.staleDist ? (info.staleDist.length > 0 ? info.staleDist.join(', ') : 'none') : '?',
		`${machine.cpu ?? '?'}, ${machine.cores ?? '?'} cores, ${memory}`,
		`${machine.node ?? '?'} / ${machine.platform ?? '?'}`,
		`${info.startedAt ?? '?'} - ${info.finishedAt ?? '?'}${info.complete === false ? ' (INCOMPLETE)' : ''}`,
	]
}

/** Warnings about the inputs: disagreement inside a side, machines, stale or incomplete or quick runs. */
function inputWarnings(sides) {
	const warnings = []
	const distinct = (files, pick) => [...new Set(files.map(pick))]
	for (const side of sides) {
		const gits = distinct(side.files, file => `${file.document.info?.git ?? '?'}${file.document.info?.dirty ? ' (dirty)' : ''}`)
		if (gits.length > 1)
			warnings.push(`the files of ${side.name} disagree on git (${gits.join(' vs ')}): they are not repeats of the same code`)
		for (const pkg of ['core', 'vue', 'inspector']) {
			const hashes = distinct(side.files, file => file.document.info?.dist?.[pkg] ?? '?')
			if (hashes.length > 1)
				warnings.push(`the files of ${side.name} disagree on the ${pkg} dist fingerprint (${hashes.join(' vs ')}): they did not measure the same built code`)
		}
	}
	const all = sides.flatMap(side => side.files.map(file => ({ side: side.name, file })))
	const fields = { cpu: 'cpu', cores: 'core count', totalMemoryBytes: 'memory', platform: 'platform', node: 'node version' }
	for (const [field, label] of Object.entries(fields)) {
		const bySide = sides.map(side => [...new Set(side.files.map(file => machineOf(file.document)[field] ?? '?'))])
		const within = bySide.flatMap((values, i) => (values.length > 1 ? [`${sides[i].name}: ${values.join(' vs ')}`] : []))
		if (within.length > 0)
			warnings.push(`the ${label} differs between the files of one side (${within.join('; ')})`)
		else if (bySide[0][0] !== bySide[1][0])
			warnings.push(`the machines differ between A and B (${label}: ${bySide[0][0]} vs ${bySide[1][0]})`)
	}
	for (const { side, file } of all) {
		const name = `${side} file ${file.file}`
		if (file.document.info?.staleDist?.length > 0)
			warnings.push(`${name} was measured with a stale dist (${file.document.info.staleDist.join(', ')}): it measured old code`)
		if (file.document.args?.quick)
			warnings.push(`${name} is a --quick run: its numbers are not baseline quality`)
		if (file.document.info?.complete === false)
			warnings.push(`${name} is incomplete: the run was interrupted or still running`)
	}
	if (new Set(all.map(({ file }) => Boolean(file.document.args?.quick))).size > 1)
		warnings.push('the files differ in --quick')
	return warnings
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	const sides = args.sides.map((files, i) => ({
		name: i === 0 ? 'A' : 'B',
		files: files.map(file => index(file, JSON.parse(readFileSync(file, 'utf8')))),
	}))
	const [a, b] = sides
	const limit = args.threshold / 100
	const judged = a.files.length > 1 || b.files.length > 1

	// Row keys in order of first appearance: A's files first, then what only B's files have.
	const keys = []
	const seen = new Set()
	for (const side of sides) {
		for (const file of side.files) {
			for (const key of file.rows.keys()) {
				if (!seen.has(key)) {
					seen.add(key)
					keys.push(key)
				}
			}
		}
	}

	const joined = []
	const onlyA = []
	const onlyB = []
	const incomparable = []
	for (const key of keys) {
		const [mode, id, variant, sizeText] = key.split('\u0000')
		if (!args.modes.includes(mode))
			continue
		const size = Number(sizeText)
		const left = sideOf(a, key, mode)
		const right = sideOf(b, key, mode)
		const label = `[${mode}] ${id} / ${variant} / ${size}`
		if (left.present === 0) {
			onlyB.push(label)
			continue
		}
		if (right.present === 0) {
			onlyA.push(label)
			continue
		}
		if (left.n === 0 || right.n === 0) {
			const describe = (side, name) => (side.n === 0 ? `${name} skipped or not measured` : `${name} ${format(mode, side.median)}`)
			incomparable.push(`${label}: ${describe(left, 'A')}, ${describe(right, 'B')}`)
			continue
		}
		const ratio = right.median / left.median
		const over = Math.abs(ratio - 1) > limit
		const overlap = left.max >= right.min && right.max >= left.min
		const significant = judged && over && !overlap
		const direction = mode === 'alloc' ? ['more', 'less'] : ['slower', 'faster']
		joined.push({
			mode,
			id,
			variant,
			size,
			a: left,
			b: right,
			ratio,
			over,
			overlap,
			significant,
			direction: ratio > 1 ? direction[0] : direction[1],
			flagged: Object.keys(left.flags).length + Object.keys(right.flags).length > 0,
		})
	}

	// A row is reported when it is significant (several files), or over the threshold (one file per side).
	const reported = row => (judged ? row.significant : row.over)
	const summaryRows = []
	for (const mode of args.modes) {
		const rows = joined.filter(row => row.mode === mode)
		if (rows.length === 0)
			continue
		const shown = args.onlySignificant ? rows.filter(reported) : rows
		const geomean = Math.exp(rows.reduce((sum, row) => sum + Math.log(row.ratio), 0) / rows.length)
		const worse = rows.filter(row => reported(row) && row.ratio > 1).length
		const better = rows.filter(row => reported(row) && row.ratio < 1).length
		summaryRows.push([mode, rows.length, worse, better, geomean.toFixed(3)])
		if (shown.length === 0 && args.onlySignificant)
			continue
		console.log(`\n## ${mode}${mode === 'alloc' ? ' (bytes per run)' : ' (median per run)'}\n`)
		const verdict = (row) => {
			if (judged)
				return row.significant ? `${row.direction} ${signed(row.ratio)}` : row.over ? `overlap ${signed(row.ratio)}` : ''
			return row.over ? `${row.direction} ${signed(row.ratio)}` : ''
		}
		const columns = judged
			? ['scenario', 'variant', 'size', 'A', 'A range', 'B', 'B range', 'B/A', 'spread A', 'spread B', 'flags', `significant (> ${args.threshold}%, ranges apart)`]
			: ['scenario', 'variant', 'size', 'A', 'B', 'B/A', 'spread A', 'spread B', 'flags', `> ${args.threshold}%`]
		const table = shown.map((row) => {
			const flags = [flagText('A', row.a, a.files.length), flagText('B', row.b, b.files.length)].filter(Boolean)
				.join(' ')
			const head = [row.id, row.variant, row.size, format(mode, row.a.median)]
			return judged
				? [...head, rangeText(mode, row.a), format(mode, row.b.median), rangeText(mode, row.b), row.ratio.toFixed(3), percent(row.a.spread), percent(row.b.spread), flags, verdict(row)]
				: [...head, format(mode, row.b.median), row.ratio.toFixed(3), percent(row.a.spread), percent(row.b.spread), flags, verdict(row)]
		})
		console.log(markdownTable(columns, table))
		console.log(`\ngeometric mean of B/A over ${rows.length} rows: ${geomean.toFixed(3)}`)
	}

	const listing = (title, items) => {
		if (items.length === 0)
			return
		if (args.onlySignificant) {
			console.log(`\n${title}: ${items.length} (not listed with --only-significant)`)
		}
		else {
			console.log(`\n${title} (${items.length}):\n${items.map(item => `  ${item}`)
				.join('\n')}`)
		}
	}
	const files = side => side.files.map(file => file.file)
		.join(', ')
	listing(`Only in A (${files(a)})`, onlyA)
	listing(`Only in B (${files(b)})`, onlyB)
	listing('Present in both but not comparable (skipped or not measured)', incomparable)
	const failedRuns = sides.flatMap(side => side.files.map(file => ({ side: side.name, file })))
		.filter(({ file }) => file.failed.length > 0)
	for (const { side, file } of failedRuns) {
		console.log(`\nFailed runs in ${side} file ${file.file} (${file.failed.length}):\n${file.failed.map(item => `  ${item}`)
			.join('\n')}`)
	}
	const customs = sides.map(side => side.files.reduce((sum, file) => sum + file.custom, 0))
	if (customs[0] + customs[1] > 0)
		console.log(`\nNot compared: ${customs[0]} custom result(s) in A, ${customs[1]} in B (memory, size and load tables are not row-wise comparable).`)

	const compared = joined.length
	const flagged = joined.filter(row => row.flagged).length
	console.log('\n## Summary\n')
	const wording = judged ? 'significant' : `over the ${args.threshold}% threshold`
	console.log(`rows compared: ${compared}; ${wording}: ${summaryRows.reduce((sum, row) => sum + row[2] + row[3], 0)}; flagged (spread, tail, drift or few) in any file: ${flagged}\n`)
	const [slower, faster] = ['slower or more', 'faster or less']
	console.log(markdownTable(['mode', 'rows compared', `${judged ? 'significant' : 'over threshold'}, ${slower}`, `${judged ? 'significant' : 'over threshold'}, ${faster}`, 'geometric mean of B/A'], summaryRows))
	if (judged) {
		console.log(`\nA row is significant when the two sides' medians (of the files' medians) differ by more than ${args.threshold}% and the sides' min..max ranges across their files do not overlap. A: ${a.files.length} file(s), B: ${b.files.length} file(s).`)
	}
	else {
		console.log(`\nOne file per side: the spread of a single process cannot show how much processes differ from each other, so significance cannot be judged. The counts above are rows over the threshold. Give each side several files (comma-separated) to judge it.`)
	}
	console.log(`\n${markdownTable(['', 'file', 'git', 'harness git', 'packages root', 'dist', 'stale dist', 'machine', 'node / platform', 'started - finished'], sides.flatMap(side => side.files.map((file, i) => describeFile(side.files.length > 1 ? `${side.name}${i + 1}` : side.name, file))))}`)
	for (const side of sides) {
		for (const [i, file] of side.files.entries())
			console.log(`\n${side.files.length > 1 ? `${side.name}${i + 1}` : side.name} options: ${JSON.stringify(file.document.args ?? {})}`)
	}

	const warnings = inputWarnings(sides)
	for (const warning of warnings)
		console.log(`\nWARNING: ${warning}.`)
	const dists = new Set(sides.flatMap(side => side.files.map(file => JSON.stringify(file.document.info?.dist ?? null))))
	if (dists.size === 1 && !dists.has('null'))
		console.log('\nNOTE: every file has the same dist fingerprints (the same built code): differences between A and B are noise, not a change.')

	if (args.json !== null) {
		const data = {
			threshold: args.threshold,
			modes: args.modes,
			judged,
			files: { a: a.files.map(file => file.file), b: b.files.map(file => file.file) },
			info: { a: a.files.map(file => file.document.info ?? null), b: b.files.map(file => file.document.info ?? null) },
			summary: summaryRows.map(([mode, rows, worse, better, geomean]) => ({ mode, rows, worse, better, geomean: Number(geomean) })),
			rows: joined,
			onlyA,
			onlyB,
			incomparable,
			failed: { a: a.files.map(file => file.failed), b: b.files.map(file => file.failed) },
			warnings,
		}
		writeFileSync(args.json, JSON.stringify(data, null, 1))
		console.error(`wrote ${args.json}`)
	}
}

try {
	main()
}
catch (error) {
	console.error(error.message)
	process.exitCode = 1
}
