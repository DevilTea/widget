/**
 * node benchmarks/quickjs/compare.mjs <a.json[,a2.json,...]> <b.json[,b2.json,...]>
 *
 * Markdown on stdout. Side A is the baseline, side B the candidate; several files on a side are repeated runs of
 * the same build (for example separate CI jobs). Per workload and size: the median of the files' medians per side,
 * the lowest and highest sample of the side's files (min..max), the ratio B/A (below 1 is faster), and
 * `significant` when the two min..max ranges do not overlap and the medians differ by more than 5 %. Then the
 * stack-probe results of both sides and the engine / git revision of every file.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

const SIGNIFICANT_DIFFERENCE = 0.05

function median(values) {
	const sorted = values.slice()
		.sort((a, b) => a - b)
	const mid = sorted.length >> 1
	return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function formatNs(ns) {
	if (ns >= 1e6)
		return `${(ns / 1e6).toFixed(ns >= 1e8 ? 0 : ns >= 1e7 ? 1 : 2)} ms`
	if (ns >= 1e3)
		return `${(ns / 1e3).toFixed(ns >= 1e5 ? 0 : ns >= 1e4 ? 1 : 2)} us`
	return `${ns.toFixed(0)} ns`
}

function loadSide(argument) {
	return argument.split(',')
		.filter(path => path !== '')
		.map((path) => {
			const data = JSON.parse(readFileSync(path, 'utf8'))
			if (data.schema !== 1)
				throw new Error(`${path}: unknown result schema ${data.schema}`)
			return { path, data }
		})
}

function describeFile({ path, data }) {
	const sha = data.git?.sha === null || data.git?.sha === undefined ? 'no git' : `${data.git.sha.slice(0, 10)}${data.git.dirty ? '+dirty' : ''}`
	const stack = data.args?.stackSize == null ? 'engine default stack' : `stack ${data.args.stackSize} KB`
	return `\`${path}\`: ${data.engine.name} ${data.engine.version} (${data.engine.command}; ${stack}; clock ${data.engine.clock ?? '?'}), git ${sha}, core ${data.bundle.core ?? '?'}, alien-signals ${data.bundle.alienSignals ?? '?'}, bundle ${data.bundle.bytes} bytes`
}

function combine(files) {
	const groups = new Map()
	for (const { data } of files) {
		for (const row of data.rows) {
			const key = `${row.workload}\0${row.size}`
			if (!groups.has(key))
				groups.set(key, { workload: row.workload, size: row.size, medians: [], mins: [], maxes: [] })
			const group = groups.get(key)
			group.medians.push(row.median)
			group.mins.push(row.min)
			group.maxes.push(row.max)
		}
	}
	for (const group of groups.values()) {
		group.median = median(group.medians)
		group.min = Math.min(...group.mins)
		group.max = Math.max(...group.maxes)
	}
	return groups
}

function probeCell(files, shape, phase) {
	const found = files.flatMap(({ data }) => (data.probes ?? [])
		.filter(probe => probe.shape === shape && probe.phase === phase))
	if (found.length === 0)
		return '-'
	const values = found.map(probe => probe.maxOk)
	const low = Math.min(...values)
	const high = Math.max(...values)
	const flags = `${found.some(probe => probe.ceiling) ? ' (ceiling, no failure)' : ''}${found.some(probe => probe.inconclusive) ? ' (process failure)' : ''}`
	return `${low === high ? low : `${low}..${high}`}${flags}`
}

function firstFailure(files, shape, phase) {
	for (const { data } of files) {
		const probe = (data.probes ?? [])
			.find(item => item.shape === shape && item.phase === phase)
		if (probe?.firstFail)
			return `${probe.firstFail.error.name}: ${probe.firstFail.error.message}`
	}
	return '-'
}

function main() {
	const [aArg, bArg] = process.argv.slice(2)
	if (aArg === undefined || bArg === undefined) {
		process.stderr.write('usage: node benchmarks/quickjs/compare.mjs <a.json[,a2.json,...]> <b.json[,b2.json,...]>\n')
		process.exit(2)
	}
	const sideA = loadSide(aArg)
	const sideB = loadSide(bArg)
	const a = combine(sideA)
	const b = combine(sideB)
	const out = []
	out.push('## QuickJS benchmark comparison', '')
	out.push('A (baseline):', ...sideA.map(file => `- ${describeFile(file)}`), '')
	out.push('B (candidate):', ...sideB.map(file => `- ${describeFile(file)}`), '')
	out.push('Medians are nanoseconds per operation (median of the medians of each side\'s files); `min..max` spans every sample of the side. Ratio is B/A: below 1 is faster. `significant`: the ranges do not overlap and the medians differ by more than 5 %.', '')
	out.push('| workload | widgets | A median | A min..max | B median | B min..max | B/A | |')
	out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
	const keys = [...new Set([...a.keys(), ...b.keys()])]
	for (const key of keys) {
		const left = a.get(key)
		const right = b.get(key)
		const { workload, size } = left ?? right
		if (left === undefined || right === undefined) {
			out.push(`| ${workload} | ${size} | ${left ? formatNs(left.median) : '-'} | ${left ? `${formatNs(left.min)}..${formatNs(left.max)}` : '-'} | ${right ? formatNs(right.median) : '-'} | ${right ? `${formatNs(right.min)}..${formatNs(right.max)}` : '-'} | - | only one side |`)
			continue
		}
		const ratio = right.median / left.median
		const disjoint = left.max < right.min || right.max < left.min
		const significant = disjoint && Math.abs(ratio - 1) > SIGNIFICANT_DIFFERENCE
		out.push(`| ${workload} | ${size} | ${formatNs(left.median)} | ${formatNs(left.min)}..${formatNs(left.max)} | ${formatNs(right.median)} | ${formatNs(right.min)}..${formatNs(right.max)} | ${ratio.toFixed(3)} | ${significant ? 'significant' : ''} |`)
	}
	out.push('')
	out.push('### Stack depth', '')
	out.push('Largest length that still works (bisection resolution about 1 %). Chain: one widget, Properties each reading the next, head declared first (counted in Properties). Survey: `visible` reads the next widget\'s `value`, `value` reads its own State and `visible` (counted in widgets, two Properties each).', '')
	out.push('| shape | phase | A max | B max | first failure (A) | first failure (B) |')
	out.push('| --- | --- | ---: | ---: | --- | --- |')
	for (const [shape, unit] of [['chain', 'properties'], ['survey', 'widgets']]) {
		for (const phase of ['compile', 'evaluate']) {
			out.push(`| ${shape} (${unit}) | ${phase === 'compile' ? 'compile' : 'cold read of the head'} | ${probeCell(sideA, shape, phase)} | ${probeCell(sideB, shape, phase)} | ${firstFailure(sideA, shape, phase)} | ${firstFailure(sideB, shape, phase)} |`)
		}
	}
	out.push('')
	const failures = [...sideA.map(file => ['A', file]), ...sideB.map(file => ['B', file])]
		.flatMap(([side, { path, data }]) => (data.failures ?? []).map(failure => `- ${side} \`${path}\`: ${failure.workload} @ ${failure.size}: ${failure.kind}: ${failure.message}`))
	if (failures.length > 0)
		out.push('### Failed measurement groups', '', ...failures, '')
	process.stdout.write(`${out.join('\n')}\n`)
}

main()
