/**
 * `pnpm bench [filter ...] [--json file] [--mode normal,jitless,alloc] [--quick] [--list]`
 *
 * Runs every selected scenario in its own child process, one after another, in each mode:
 *   normal  node --expose-gc
 *   jitless node --expose-gc --jitless            (scenarios with `jitless: true`; approximates an interpreter-only embedded engine)
 *   alloc   node --expose-gc with a huge semi-space (scenarios with `alloc: true`; bytes allocated per run, approximate)
 *
 * A filter selects a scenario when it equals the id, or ends with "." and the id starts with it (`runtime.`),
 * or the id starts with the filter followed by "." (`runtime.state` selects `runtime.state.set`); a filter
 * that selects nothing is an error. No filter runs everything. A child that fails does not stop the suite: the
 * failure is recorded (and reported as FAILED), the next scenario runs, and the exit code is 1 at the end.
 * With --json the file is rewritten after every scenario, so an interrupted run keeps what it measured.
 * Before each child starts the machine is checked for idleness; CPU used by other processes while the child
 * ran is measured and reported next to the scenario, because a busy machine produces confident wrong numbers.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, platform, totalmem } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { allocTable, customTable, scalingSummary, timingTable } from './lib/report.mjs'
import { listScenarios } from './scenarios/index.mjs'

const RESULT_MARKER = '__BENCH_RESULT__'
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const MODES = ['normal', 'jitless', 'alloc']
const PACKAGES = ['core', 'vue', 'inspector']

function parseArgs(argv) {
	const args = { filters: [], json: null, modes: [...MODES], quick: false, list: false, idleCheck: true, maxBusyCores: 2.5, sizes: null, variant: null }
	const value = (i, option) => {
		if (i >= argv.length || argv[i].startsWith('--'))
			throw new Error(`${option} needs a value`)
		return argv[i]
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--json') {
			args.json = value(++i, arg)
		}
		else if (arg === '--mode') {
			args.modes = value(++i, arg)
				.split(',')
		}
		else if (arg === '--quick') {
			args.quick = true
		}
		else if (arg === '--list') {
			args.list = true
		}
		else if (arg === '--no-idle-check') {
			args.idleCheck = false
		}
		else if (arg === '--max-busy-cores') {
			args.maxBusyCores = Number(value(++i, arg))
		}
		else if (arg === '--sizes') {
			args.sizes = value(++i, arg)
		}
		else if (arg === '--variant') {
			args.variant = value(++i, arg)
		}
		else if (arg.startsWith('--')) {
			throw new Error(`unknown option ${arg}`)
		}
		else {
			args.filters.push(arg)
		}
	}
	const unknownModes = args.modes.filter(mode => !MODES.includes(mode))
	if (unknownModes.length > 0)
		throw new Error(`unknown mode ${unknownModes.join(', ')} (known: ${MODES.join(', ')})`)
	args.modes = [...new Set(args.modes)]
	if (!(args.maxBusyCores > 0))
		throw new Error('--max-busy-cores must be a positive number')
	if (args.sizes !== null) {
		const sizes = args.sizes.split(',')
			.map(part => (part.trim() === '' ? Number.NaN : Number(part)))
		if (sizes.some(size => !Number.isFinite(size) || size <= 0))
			throw new Error(`--sizes must be a comma-separated list of positive numbers, got "${args.sizes}"`)
	}
	return args
}

/** A filter selects a scenario when it equals the id, ends with "." and prefixes it, or is followed by "." in it. */
function filterMatches(filter, id) {
	return id === filter || (filter.endsWith('.') && id.startsWith(filter)) || id.startsWith(`${filter}.`)
}

function cpuTimes() {
	let busy = 0
	let total = 0
	for (const cpu of cpus()) {
		const { user, nice, sys, idle, irq } = cpu.times
		busy += user + nice + sys + irq
		total += user + nice + sys + irq + idle
	}
	return { busy, total, at: Date.now() }
}

