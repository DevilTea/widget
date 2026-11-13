/**
 * Mechanical summary of a V8 `.cpuprofile` (the JSON written by `node --cpu-prof` or by the inspector's
 * Profiler domain): top functions by self time and by inclusive time, as percentages, with file and line.
 *
 * Samples are classified first, by TIME. A profile written by worker.mjs has a `.windows.json` sidecar: the start and
 * end instant of every clocked batch (`performance.now()`) and two sets of clock markers (busy-waits in the functions
 * benchClockMarker / benchClockGap, one right after the profiler started and one right before it stopped). The
 * marker samples fix the offset between that clock and the profile's (`profile.startTime` plus the cumulative
 * `timeDeltas`, V8's monotonic clock), and a sample counts as timed when it falls inside a window. Everything
 * else is "un-timed (set-up, clean-up, harness)", and garbage-collector samples are split into those inside and
 * outside the windows (a collector pause cannot be attributed to a JavaScript function by this sampler; forced
 * collections are off in profile mode, so what lies inside the windows is the collection work the measured code's
 * own garbage triggers). The idle, program and garbage-collector pseudo frames inside the windows are reported on
 * their own line. The case's warm pass (`warmPass`) only runs after a forced collection, which profile mode never does.
 *
 * Without a sidecar (a profile from an older harness, or one made by `node --cpu-prof`) the fallback drops the samples
 * whose stack contains one of the un-timed wrapper functions of that harness (benchUntimedFresh / benchUntimedAfter).
 * V8 can inline those wrappers, so for an expensive `fresh()` the fallback counts some set-up as timed; the output
 * says which method was used.
 *
 * Only frames whose URL is inside `benchmarks/` are the harness (the measurement loop, the worker, the
 * scenarios' own closures): they are never listed, and self time in them is the "(harness loop)" line. Builtin
 * and native frames (an empty URL or `node:`: `Map.prototype.set`, `JSON.parse`, ...) keep their own function
 * name, marked `(builtin)`. In the inclusive table, builtin frames above the first harness frame of a stack (the
 * event loop and module-loader scaffolding that every sample sits under) are left out.
 *
 * `dist` frames are mapped back to `src` of the SAME package by function NAME only (the built code is not
 * minified, so names survive); when several source functions share a name, up to 8 candidates are shown, and
 * an anonymous function is shown by its dist location only. Nothing is guessed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { harnessRoot, root } from './load.mjs'

const UNTIMED = new Set(['benchUntimedFresh', 'benchUntimedAfter'])
const CLOCK_MARKER = 'benchClockMarker'
const CLOCK_GAP = 'benchClockGap'
const PSEUDO = new Set(['(root)', '(program)', '(idle)', '(garbage collector)'])
const HARNESS_URL = `${pathToFileURL(join(harnessRoot, 'benchmarks')).href}/`
const MAX_CANDIDATES = 8
const PACKAGES = ['core', 'vue', 'inspector']
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'try', 'with', 'constructor'])

function walkSources(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name)
		if (statSync(path)
			.isDirectory()) {
			if (name !== 'node_modules' && name !== 'dist')
				walkSources(path, out)
		}
		else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') && name !== 'test-fixture.ts' && name !== 'test-fixtures.ts') {
			out.push(path)
		}
	}
	return out
}

// Declarations the index recognizes, one per line (best effort; the index is a list of candidates, not a parser).
const TYPE_TAIL = /=>\s*(?:void|unknown|never|any|string|number|boolean|undefined|null|[A-Z]\w*(?:<[^>]*>)?)\s*(?:[;,]\s*)?$/
const TYPE_UNION_TAIL = /=>[^{]*(?:\|\s*(?:null|undefined)|\[\])\s*(?:[;,]\s*)?$/
const DECLARATIONS = [
	// function name(, export async function* name(
	{ pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)/ },
	// const name = (...) =>, const name = async x =>, const name = function, const name: T = <T>(...) =>
	{ pattern: /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|<[^>]*>\s*\(|\(|\w+\s*=>)/ },
	// name(...) {  and  async name(...) {  and  static get name() {  (class and object-literal members)
	{ pattern: /^\s*(?:(?:public|private|protected|static|readonly|async)\s+)*(?:get\s+|set\s+)?\*?(\w+)\s*(?:<[^>]*>\s*)?\([^)]*\)\s*(?::[^={]+)?\{\s*$/ },
	// createRuntime: options => ..., name: async (...) =>, name: function (, and class fields  name = (...) =>
	{ pattern: /^\s*(?:(?:public|private|protected|static|readonly)\s+)*(\w+)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|\w+\s*=>)/, rejectIf: text => TYPE_TAIL.test(text) || TYPE_UNION_TAIL.test(text), notInTypeDeclaration: true },
]

/** True when an enclosing (less indented) line opens an interface or type alias: a signature, not an implementation. */
function inTypeDeclaration(lines, index) {
	let indent = lines[index].search(/\S/)
	for (let i = index - 1; i >= 0 && indent > 0; i--) {
		const here = lines[i].search(/\S/)
		if (here < 0 || here >= indent)
			continue
		indent = here
		if (/^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+\w+/.test(lines[i]))
			return true
	}
	return false
}

