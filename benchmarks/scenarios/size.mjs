/**
 * Size and load scenarios.
 *
 * size.bytes: for every published entry point, the entry file plus the local chunks it imports (what a
 * consumer downloads before tree-shaking; external imports such as alien-signals and vue are not counted):
 * raw, minified (with the esbuild that already sits in the workspace's node_modules, never added by us),
 * gzip and brotli.
 *
 * load.cold: time to import an entry point in a fresh Node process, in-process (performance.now around the
 * dynamic import) and as whole-process wall time, medians of 21 runs after one discarded.
 */

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { root } from '../lib/load.mjs'
import { formatBytes } from '../lib/report.mjs'
import { percentile, summarize } from '../lib/stats.mjs'

const PACKAGES = ['core', 'vue', 'inspector']

function entryPoints() {
	const entries = []
	for (const name of PACKAGES) {
		const manifest = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'))
		for (const [subpath, target] of Object.entries(manifest.exports)) {
			const file = typeof target === 'string' ? target : target.import
			entries.push({
				label: `${manifest.name}${subpath === '.' ? '' : subpath.slice(1)}`,
				pkg: name,
				subpath,
				file: resolve(root, 'packages', name, file),
			})
		}
	}
	return entries
}

/** Entry file plus every local chunk it (transitively) imports. */
function closureOf(file, seen = new Set()) {
	if (seen.has(file))
		return seen
	seen.add(file)
	const code = readFileSync(file, 'utf8')
	for (const match of code.matchAll(/(?:from|import)\s*(?:\(\s*)?["'](\.{1,2}\/[^"']+)["']/g))
		closureOf(resolve(dirname(file), match[1]), seen)
	return seen
}

function findEsbuild() {
	const store = join(root, 'node_modules', '.pnpm')
	if (!existsSync(store))
		return null
	const dir = readdirSync(store)
		.find(name => name.startsWith('esbuild@'))
	if (dir === undefined)
		return null
	try {
		return createRequire(join(store, dir, 'node_modules', 'esbuild', 'package.json'))('esbuild')
	}
	catch {
		return null
	}
}

function measureSizes() {
	const esbuild = findEsbuild()
	const rows = []
	for (const entry of entryPoints()) {
		const files = [...closureOf(entry.file)]
		const raw = files.map(file => readFileSync(file, 'utf8'))
		const rawBytes = raw.reduce((sum, code) => sum + Buffer.byteLength(code), 0)
		const rawConcat = Buffer.from(raw.join('\n'))
		let minBytes = '-'
		let minGzip = '-'
		let minBrotli = '-'
		if (esbuild !== null) {
			const minified = raw.map(code => esbuild.transformSync(code, { minify: true, format: 'esm', target: 'es2022' }).code)
			const minConcat = Buffer.from(minified.join('\n'))
			minBytes = formatBytes(minConcat.length)
			minGzip = formatBytes(gzipSync(minConcat, { level: 9 }).length)
			minBrotli = formatBytes(brotliCompressSync(minConcat).length)
		}
		rows.push([
			entry.label,
			files.length,
			formatBytes(Buffer.byteLength(readFileSync(entry.file))),
			formatBytes(rawBytes),
			formatBytes(gzipSync(rawConcat, { level: 9 }).length),
			minBytes,
			minGzip,
			minBrotli,
		])
	}
	return {
		title: `Published entry points, dist closure (entry + local chunks). Minifier: ${esbuild === null ? 'none found in the workspace; minified columns omitted' : `esbuild ${esbuild.version} from the workspace's node_modules`}.`,
		columns: ['entry point', 'files', 'entry file raw', 'closure raw', 'closure gzip', 'closure min', 'min gzip', 'min brotli'],
		rows,
	}
}

function loadOnce(url, preload, jitless) {
	const preloadCode = preload.map(p => `await import(${JSON.stringify(p)});`)
		.join('')
	const code = `${preloadCode}const t0 = performance.now(); await import(${JSON.stringify(url)}); console.log(performance.now() - t0)`
	const flags = jitless ? ['--jitless'] : []
	const start = process.hrtime.bigint()
	const result = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', code], { encoding: 'utf8' })
	const wallMs = Number(process.hrtime.bigint() - start) / 1e6
	if (result.status !== 0)
		throw new Error(`load of ${url} failed: ${result.stderr}`)
	return { importMs: Number(result.stdout.trim()), wallMs }
}

function measureLoad({ quick }) {
	const runs = quick ? 5 : 21
	const require = createRequire(`${root}packages/vue/package.json`)
	const vueUrl = pathToFileURL(require.resolve('vue')).href
	const coreIndex = pathToFileURL(join(root, 'packages/core/dist/index.mjs')).href
	const targets = [
		{ label: '@deviltea/widget-core', url: coreIndex, preload: [] },
		{ label: '@deviltea/widget-core/inspection', url: pathToFileURL(join(root, 'packages/core/dist/inspection/index.mjs')).href, preload: [] },
		{ label: '@deviltea/widget-core/integration', url: pathToFileURL(join(root, 'packages/core/dist/integration/index.mjs')).href, preload: [] },
		{ label: 'vue (reference: the peer dependency alone)', url: vueUrl, preload: [] },
		{ label: '@deviltea/widget-vue (vue and core already loaded)', url: pathToFileURL(join(root, 'packages/vue/dist/index.mjs')).href, preload: [vueUrl, coreIndex] },
		{ label: '@deviltea/widget-inspector/agent (core already loaded)', url: pathToFileURL(join(root, 'packages/inspector/dist/agent.mjs')).href, preload: [coreIndex] },
		{ label: '@deviltea/widget-inspector/client', url: pathToFileURL(join(root, 'packages/inspector/dist/client.mjs')).href, preload: [] },
	]
	const baseline = []
	for (let i = 0; i < runs + 1; i++) {
		const start = process.hrtime.bigint()
		spawnSync(process.execPath, ['--input-type=module', '-e', ''], { encoding: 'utf8' })
		baseline.push(Number(process.hrtime.bigint() - start) / 1e6)
	}
	baseline.shift()
	const baselineSummary = summarize(baseline)
	const rows = []
	for (const target of targets) {
		for (const jitless of [false, true]) {
			const importMs = []
			const wallMs = []
			for (let i = 0; i < runs + 1; i++) {
				const r = loadOnce(target.url, target.preload, jitless)
				if (i === 0)
					continue
				importMs.push(r.importMs)
				wallMs.push(r.wallMs)
			}
			const a = summarize(importMs)
			const w = summarize(wallMs)
			rows.push([
				target.label,
				jitless ? 'jitless' : 'normal',
				`${a.median.toFixed(2)} ms`,
				`${percentile(importMs, 95)
					.toFixed(2)} ms`,
				`${(a.spread * 100).toFixed(1)}%${a.spread > 0.1 ? ' UNRELIABLE' : ''}`,
				`${w.median.toFixed(1)} ms`,
				`${(w.spread * 100).toFixed(1)}%`,
			])
		}
	}
	return {
		title: `Cold module load in a fresh Node process (${runs} runs each after one discarded). An empty Node process takes ${baselineSummary.median.toFixed(1)} ms wall (spread ${(baselineSummary.spread * 100).toFixed(1)}%) in this environment; process wall includes that.`,
		columns: ['entry point', 'engine', 'import median', 'import p95', 'import spread', 'process wall median', 'wall spread'],
		rows,
	}
}

export const scenarios = [
	{
		id: 'size.bytes',
		area: 'size',
		kind: 'custom',
		jitless: false,
		summary: 'Bytes of every published entry point (raw, gzip, minified).',
		async execute() {
			return { tables: [measureSizes()] }
		},
	},
	{
		id: 'load.cold',
		area: 'size',
		kind: 'custom',
		jitless: false,
		summary: 'Cold import time of the entry points in a fresh Node process, normal and --jitless.',
		async execute({ quick }) {
			return { tables: [measureLoad({ quick })] }
		},
	},
]