/** Busy cores (of all cores) between two snapshots. */
function busyCores(a, b) {
	const dt = b.total - a.total
	return dt <= 0 ? 0 : ((b.busy - a.busy) / dt) * cpus().length
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForIdle(args) {
	if (!args.idleCheck)
		return { waitedMs: 0, busyCores: Number.NaN, timedOut: false }
	const startedAt = Date.now()
	for (;;) {
		const a = cpuTimes()
		await sleep(1000)
		const busy = busyCores(a, cpuTimes())
		if (busy <= args.maxBusyCores)
			return { waitedMs: Date.now() - startedAt, busyCores: busy, timedOut: false }
		if (Date.now() - startedAt > 120000)
			return { waitedMs: Date.now() - startedAt, busyCores: busy, timedOut: true }
		process.stderr.write(`  machine busy (${busy.toFixed(1)} cores in use), waiting...\n`)
		await sleep(4000)
	}
}

function nodeFlags(mode) {
	if (mode === 'jitless')
		return ['--expose-gc', '--jitless']
	if (mode === 'alloc')
		return ['--expose-gc', '--min-semi-space-size=512', '--max-semi-space-size=512']
	return ['--expose-gc']
}

/** Runs one scenario in one mode. Never rejects: a failure resolves to { id, mode, failed, code, signal }. */
function runChild(scenario, mode, args) {
	return new Promise((resolve) => {
		let errorLine = ''
		let stderrTail = ''
		const failure = (message, code = null, signal = null) => resolve({ id: scenario.id, mode, failed: errorLine ? `${message}: ${errorLine}` : message, code, signal })
		const childArgs = [...nodeFlags(mode), worker, '--scenario', scenario.id, '--mode', mode]
		if (args.quick)
			childArgs.push('--quick')
		if (args.sizes)
			childArgs.push('--sizes', args.sizes)
		if (args.variant)
			childArgs.push('--variant', args.variant)
		const before = cpuTimes()
		const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' } })
		let stdout = ''
		child.stdout.on('data', (chunk) => {
			stdout += chunk
		})
		// stderr is passed through live; the last error line is kept for the failure record.
		child.stderr.on('data', (chunk) => {
			process.stderr.write(chunk)
			stderrTail = (stderrTail + chunk).slice(-4000)
			errorLine = stderrTail.split('\n')
				.findLast(line => /^\w*Error\b/.test(line)) ?? errorLine
		})
		child.on('error', error => failure(`could not start: ${error.message}`))
		child.on('close', (code, signal) => {
			const after = cpuTimes()
			if (code !== 0)
				return failure(signal ? `killed by signal ${signal}` : `exited with code ${code}`, code, signal)
			const line = stdout.split('\n')
				.find(l => l.startsWith(RESULT_MARKER))
			if (line === undefined)
				return failure('produced no result', code, signal)
			let result
			try {
				result = JSON.parse(line.slice(RESULT_MARKER.length))
			}
			catch (error) {
				return failure(`unreadable result: ${error.message}`, code, signal)
			}
			// CPU used by everything else while the child ran = machine busy cores - the child's own cores.
			const wallSeconds = (after.at - before.at) / 1000
			const ownCores = (result.cpuUsage.user + result.cpuUsage.system) / 1e6 / wallSeconds
			result.foreignCores = Math.max(0, busyCores(before, after) - ownCores)
			resolve(result)
		})
	})
}

function failureLine(result) {
	return `FAILED [${result.mode}] ${result.id}: ${result.failed}`
}

function printScenario(scenario, byMode) {
	const lines = [`\n## ${scenario.id}`, '', scenario.summary ?? '']
	if (scenario.inside)
		lines.push('', `Inside the timed region: ${scenario.inside}.`)
	if (scenario.outside)
		lines.push(`Outside: ${scenario.outside}.`)
	if (scenario.note)
		lines.push(`Note: ${scenario.note}`)
	console.log(lines.join('\n'))
	if (byMode.size === 0)
		console.log('\nNo requested mode applies to this scenario (see --list for its modes).')
	for (const result of byMode.values()) {
		if (result.failed !== undefined)
			console.log(`\n${failureLine(result)}`)
	}
	const ok = mode => (byMode.get(mode)?.failed === undefined ? byMode.get(mode) : undefined)
	const normal = ok('normal')
	const jitless = ok('jitless')
	const alloc = ok('alloc')
	const customModes = [...byMode.values()].filter(result => result.failed === undefined && result.custom)
	for (const result of customModes) {
		for (const table of result.custom.tables ?? [result.custom])
			console.log(`\n${customModes.length > 1 ? `[${result.mode}] ` : ''}${customTable(table)}`)
	}
	// The primary table is the normal run, or the jitless one when only that ran; jitless sits beside normal.
	const primary = normal ?? jitless
	const names = [...new Set([primary, alloc].flatMap(result => result?.variants?.map(v => v.name) ?? []))]
	for (const name of names) {
		const variant = primary?.variants.find(v => v.name === name)
		const allocVariant = alloc?.variants.find(v => v.name === name)
		const meta = variant ?? allocVariant
		console.log(`\n### ${scenario.id} / ${name}${meta.note ? `  (${meta.note})` : ''}\n`)
		if (variant) {
			const side = normal ? jitless?.variants.find(v => v.name === name) : undefined
			console.log(`${normal ? '' : '[jitless] '}${timingTable(name, variant.sizeLabel, variant, side)}`)
			const summary = scalingSummary(variant)
			if (summary)
				console.log(`\nlog-log slope ${summary.firstSize} -> ${summary.lastSize}: ${summary.overall.toFixed(2)} (last step ${summary.tail.toFixed(2)})`)
		}
		if (allocVariant)
			console.log(`\nAllocation (approximate, includes retained):\n\n${allocTable(allocVariant)}`)
	}
	for (const [mode, result] of byMode) {
		if (result.foreignCores !== undefined && result.foreignCores > 1.5)
			console.log(`\nWARNING: [${mode}] other processes used about ${result.foreignCores.toFixed(1)} cores while this ran; treat its numbers with suspicion.`)
	}
}

function git(...gitArgs) {
	return execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' })
}

function listFiles(dir, keep, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== 'node_modules')
				listFiles(path, keep, out)
		}
		else if (keep(entry.name)) {
			out.push(path)
		}
	}
	return out
}

