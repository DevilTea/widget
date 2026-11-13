/**
 * `node benchmarks/compare.mjs <a.json> <b.json> [--threshold <percent, default 5>] [--mode normal,jitless,alloc]`
 *
 * Joins two result files written by `pnpm bench --json` by scenario id, mode, variant name and size and prints,
 * per mode, one table: medians of A and B, the B/A ratio, the spread of each, the quality flags of either
 * and a marker where the medians differ by more than the threshold. Allocation rows compare `bytes`.
 * Rows present in only one file are listed separately. It serves both to test reproducibility (same code, two
 * runs: nothing should be over the threshold) and for before/after comparisons.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { formatBytes, formatNs, markdownTable } from './lib/report.mjs'

const MODES = ['normal', 'jitless', 'alloc']

function parseArgs(argv) {
	const args = { files: [], threshold: 5, modes: [...MODES] }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--threshold') {
			args.threshold = Number(argv[++i])
			if (!(args.threshold >= 0))
				throw new Error('--threshold must be a non-negative number (percent)')
		}
		else if (arg === '--mode') {
			args.modes = (argv[++i] ?? '').split(',')
			const unknown = args.modes.filter(mode => !MODES.includes(mode))
			if (unknown.length > 0 || args.modes.length === 0)
				throw new Error(`unknown mode ${unknown.join(', ')} (known: ${MODES.join(', ')})`)
		}
		else if (arg.startsWith('--')) {
			throw new Error(`unknown option ${arg}`)
		}
		else {
			args.files.push(arg)
		}
	}
	if (args.files.length !== 2)
		throw new Error('usage: node benchmarks/compare.mjs <a.json> <b.json> [--threshold <percent>] [--mode normal,jitless,alloc]')
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
	return { file, rows, failed, custom }
}

const value = (mode, row) => (mode === 'alloc' ? row.bytes : row.median)
const format = (mode, number) => (mode === 'alloc' ? formatBytes(number) : formatNs(number))
const percent = number => (Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : '-')

function flagsOf(row) {
	return row.flags ?? (row.unreliable ? ['spread'] : [])
}

function machineOf(document) {
	return document.info?.machine ?? document.info ?? {}
}

function describeInfo(document) {
	const machine = machineOf(document)
	const info = document.info ?? {}
	const memory = machine.totalMemoryBytes ? `${(machine.totalMemoryBytes / 2 ** 30).toFixed(0)} GiB` : '?'
	return [
		['git', `${info.git ?? '?'}${info.dirty ? ' (dirty)' : ''}`],
		['dist', info.dist
			? Object.entries(info.dist)
					.map(([pkg, hash]) => `${pkg}:${hash ?? '-'}`)
					.join(' ')
			: '?'],
		['stale dist', info.staleDist ? (info.staleDist.length > 0 ? info.staleDist.join(', ') : 'none') : '?'],
		['machine', `${machine.cpu ?? '?'}, ${machine.cores ?? '?'} cores, ${memory}`],
		['node / platform', `${machine.node ?? '?'} / ${machine.platform ?? '?'}`],
		['started', info.startedAt ?? '?'],
		['finished', `${info.finishedAt ?? '?'}${info.complete === false ? ' (INCOMPLETE)' : ''}`],
	]
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	const [documentA, documentB] = args.files.map(file => JSON.parse(readFileSync(file, 'utf8')))
	const a = index(args.files[0], documentA)
	const b = index(args.files[1], documentB)
	const limit = args.threshold / 100

	let compared = 0
	let over = 0
	let flagged = 0
	const onlyA = []
	const onlyB = []
	const incomparable = []
	for (const mode of args.modes) {
		const rows = []
		const ratios = []
		for (const [key, left] of a.rows) {
			if (left.mode !== mode)
				continue
			const right = b.rows.get(key)
			const label = [left.id, left.variant, left.size]
			if (right === undefined) {
				onlyA.push(`[${mode}] ${label.join(' / ')}`)
				continue
			}
			const valueA = value(mode, left.row)
			const valueB = value(mode, right.row)
			if (!(valueA > 0) || !(valueB > 0)) {
				incomparable.push(`[${mode}] ${label.join(' / ')}: A ${left.row.skipped ? 'skipped' : format(mode, valueA)}, B ${right.row.skipped ? 'skipped' : format(mode, valueB)}`)
				continue
			}
			const ratio = valueB / valueA
			const flagsA = flagsOf(left.row)
			const flagsB = flagsOf(right.row)
			const isOver = Math.abs(ratio - 1) > limit
			compared++
			ratios.push(Math.log(ratio))
			if (isOver)
				over++
			if (flagsA.length > 0 || flagsB.length > 0)
				flagged++
			const flagText = [flagsA.length > 0 ? `A:${flagsA.join(',')}` : '', flagsB.length > 0 ? `B:${flagsB.join(',')}` : ''].filter(Boolean)
				.join(' ')
			const direction = mode === 'alloc' ? ['more', 'less'] : ['slower', 'faster']
			rows.push([
				...label,
				format(mode, valueA),
				format(mode, valueB),
				ratio.toFixed(3),
				percent(left.row.spread),
				percent(right.row.spread),
				flagText,
				isOver ? `${ratio > 1 ? direction[0] : direction[1]} ${ratio > 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)}%` : '',
			])
		}
		for (const [key, right] of b.rows) {
			if (right.mode === mode && !a.rows.has(key))
				onlyB.push(`[${mode}] ${right.id} / ${right.variant} / ${right.size}`)
		}
		if (rows.length === 0)
			continue
		const geomean = Math.exp(ratios.reduce((sum, r) => sum + r, 0) / ratios.length)
		console.log(`\n## ${mode}${mode === 'alloc' ? ' (bytes per run)' : ' (median per run)'}\n`)
		console.log(markdownTable(['scenario', 'variant', 'size', 'A', 'B', 'B/A', 'spread A', 'spread B', 'flags', `> ${args.threshold}%`], rows))
		console.log(`\ngeometric mean of B/A over ${rows.length} rows: ${geomean.toFixed(3)}`)
	}

	const listing = (title, items) => {
		if (items.length > 0) {
			console.log(`\n${title} (${items.length}):\n${items.map(item => `  ${item}`)
				.join('\n')}`)
		}
	}
	listing(`Only in A (${a.file})`, onlyA)
	listing(`Only in B (${b.file})`, onlyB)
	listing('Present in both but not comparable (skipped or not measured)', incomparable)
	listing(`Failed runs in A`, a.failed)
	listing(`Failed runs in B`, b.failed)
	if (a.custom + b.custom > 0)
		console.log(`\nNot compared: ${a.custom} custom result(s) in A, ${b.custom} in B (memory, size and load tables are not row-wise comparable).`)

	console.log('\n## Summary\n')
	console.log(`rows compared: ${compared}; over the ${args.threshold}% threshold: ${over}; flagged (spread, tail, drift or few) in either file: ${flagged}`)
	const infoA = describeInfo(documentA)
	const infoB = describeInfo(documentB)
	console.log(`\n${markdownTable(['', 'A', 'B'], infoA.map(([name, text], i) => [name, text, infoB[i][1]]))}`)
	console.log(`\nA = ${a.file}\n  options: ${JSON.stringify(documentA.args ?? {})}\nB = ${b.file}\n  options: ${JSON.stringify(documentB.args ?? {})}`)

	const machineA = machineOf(documentA)
	const machineB = machineOf(documentB)
	const warnings = []
	for (const field of ['cpu', 'cores', 'totalMemoryBytes', 'platform']) {
		if (machineA[field] !== machineB[field])
			warnings.push(`the machines differ (${field}: ${machineA[field] ?? '?'} vs ${machineB[field] ?? '?'})`)
	}
	if (machineA.node !== machineB.node)
		warnings.push(`the node versions differ (${machineA.node ?? '?'} vs ${machineB.node ?? '?'})`)
	for (const [name, document] of [['A', documentA], ['B', documentB]]) {
		if (document.info?.staleDist?.length > 0)
			warnings.push(`${name} was measured with a stale dist (${document.info.staleDist.join(', ')}): it measured old code`)
		if (document.args?.quick)
			warnings.push(`${name} is a --quick run: its numbers are not baseline quality`)
		if (document.info?.complete === false)
			warnings.push(`${name} is incomplete: the run was interrupted or still running`)
	}
	if (JSON.stringify(documentA.args?.quick) !== JSON.stringify(documentB.args?.quick))
		warnings.push('A and B differ in --quick')
	for (const warning of warnings)
		console.log(`\nWARNING: ${warning}.`)
}

try {
	main()
}
catch (error) {
	console.error(error.message)
	process.exitCode = 1
}