/** package -> function name -> [{ file, line }] over packages/<package>/src (non-test files). */
export function buildSourceIndex() {
	const index = new Map(PACKAGES.map(pkg => [pkg, new Map()]))
	for (const pkg of PACKAGES) {
		const byName = index.get(pkg)
		for (const file of walkSources(join(root, 'packages', pkg, 'src'))) {
			const lines = readFileSync(file, 'utf8')
				.split('\n')
			lines.forEach((text, i) => {
				for (const { pattern, rejectIf, notInTypeDeclaration } of DECLARATIONS) {
					const m = text.match(pattern)
					if (!m || KEYWORDS.has(m[1]) || (rejectIf && rejectIf(text)) || (notInTypeDeclaration && inTypeDeclaration(lines, i)))
						continue
					const list = byName.get(m[1]) ?? []
					const entry = { file: relative(root, file), line: i + 1 }
					if (!list.some(e => e.file === entry.file && e.line === entry.line))
						list.push(entry)
					byName.set(m[1], list)
					return
				}
			})
		}
	}
	return index
}

function shortUrl(url) {
	if (!url)
		return ''
	let path = url.startsWith('file://') ? decodeURIComponent(url.slice(7)) : url
	for (const base of [root, harnessRoot]) {
		if (path.startsWith(base)) {
			path = path.slice(base.length)
			break
		}
	}
	const store = path.indexOf('node_modules/.pnpm/')
	if (store >= 0)
		path = `node_modules/${path.slice(path.indexOf('/node_modules/', store) + '/node_modules/'.length)}`
	return path
}

function isHarness(frame) {
	const url = frame.url ?? ''
	// node:inspector is the profiler's own start/stop call.
	return url.startsWith(HARNESS_URL) || url === 'node:inspector'
}

/** Builtin or native code: V8 builtins and natives have no URL, node's own modules have a `node:` one. */
function isBuiltin(frame) {
	const url = frame.url ?? ''
	return url === '' || url.startsWith('node:')
}

