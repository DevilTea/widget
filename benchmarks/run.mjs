/**
 * `pnpm bench [filter ...] [--json file] [--mode normal,jitless,alloc] [--quick] [--list]`
 *
 * Runs every selected scenario in its own child process, one after another, in each mode:
 *   normal  node --expose-gc
 *   jitless node --expose-gc --jitless            (scenarios with `jitless: true`; approximates an interpreter-only embedded engine)
 *   alloc   node --expose-gc with a huge semi-space (scenarios with `alloc: true`; bytes allocated per run, approximate)
 *
 * A filter is a scenario id or id prefix (`runtime.create`, `runtime.`); no filter runs everything.
 * Before each child starts the machine is checked for idleness; CPU used by other processes while the child
 * ran is measured and reported next to the scenario, because a busy machine produces confident wrong numbers.
 */

import { execSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { cpus, loadavg, platform } from 'node:os'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { allocTable, customTable, scalingSummary, timingTable } from './lib/report.mjs'
import { listScenarios } from './scenarios/index.mjs'

const RESULT_MARKER = '__BENCH_RESULT__'
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))

function parseArgs(argv) {
	const args = { filters: [], json: null, modes: ['normal', 'jitless', 'alloc'], quick: false, list: false, idleCheck: true, maxBusyCores: 2.5, sizes: null, variant: null }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--json')
			args.json = argv[++i]
		else if (arg === '--mode')
			args.modes = argv[++i].split(',')
		else if (arg === '--quick')
			args.quick = true
		else if (arg === '--list')
			args.list = true
		else if (arg === '--no-idle-check')
			args.idleCheck = false
		else if (arg === '--max-busy-cores')
			args.maxBusyCores = Number(argv[++i])
		else if (arg === '--sizes')
			args.sizes = argv[++i]
		else if (arg === '--variant')
			args.variant = argv[++i]
		else if (arg.startsWith('--'))
			throw new Error(`unknown option ${arg}`)
		else
			args.filters.push(arg)
	}
	return args
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

function runChild(scenario, mode, args) {
	return new Promise((resolve, reject) => {
		const childArgs = [...nodeFlags(mode), worker, '--scenario', scenario.id, '--mode', mode]
		if (args.quick)
			childArgs.push('--quick')
		if (args.sizes)
			childArgs.push('--sizes', args.sizes)
		if (args.variant)
			childArgs.push('--variant', args.variant)
		const before = cpuTimes()
		const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'inherit'] })
		let stdout = ''
		child.stdout.on('data', (chunk) => {
			stdout += chunk
		})
		child.on('error', reject)
		child.on('close', (code) => {
			const after = cpuTimes()
			if (code !== 0)
				return reject(new Error(`${scenario.id} [${mode}] exited with code ${code}`))
			const line = stdout.split('\n')
				.find(l => l.startsWith(RESULT_MARKER))
			if (line === undefined)
				return reject(new Error(`${scenario.id} [${mode}] produced no result`))
			const result = JSON.parse(line.slice(RESULT_MARKER.length))
			// CPU used by everything else while the child ran = machine busy cores - the child's own cores.
			const wallSeconds = (after.at - before.at) / 1000
			const ownCores = (result.cpuUsage.user + result.cpuUsage.system) / 1e6 / wallSeconds
			result.foreignCores = Math.max(0, busyCores(before, after) - ownCores)
			resolve(result)
		})
	})
}

function printScenario(scenario, byMode) {
	const normal = byMode.get('normal')
	const lines = [`\n## ${scenario.id}`, '', scenario.summary ?? '']
	if (scenario.inside)
		lines.push('', `Inside the timed region: ${scenario.inside}.`)
	if (scenario.outside)
		lines.push(`Outside: ${scenario.outside}.`)
	if (scenario.note)
		lines.push(`Note: ${scenario.note}`)
	console.log(lines.join('\n'))
	if (normal?.custom) {
		for (const table of normal.custom.tables ?? [normal.custom])
			console.log(`\n${customTable(table)}`)
		return
	}
	const jitless = byMode.get('jitless')
	const alloc = byMode.get('alloc')
	for (const variant of normal?.variants ?? []) {
		const jitlessVariant = jitless?.variants.find(v => v.name === variant.name)
		console.log(`\n### ${scenario.id} / ${variant.name}${variant.note ? `  (${variant.note})` : ''}\n`)
		console.log(timingTable(variant.name, variant.sizeLabel, variant, jitlessVariant))
		const summary = scalingSummary(variant)
		if (summary)
			console.log(`\nlog-log slope ${summary.firstSize} -> ${summary.lastSize}: ${summary.overall.toFixed(2)} (last step ${summary.tail.toFixed(2)})`)
		const allocVariant = alloc?.variants.find(v => v.name === variant.name)
		if (allocVariant)
			console.log(`\nAllocation (approximate, includes retained):\n\n${allocTable(allocVariant)}`)
	}
	for (const [mode, result] of byMode) {
		if (result.foreignCores !== undefined && result.foreignCores > 1.5)
			console.log(`\nWARNING: [${mode}] other processes used about ${result.foreignCores.toFixed(1)} cores while this ran; treat its numbers with suspicion.`)
	}
}

function machineInfo() {
	const info = { node: process.version, platform: `${platform()} ${process.arch}`, cpu: cpus()[0]?.model, cores: cpus().length, loadAtStart: loadavg() }
	try {
		info.git = execSync('git rev-parse --short HEAD', { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
			.trim()
	}
	catch {
		info.git = null
	}
	return info
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const all = await listScenarios()
	const selected = all.filter(s => args.filters.length === 0 || args.filters.some(f => s.id === f || s.id.startsWith(f.endsWith('.') ? f : `${f}.`) || s.id.startsWith(f)))
	if (args.list) {
		for (const s of all)
			console.log(`${s.id.padEnd(28)} ${s.alloc ? 'alloc ' : '      '}${s.jitless ? 'jitless' : '       '}  ${s.summary ?? ''}`)
		return
	}
	if (selected.length === 0)
		throw new Error(`no scenario matches ${args.filters.join(', ')} (see --list)`)

	const info = machineInfo()
	console.log(`# DevilTea Widget benchmarks\n\n${JSON.stringify(info)}\n`)
	const startedAt = Date.now()
	const collected = []
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
			result.idleBefore = idle
			result.loadAfter = loadavg()
			byMode.set(mode, result)
			collected.push(result)
		}
		printScenario(scenario, byMode)
	}
	console.log(`\nTotal wall time: ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} min`)
	if (args.json !== null) {
		writeFileSync(args.json, JSON.stringify({ info, args: { filters: args.filters, modes: args.modes, quick: args.quick }, results: collected }, null, 1))
		console.log(`Wrote ${args.json}`)
	}
}

main()
	.catch((error) => {
		console.error(error.stack ?? error)
		process.exitCode = 1
	})
