/**
 * Mechanical summary of a V8 `.cpuprofile` (the JSON written by `node --cpu-prof` or by the inspector's
 * Profiler domain): top functions by self time and by inclusive time, as percentages, with file and line.
 *
 * Samples are classified first. A sample whose stack contains one of the harness's un-timed wrapper functions
 * (benchUntimedFresh / benchUntimedAfter: input building and clean-up) is dropped from the percentages, and so
 * are the idle, program and garbage-collector pseudo frames, which are reported on their own line (a collector
 * pause cannot be attributed to a JavaScript function by this sampler). Frames of the harness itself and of
 * node internals are never listed.
 *
 * `dist` frames are mapped back to `src` by function NAME only (the built code is not minified, so names
 * survive); when several source functions share a name, all candidates are shown, and an anonymous function
 * is shown by its dist location only. Nothing is guessed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { root } from './load.mjs'

const UNTIMED = new Set(['benchUntimedFresh', 'benchUntimedAfter'])
const PSEUDO = new Set(['(root)', '(program)', '(idle)', '(garbage collector)'])
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'try', 'with', 'constructor'])

function walkSources(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name)
		if (statSync(path)
			.isDirectory()) {
			if (name !== 'node_modules' && name !== 'dist')
				walkSources(path, out)
		}
		else if (name.endsWith('.ts') && !name.endsWith('.unit.test.ts') && !name.endsWith('.d.ts') && name !== 'test-fixture.ts' && name !== 'test-fixtures.ts') {
			out.push(path)
		}
	}
	return out
}

/** function name -> [{ file, line }] over packages/*\/src (non-test). */
export function buildSourceIndex() {
	const index = new Map()
	const add = (name, file, line) => {
		if (KEYWORDS.has(name))
			return
		const list = index.get(name) ?? []
		list.push({ file: relative(root, file), line })
		index.set(name, list)
	}
	for (const pkg of ['core', 'vue', 'inspector']) {
		for (const file of walkSources(join(root, 'packages', pkg, 'src'))) {
			const lines = readFileSync(file, 'utf8')
				.split('\n')
			lines.forEach((text, i) => {
				let m = text.match(/^\s*(?:export\s+)?(?:async\s+)?function\*?\s+(\w+)/)
				if (m) {
					add(m[1], file, i + 1)
					return
				}
				m = text.match(/^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\b|\(|\w+\s*=>)/)
				if (m) {
					add(m[1], file, i + 1)
					return
				}
				m = text.match(/^\s*(?:(?:public|private|protected|static|readonly|async)\s+)*(?:get\s+|set\s+)?(\w+)\s*(?:<[^>]*>\s*)?\([^)]*\)\s*(?::[^={]+)?\{\s*$/)
				if (m)
					add(m[1], file, i + 1)
			})
		}
	}
	return index
}

function shortUrl(url) {
	if (!url)
		return ''
	let path = url.startsWith('file://') ? decodeURIComponent(url.slice(7)) : url
	if (path.startsWith(root))
		path = path.slice(root.length)
	const store = path.indexOf('node_modules/.pnpm/')
	if (store >= 0)
		path = `node_modules/${path.slice(path.indexOf('/node_modules/', store) + '/node_modules/'.length)}`
	return path
}

function isHarness(frame) {
	const url = frame.url ?? ''
	return url.includes('/benchmarks/lib/') || url.endsWith('/benchmarks/worker.mjs') || url.startsWith('node:') || url === ''
}

export function summarizeProfile(profile, { top = 15, sourceIndex = buildSourceIndex() } = {}) {
	const nodes = new Map(profile.nodes.map(node => [node.id, node]))
	const parent = new Map()
	for (const node of profile.nodes) {
		for (const child of node.children ?? [])
			parent.set(child, node.id)
	}
	const stackCache = new Map()
	function stackOf(id) {
		let cached = stackCache.get(id)
		if (cached === undefined) {
			cached = []
			for (let cur = id; cur !== undefined; cur = parent.get(cur))
				cached.push(cur)
			cached.reverse()
			stackCache.set(id, cached)
		}
		return cached
	}
	const frameKey = (frame) => {
		const name = (frame.functionName || '(anonymous)').replace(/\$\d+$/, '')
		return `${name}\u0000${frame.url}\u0000${frame.lineNumber}`
	}
	const stats = new Map() // key -> { frame, self, inclusive }
	const touch = (key, frame) => {
		let entry = stats.get(key)
		if (entry === undefined) {
			entry = { frame, self: 0, inclusive: 0 }
			stats.set(key, entry)
		}
		return entry
	}

	let timed = 0
	let untimed = 0
	let gc = 0
	let idle = 0
	let other = 0
	const samples = profile.samples
	const deltas = profile.timeDeltas
	for (let i = 0; i < samples.length; i++) {
		// A sample stands for the time until the next sample.
		const weight = (deltas[i + 1] ?? deltas[i] ?? 0) / 1000
		const id = samples[i]
		const leaf = nodes.get(id).callFrame
		const stack = stackOf(id)
		if (stack.some(nodeId => UNTIMED.has(nodes.get(nodeId).callFrame.functionName))) {
			untimed += weight
			continue
		}
		if (leaf.functionName === '(garbage collector)') {
			gc += weight
			continue
		}
		if (leaf.functionName === '(idle)') {
			idle += weight
			continue
		}
		if (PSEUDO.has(leaf.functionName)) {
			other += weight
			continue
		}
		timed += weight
		const seen = new Set()
		let leafKey = null
		for (const nodeId of stack) {
			const frame = nodes.get(nodeId).callFrame
			if (PSEUDO.has(frame.functionName) || isHarness(frame))
				continue
			const key = frameKey(frame)
			leafKey = key
			if (!seen.has(key)) {
				seen.add(key)
				touch(key, frame).inclusive += weight
			}
		}
		// Self time goes to the leaf frame; a leaf inside the harness is the "run closure / loop overhead".
		if (isHarness(leaf)) {
			touch('(harness loop)', { functionName: '(harness loop)', url: '', lineNumber: -1 }).self += weight
		}
		else {
			touch(frameKey(leaf), leaf).self += weight
		}
		void leafKey
	}

	const total = timed + untimed + gc + idle + other
	const describe = (entry) => {
		const { frame } = entry
		const name = (frame.functionName || '(anonymous)').replace(/\$\d+$/, '')
		const location = frame.url ? `${shortUrl(frame.url)}:${frame.lineNumber + 1}` : ''
		let source = ''
		if (frame.url && frame.url.includes('/packages/') && frame.url.includes('/dist/') && name !== '(anonymous)') {
			const candidates = sourceIndex.get(name)
			if (candidates === undefined) {
				source = 'src: no function of this name found'
			}
			else {
				source = `src: ${candidates.slice(0, 3)
					.map(c => `${c.file}:${c.line}`)
					.join(' | ')}${candidates.length > 3 ? ` (+${candidates.length - 3} more)` : ''}`
			}
		}
		return { name, location, source }
	}
	const rows = [...stats.entries()].map(([key, entry]) => ({ key, ...entry, ...describe(entry) }))
	const pct = value => (timed === 0 ? 0 : (value / timed) * 100)
	const bySelf = rows.filter(r => r.self > 0)
		.sort((a, b) => b.self - a.self)
		.slice(0, top)
	const byInclusive = rows.filter(r => r.inclusive > 0 && r.key !== '(harness loop)')
		.sort((a, b) => b.inclusive - a.inclusive)
		.slice(0, top)
	const format = (r, field) => ({
		percent: pct(r[field]),
		selfPercent: pct(r.self),
		inclusivePercent: pct(r.inclusive),
		name: r.name,
		location: r.location,
		source: r.source,
	})
	return {
		totalMs: total,
		timedMs: timed,
		share: {
			timed: (timed / total) * 100,
			untimed: (untimed / total) * 100,
			gc: (gc / total) * 100,
			idle: (idle / total) * 100,
			other: (other / total) * 100,
		},
		sampleCount: samples.length,
		bySelf: bySelf.map(r => format(r, 'self')),
		byInclusive: byInclusive.map(r => format(r, 'inclusive')),
	}
}

export function formatProfileSummary(title, summary) {
	const lines = [`#### ${title}`, '']
	lines.push(`${summary.sampleCount} samples, ${summary.totalMs.toFixed(0)} ms profiled. Timed-run share ${summary.share.timed.toFixed(1)}%; dropped from the percentages below: un-timed set-up/clean-up ${summary.share.untimed.toFixed(1)}%, garbage collector ${summary.share.gc.toFixed(1)}% (not attributable to a function), idle ${summary.share.idle.toFixed(1)}%, other ${summary.share.other.toFixed(1)}%. Percentages are of the timed-run share.`)
	const table = (heading, rows) => {
		lines.push('', `${heading}`, '', '| self % | incl % | function | location (dist) | source (by name) |', '| --- | --- | --- | --- | --- |')
		for (const r of rows)
			lines.push(`| ${r.selfPercent.toFixed(1)} | ${r.inclusivePercent.toFixed(1)} | ${r.name} | ${r.location} | ${r.source} |`)
	}
	table('Top by self time', summary.bySelf)
	table('Top by inclusive time', summary.byInclusive)
	return lines.join('\n')
}