/** First 12 hex digits of a SHA-256 over the sorted list of .mjs files under a dist directory and their contents. */
function distFingerprint(pkg) {
	const dir = join(repoRoot, 'packages', pkg, 'dist')
	if (!existsSync(dir))
		return null
	const hash = createHash('sha256')
	for (const file of listFiles(dir, name => name.endsWith('.mjs'))
		.sort()) {
		hash.update(file.slice(dir.length))
		hash.update('\0')
		hash.update(readFileSync(file))
		hash.update('\0')
	}
	return hash.digest('hex')
		.slice(0, 12)
}

const isTestFile = name => name.includes('.test.') || name === 'test-fixture.ts' || name === 'test-fixtures.ts'
const newestMtime = files => files.reduce((newest, file) => Math.max(newest, statSync(file).mtimeMs), 0)

/** Packages where a non-test src file is newer than the newest dist file: the dist does not reflect src. */
function staleDistPackages() {
	const stale = []
	for (const pkg of PACKAGES) {
		const dist = join(repoRoot, 'packages', pkg, 'dist')
		const src = join(repoRoot, 'packages', pkg, 'src')
		if (!existsSync(dist) || !existsSync(src))
			continue
		if (newestMtime(listFiles(src, name => !isTestFile(name))) > newestMtime(listFiles(dist, () => true)))
			stale.push(pkg)
	}
	return stale
}