/** The package a dist frame belongs to, or null. */
function distPackage(url) {
	return url.match(/\/packages\/([^/]+)\/dist\//)?.[1] ?? null
}

/** Where the window sidecar of `<name>.cpuprofile` lives: `<name>.windows.json`. */
export function windowsFileFor(profileFile) {
	return profileFile.replace(/\.cpuprofile$/, '.windows.json')
}

/** The parsed sidecar of a profile file, or null when there is none (or it is unreadable). */
export function loadWindows(profileFile) {
	try {
		return JSON.parse(readFileSync(windowsFileFor(profileFile), 'utf8'))
	}
	catch {
		return null
	}
}

/**
 * Fits the offset between the harness's clock (`performance.now()`, ms) and the profile's (ms), from the samples
 * taken inside the clock-marker functions.
 *
 * The marker samples form clusters, one per marker busy-wait, separated by samples in the gap function. A cluster
 * of samples [first, last] taken during a marker window [a, b] says offset <= first - a and offset >= last - b.
 * The cluster-to-window assignment is not assumed (a marker can get no sample at all): the candidate offsets
 * first_i - a_j are tried, and the one under which most clusters lie inside some window wins. The offset is then
 * the midpoint of the interval that all matched clusters allow; its half width is the uncertainty reported
 * (a negative width means the matched clusters contradict each other by that much: sampling jitter).
 * Returns { offsetMs, uncertaintyUs, matched, clusters, windows } or { failed: reason }.
 */
export function fitClock(times, markerKind, markers) {
	const windows = [...(markers?.head ?? []), ...(markers?.tail ?? [])]
		.sort((p, q) => p[0] - q[0])
	if (windows.length === 0)
		return { failed: 'the sidecar has no clock markers' }
	const clusters = []
	let current = null
	for (let i = 0; i < times.length; i++) {
		const kind = markerKind(i)
		if (kind === 'marker') {
			// More than a millisecond between two marker samples cannot be one busy-wait.
			if (current !== null && times[i] - current.at(-1) > 1)
				current = null
			if (current === null) {
				current = []
				clusters.push(current)
			}
			current.push(times[i])
		}
		else if (kind === 'gap') {
			current = null
		}
	}
	if (clusters.length === 0)
		return { failed: 'no sample was taken inside the clock markers' }
	const windowOf = (cluster, offset) => windows.find(w => cluster[0] - offset >= w[0] && cluster.at(-1) - offset <= w[1])
	let best = null
	for (const cluster of clusters) {
		for (const window of windows) {
			const offset = cluster[0] - window[0]
			const matched = []
			for (const other of clusters) {
				const w = windowOf(other, offset)
				if (w !== undefined)
					matched.push([other, w])
			}
			if (best === null || matched.length > best.matched.length)
				best = { matched }
		}
	}
	if (best.matched.length < Math.max(4, Math.min(clusters.length, windows.length) / 2))
		return { failed: `only ${best.matched.length} of ${clusters.length} marker clusters fit one clock offset` }
	let low = -Infinity
	let high = Infinity
	for (const [cluster, [a, b]] of best.matched) {
		low = Math.max(low, cluster.at(-1) - b)
		high = Math.min(high, cluster[0] - a)
	}
	return { offsetMs: (low + high) / 2, uncertaintyUs: ((high - low) / 2) * 1000, matched: best.matched.length, clusters: clusters.length, windows: windows.length }
}

/** Index of the window containing `t` (windows sorted, non-overlapping), or -1. */
function windowIndex(windows, t) {
	let low = 0
	let high = windows.length - 1
	while (low <= high) {
		const mid = (low + high) >> 1
		if (t < windows[mid][0])
			high = mid - 1
		else if (t > windows[mid][1])
			low = mid + 1
		else
			return mid
	}
	return -1
}

/**
 * Summarizes a profile. `windows` is the parsed `.windows.json` sidecar (see loadWindows); without it, or when
 * its clock cannot be fitted, the samples of the wrapper functions of the older harness are dropped instead.
 */
export function summarizeProfile(profile, { top = 15, sourceIndex = buildSourceIndex(), windows = null } = {}) {
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
	let gcOutside = 0
	let idle = 0
	let other = 0
	const samples = profile.samples
	const deltas = profile.timeDeltas
	// Sample timestamps in milliseconds: profile.startTime plus the cumulative deltas (microseconds).
	const times = new Float64Array(samples.length)
	let clock = profile.startTime
	for (let i = 0; i < samples.length; i++) {
		clock += deltas[i]
		times[i] = clock / 1000
	}
	const markerKindOfNode = new Map()
	const markerKind = (i) => {
		const id = samples[i]
		let kind = markerKindOfNode.get(id)
		if (kind === undefined) {
			const names = stackOf(id)
				.map(nodeId => nodes.get(nodeId).callFrame.functionName)
			kind = names.includes(CLOCK_MARKER) ? 'marker' : names.includes(CLOCK_GAP) ? 'gap' : ''
			markerKindOfNode.set(id, kind)
		}
		return kind
	}
	const fit = windows === null ? null : fitClock(times, markerKind, windows.markers)
	const byWindows = fit !== null && fit.failed === undefined
	const method = byWindows
		? { name: 'windows', windows: windows.windows.length, windowMs: windows.windows.reduce((sum, [a, b]) => sum + (b - a), 0), offsetMs: fit.offsetMs, uncertaintyUs: fit.uncertaintyUs, matched: fit.matched, clusters: fit.clusters, markerWindows: fit.windows }
		: { name: 'names', reason: windows === null ? 'no .windows.json next to the profile' : `the clock fit failed (${fit.failed}); profiles of this harness have no wrapper frames, so set-up is NOT dropped` }
	const sorted = byWindows ? windows.windows : null
	for (let i = 0; i < samples.length; i++) {
		// A sample stands for the time until the next sample.
		const weight = (deltas[i + 1] ?? deltas[i] ?? 0) / 1000
		const id = samples[i]
		const leaf = nodes.get(id).callFrame
		const stack = stackOf(id)
		if (byWindows) {
			if (windowIndex(sorted, times[i] - fit.offsetMs) < 0) {
				if (leaf.functionName === '(garbage collector)')
					gcOutside += weight
				else
					untimed += weight
				continue
			}
		}
		else if (stack.some(nodeId => UNTIMED.has(nodes.get(nodeId).callFrame.functionName))) {
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
		// Builtin frames above the first harness frame are scaffolding (event loop, module loader), not work.
		const firstHarness = stack.findIndex(nodeId => isHarness(nodes.get(nodeId).callFrame))
		for (const [position, nodeId] of stack.entries()) {
			const frame = nodes.get(nodeId).callFrame
			if (PSEUDO.has(frame.functionName) || isHarness(frame) || (isBuiltin(frame) && firstHarness >= 0 && position < firstHarness))
				continue
			const key = frameKey(frame)
			if (!seen.has(key)) {
				seen.add(key)
				touch(key, frame).inclusive += weight
			}
		}
		// Self time goes to the leaf frame; a leaf inside the harness is the "run closure / loop overhead".
		if (isHarness(leaf)) {
			touch('(harness loop)', { functionName: '(harness loop)', url: '', lineNumber: -1, harness: true }).self += weight
		}
		else {
			touch(frameKey(leaf), leaf).self += weight
		}
	}

	const total = timed + untimed + gc + gcOutside + idle + other
	const kept = total - untimed - gcOutside
	const describe = (entry) => {
		const { frame } = entry
		const bare = (frame.functionName || '(anonymous)').replace(/\$\d+$/, '')
		if (frame.harness)
			return { name: bare, location: '', source: 'self time in benchmarks/ code, builtins that V8 attributes to it included (e.g. JSON.parse called by a scenario closure)' }
		if (isBuiltin(frame))
			return { name: `${bare} (builtin)`, location: frame.url ? `${frame.url}:${frame.lineNumber + 1}` : '', source: '' }
		const location = frame.url ? `${shortUrl(frame.url)}:${frame.lineNumber + 1}` : ''
		let source = ''
		const pkg = distPackage(frame.url ?? '')
		if (pkg !== null && bare !== '(anonymous)') {
			const candidates = sourceIndex.get(pkg)
				?.get(bare)
			if (candidates === undefined) {
				source = `src: no function of this name found in packages/${pkg}/src`
			}
			else {
				source = `src: ${candidates.slice(0, MAX_CANDIDATES)
					.map(c => `${c.file}:${c.line}`)
					.join(', ')}${candidates.length > MAX_CANDIDATES ? ` (+${candidates.length - MAX_CANDIDATES} more)` : ''}`
			}
		}
		return { name: bare, location, source }
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
			gcOutside: (gcOutside / total) * 100,
			idle: (idle / total) * 100,
			other: (other / total) * 100,
		},
		method,
		gcMs: gc,
		gcOutsideMs: gcOutside,
		keptMs: kept,
		gcOfKeptPercent: kept > 0 ? (gc / kept) * 100 : 0,
		sampleCount: samples.length,
		bySelf: bySelf.map(r => format(r, 'self')),
		byInclusive: byInclusive.map(r => format(r, 'inclusive')),
	}
}

export function formatProfileSummary(title, summary) {
	const lines = [`#### ${title}`, '']
	const { method, share } = summary
	if (method.name === 'windows') {
		const uncertainty = Math.round(Math.abs(method.uncertaintyUs))
		lines.push(`${summary.sampleCount} samples, ${summary.totalMs.toFixed(0)} ms profiled. Method: time windows (${method.windows} clocked batches, ${method.windowMs.toFixed(0)} ms; profile clock fitted on ${method.matched} of ${method.clusters} marker clusters; the markers bound the offset to ${method.uncertaintyUs < 0 ? 'a contradiction of ' : '+/- '}${uncertainty} us). Timed-run share ${share.timed.toFixed(1)}%; un-timed (set-up, clean-up, harness: every sample outside a window) ${share.untimed.toFixed(1)}%, garbage collector outside the windows ${share.gcOutside.toFixed(1)}%; dropped from the percentages below: garbage collector inside the windows ${share.gc.toFixed(1)}% (not attributable to a function), idle ${share.idle.toFixed(1)}%, other ${share.other.toFixed(1)}%. Percentages are of the timed-run share.`)
		lines.push('', `Garbage collector inside the timed windows: ${summary.gcMs.toFixed(1)} ms, ${summary.gcOfKeptPercent.toFixed(1)}% of the ${summary.keptMs.toFixed(0)} ms inside the windows (the collection work the measured code's own garbage triggers; forced collections are off in profile mode). Outside the windows: ${summary.gcOutsideMs.toFixed(1)} ms.`)
	}
	else {
		lines.push(`${summary.sampleCount} samples, ${summary.totalMs.toFixed(0)} ms profiled. Method: wrapper function names (${method.reason}); V8 can inline the wrappers of an expensive set-up, which then counts as timed. Timed-run share ${share.timed.toFixed(1)}%; dropped from the percentages below: un-timed set-up/clean-up ${share.untimed.toFixed(1)}%, garbage collector ${share.gc.toFixed(1)}% (not attributable to a function), idle ${share.idle.toFixed(1)}%, other ${share.other.toFixed(1)}%. Percentages are of the timed-run share.`)
		lines.push('', `Garbage collector: ${summary.gcMs.toFixed(1)} ms, ${summary.gcOfKeptPercent.toFixed(1)}% of the ${summary.keptMs.toFixed(0)} ms of kept samples (every sample except the un-timed set-up/clean-up ones). Forced collections are off in profile mode: this is only the collection work the measured code's own garbage triggers.`)
	}
	const table = (heading, rows) => {
		lines.push('', `${heading}`, '', '| self % | incl % | function | location (dist) | source (by name) |', '| --- | --- | --- | --- | --- |')
		for (const r of rows)
			lines.push(`| ${r.selfPercent.toFixed(1)} | ${r.inclusivePercent.toFixed(1)} | ${r.name} | ${r.location} | ${r.source} |`)
	}
	table('Top by self time', summary.bySelf)
	table('Top by inclusive time', summary.byInclusive)
	return lines.join('\n')
}
