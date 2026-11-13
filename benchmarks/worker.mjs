/**
 * Runs ONE scenario in this process and prints one JSON result line. Spawned by run.mjs with the right
 * node flags (`--expose-gc`, optionally `--jitless`, or the large semi-space flags for allocation mode);
 * it can also be run by hand:
 *
 *   node --expose-gc benchmarks/worker.mjs --scenario runtime.create [--variant standard] [--sizes 100,1000]
 *        [--mode normal|jitless|alloc] [--quick]
 *
 * One process per scenario keeps one scenario's JIT feedback and heap from leaking into the next.
 */

import { writeFileSync } from 'node:fs'
import inspector from 'node:inspector'
import { cpus } from 'node:os'
import process from 'node:process'
import { enableProfileMode, measureAllocation, measureCase } from './lib/harness.mjs'
import { findScenario } from './scenarios/index.mjs'

const RESULT_MARKER = '__BENCH_RESULT__'

function parseArgs(argv) {
	const args = { mode: 'normal', quick: false, sizes: null, variant: null, scenario: null, profileDir: null }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--scenario') {
			args.scenario = argv[++i]
		}
		else if (arg === '--variant') {
			args.variant = argv[++i]
		}
		else if (arg === '--sizes') {
			args.sizes = argv[++i].split(',')
				.map(Number)
		}
		else if (arg === '--mode') {
			args.mode = argv[++i]
		}
		else if (arg === '--profile-dir') {
			args.profileDir = argv[++i]
		}
		else if (arg === '--quick') {
			args.quick = true
		}
		else {
			throw new Error(`unknown argument ${arg}`)
		}
	}
	if (args.scenario === null)
		throw new Error('--scenario is required')
	return args
}

function log(message) {
	process.stderr.write(`${message}\n`)
}

/**
 * Runs `measure` under the V8 CPU profiler (the same sampler as `node --cpu-prof`, started through the
 * inspector so that only the measurement is profiled, not the fixture set-up) and writes a .cpuprofile.
 */
async function profiled(args, scenario, variant, size, measure) {
	enableProfileMode()
	const session = new inspector.Session()
	session.connect()
	const post = (method, params) => new Promise((resolveCall, reject) => {
		session.post(method, params, (error, result) => (error ? reject(error) : resolveCall(result)))
	})
	await post('Profiler.enable')
	await post('Profiler.setSamplingInterval', { interval: 200 })
	await post('Profiler.start')
	let result
	try {
		result = await measure()
	}
	finally {
		const { profile } = await post('Profiler.stop')
		session.disconnect()
		const file = `${args.profileDir}/${scenario.id}.${variant.name}.${size}.${args.mode}.cpuprofile`
		writeFileSync(file, JSON.stringify(profile))
		log(`  profile written to ${file}`)
		result = { ...(result ?? {}), profileFile: file }
	}
	return result
}

async function runVariant(scenario, variant, args) {
	const sizes = args.sizes ?? variant.sizes
	const rows = []
	let previous = null
	for (const size of sizes) {
		if (previous !== null && previous.size > 0) {
			const maxRunMs = variant.maxRunMs ?? scenario.maxRunMs ?? 3000
			const predicted = (previous.median / 1e6) * (size / previous.size) * 1.3
			if (predicted > maxRunMs) {
				rows.push({ size, skipped: `predicted ${predicted.toFixed(0)} ms per run exceeds the ${maxRunMs} ms limit` })
				continue
			}
		}
		const c = await variant.setup(size, { mode: args.mode })
		let row
		if (args.mode === 'alloc') {
			row = { size, ...(await measureAllocation(c)), ops: c.ops ?? 1 }
		}
		else {
			const result = args.profileDir === null ? await measureCase(c, { quick: args.quick }) : await profiled(args, scenario, variant, size, () => measureCase(c, { quick: args.quick }))
			row = { size, ops: c.ops ?? 1, ...result }
		}
		rows.push(row)
		previous = args.mode === 'alloc' ? null : { size, median: row.median }
		if (args.mode === 'alloc')
			log(`  ${variant.name} @${size}: ${Number.isNaN(row.bytes) ? 'n/a' : `${Math.round(row.bytes)} B/run`}`)
		else
			log(`  ${variant.name} @${size}: ${(row.median / 1e3).toFixed(1)} us  spread ${(row.spread * 100).toFixed(1)}%  n=${row.n} batch=${row.batch}${row.unreliable ? '  UNRELIABLE' : ''}`)
	}
	return { name: variant.name, sizeLabel: variant.sizeLabel ?? 'widgets', perWidget: variant.perWidget ?? scenario.perWidget ?? false, note: variant.note ?? null, rows }
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const scenario = await findScenario(args.scenario)
	if (scenario === undefined)
		throw new Error(`no scenario named ${args.scenario}`)
	if (args.mode === 'alloc' && !scenario.alloc)
		throw new Error(`scenario ${scenario.id} has no allocation mode`)
	log(`${scenario.id} [${args.mode}]`)
	const startedAt = process.hrtime.bigint()
	const result = { id: scenario.id, mode: args.mode, node: process.version, variants: [], cpuCount: cpus().length }
	if (scenario.kind === 'custom') {
		result.custom = await scenario.execute({ mode: args.mode, quick: args.quick, log })
	}
	else {
		for (const variant of scenario.variants) {
			if (args.variant !== null && variant.name !== args.variant)
				continue
			result.variants.push(await runVariant(scenario, variant, args))
		}
	}
	result.wallMs = Number(process.hrtime.bigint() - startedAt) / 1e6
	result.cpuUsage = process.cpuUsage()
	process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`)
}

main()
	.catch((error) => {
		process.stderr.write(`${error?.stack ?? error}\n`)
		process.exitCode = 1
	})