function runInfo() {
	const info = {
		machine: { cpu: cpus()[0]?.model, cores: cpus().length, totalMemoryBytes: totalmem(), node: process.version, platform: `${platform()} ${process.arch}`, loadAtStart: loadavg() },
		git: null,
		dirty: null,
		dist: Object.fromEntries(PACKAGES.map(pkg => [pkg, distFingerprint(pkg)])),
		staleDist: staleDistPackages(),
	}
	try {
		info.git = git('rev-parse', '--short', 'HEAD')
			.trim()
		info.dirty = git('status', '--porcelain')
			.trim() !== ''
	}
	catch {
		// not a git checkout: leave null
	}
	return info
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const all = await listScenarios()
	if (args.list) {
		for (const s of all)
			console.log(`${s.id.padEnd(28)} ${s.alloc ? 'alloc ' : '      '}${s.jitless ? 'jitless' : '       '}  ${s.summary ?? ''}`)
		return
	}
	const unmatched = args.filters.filter(filter => !all.some(s => filterMatches(filter, s.id)))
	if (unmatched.length > 0)
		throw new Error(`no scenario matches ${unmatched.join(', ')} (see --list; a filter is an id, an id prefix ending in ".", or a leading part of an id up to a ".")`)
	const selected = all.filter(s => args.filters.length === 0 || args.filters.some(f => filterMatches(f, s.id)))

	const info = runInfo()
	info.startedAt = new Date()
		.toISOString()
	if (info.staleDist.length > 0) {
		const bar = '!'.repeat(78)
		process.stderr.write(`\n${bar}\nWARNING: src is newer than dist in: ${info.staleDist.join(', ')}.\nThis run measures the OLD built code. Rebuild first: pnpm --filter "./packages/*" build\n${bar}\n\n`)
	}
	console.log(`# DevilTea Widget benchmarks\n\n${JSON.stringify(info)}\n`)
	const startedAt = Date.now()
	const collected = []
	const failures = []
	const given = { filters: args.filters, modes: args.modes, quick: args.quick, sizes: args.sizes, variant: args.variant, idleCheck: args.idleCheck, maxBusyCores: args.maxBusyCores }
	const writeJson = (complete) => {
		if (args.json === null)
			return
		info.finishedAt = new Date()
			.toISOString()
		info.complete = complete
		try {
			writeFileSync(args.json, JSON.stringify({ info, args: given, results: collected }, null, 1))
		}
		catch (error) {
			process.stderr.write(`could not write ${args.json}: ${error.message}\n`)
		}
	}
	for (const scenario of selected) {
		const byMode = new Map()
		const modes = args.modes.filter(mode => mode === 'normal' || (mode === 'jitless' && scenario.jitless) || (mode === 'alloc' && scenario.alloc))
		for (const mode of modes) {
			const idle = await waitForIdle(args)
			process.stderr.write(`[${new Date()
				.toISOString()
				.slice(11, 19)}] ${scenario.id} (${mode}); load ${loadavg()
				.map(n => n.toFixed(2))
				.join(' ')}; idle-check busy cores ${Number.isFinite(idle.busyCores) ? idle.busyCores.toFixed(2) : 'n/a'}${idle.timedOut ? ' (TIMED OUT waiting)' : ''}\n`)
			const result = await runChild(scenario, mode, args)
			if (result.failed !== undefined) {
				failures.push(result)
				process.stderr.write(`${failureLine(result)}\n`)
			}
			else {
				result.idleBefore = idle
				result.loadAfter = loadavg()
			}
			byMode.set(mode, result)
			collected.push(result)
		}
		printScenario(scenario, byMode)
		writeJson(false)
	}
	console.log(`\nTotal wall time: ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min`)
	writeJson(true)
	if (args.json !== null)
		console.log(`Wrote ${args.json}`)
	if (failures.length > 0) {
		console.log(`\n${failures.length} FAILED run(s): ${failures.map(f => `${f.id} [${f.mode}] (${f.failed})`)
			.join('; ')}`)
		process.exitCode = 1
	}
}

main()
	.catch((error) => {
		console.error(error.stack ?? error)
		process.exitCode = 1
	})
