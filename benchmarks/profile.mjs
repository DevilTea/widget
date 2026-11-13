/**
 * `node benchmarks/profile.mjs <scenario> --variant <name> --size <n> [--mode normal|jitless] [--top 15] [--out dir]`
 * `node benchmarks/profile.mjs --summarize <file.cpuprofile> [--top 15]`
 *
 * Runs one scenario variant at one size under the V8 CPU profiler (in a child process, so the fixture
 * set-up is not profiled) and prints the top functions by self and by inclusive time, mapped back to
 * `packages/*\/src` by function name. The raw `.cpuprofile` is kept in --out (default: the OS temp dir) and
 * opens in Chrome DevTools or speedscope. See lib/cpuprofile.mjs for how samples are classified.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { formatProfileSummary, summarizeProfile } from './lib/cpuprofile.mjs'

const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))

function parseArgs(argv) {
	const args = { scenario: null, variant: null, size: null, mode: 'normal', top: 15, out: join(tmpdir(), 'widget-bench-profiles'), summarize: null }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--variant')
			args.variant = argv[++i]
		else if (arg === '--size')
			args.size = argv[++i]
		else if (arg === '--mode')
			args.mode = argv[++i]
		else if (arg === '--top')
			args.top = Number(argv[++i])
		else if (arg === '--out')
			args.out = argv[++i]
		else if (arg === '--summarize')
			args.summarize = argv[++i]
		else if (arg.startsWith('--'))
			throw new Error(`unknown option ${arg}`)
		else
			args.scenario = arg
	}
	return args
}

const args = parseArgs(process.argv.slice(2))
if (args.summarize !== null) {
	const profile = JSON.parse(readFileSync(args.summarize, 'utf8'))
	console.log(formatProfileSummary(args.summarize, summarizeProfile(profile, { top: args.top })))
}
else {
	if (args.scenario === null || args.size === null)
		throw new Error('usage: node benchmarks/profile.mjs <scenario> --size <n> [--variant <name>] [--mode normal|jitless]')
	mkdirSync(args.out, { recursive: true })
	const flags = args.mode === 'jitless' ? ['--expose-gc', '--jitless'] : ['--expose-gc']
	const childArgs = [...flags, worker, '--scenario', args.scenario, '--mode', args.mode, '--sizes', args.size, '--profile-dir', args.out]
	if (args.variant !== null)
		childArgs.push('--variant', args.variant)
	const child = spawnSync(process.execPath, childArgs, { encoding: 'utf8', maxBuffer: 1 << 28 })
	process.stderr.write(child.stderr)
	if (child.status !== 0)
		throw new Error(`worker failed with status ${child.status}`)
	const line = child.stdout.split('\n')
		.find(l => l.startsWith('__BENCH_RESULT__'))
	const result = JSON.parse(line.slice('__BENCH_RESULT__'.length))
	for (const variant of result.variants) {
		for (const row of variant.rows) {
			if (row.profileFile === undefined)
				continue
			const profile = JSON.parse(readFileSync(row.profileFile, 'utf8'))
			console.log(formatProfileSummary(`${args.scenario} / ${variant.name} @ ${row.size} [${args.mode}] (median ${(row.median / 1e3).toFixed(1)} us per run, spread ${(row.spread * 100).toFixed(1)}%)`, summarizeProfile(profile, { top: args.top })))
			console.log(`\nprofile: ${row.profileFile}\n`)
		}
	}
}
