/**
 * node benchmarks/quickjs/run.mjs --packages-root <checkout> --qjs <qjs binary | node | node-jitless> --json <out.json>
 *                                 [--sizes 100,1000] [--samples 15] [--stack-probe true|false]
 *                                 [--stack-size <KB>] [--workloads a,b] [--max-seconds 60] [--bundle-out file]
 *                                 [--probes-only true|false] [--probe-phases a,b]
 *
 * Bundles ONE self-contained script (ES module, no imports at run time) from `<checkout>/packages/core/dist/index.mjs`
 * (+ its `alien-signals`, resolved from that checkout), `benchmarks/lib/gen.mjs` and the in-engine code in this
 * directory, then runs it with the engine once per measurement group (a workload at a size) in a fresh process, so
 * one group's heap never affects the next, and parses the one `@@QJSBENCH@@ {json}` line each prints.
 *
 * Stack probes: for each shape (a chain of dependent Properties; a survey whose question k's visibility reads
 * question k+1's value) and phase (see probe-defs.mjs: compile; cold read of the head Property; and the teardown
 * steps warm re-read, unsubscribe, re-read after unsubscribe, dispose with a subscriber; and re-read after writing
 * every State) the largest length that
 * works is found by doubling, then bisection. A probe that still works at the cap of the search reports "at least
 * <cap>" (`ceiling: true` in the JSON), never a number that looks like a limit. `--probes-only true` skips every
 * timing workload (the stack-size sweep of the CI driver uses it); `--probe-phases` restricts the phases.
 * Every attempt is a fresh process: after a stack overflow QuickJS itself keeps
 * running, but an attempt that crashes or runs away must not take the next one with it, and a fresh process also
 * starts every attempt from the same shallow stack and an empty heap. A crash or a timeout counts as a failure
 * of that length and is recorded as such.
 *
 * `--qjs node` / `--qjs node-jitless` run the very same bundle under Node (calibration, and how this is tested
 * without a QuickJS binary). `--stack-size` passes the engine's own stack limit (KB) to `qjs` / `node`; `qjs` gets
 * it as `<KB>k`, which is kibibytes whether the option reads bytes with unit suffixes or a plain number of KB.
 */

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PROBE_PHASE_NAMES, PROBE_PHASES, PROBE_SHAPES } from './probe-defs.mjs'

const MARKER = '@@QJSBENCH@@ '
const here = fileURLToPath(new URL('./', import.meta.url))
const harnessRoot = resolve(here, '../../')
const WORKLOAD_NAMES = ['compile', 'createRuntime', 'embedded.create-per-input', 'embedded.reuse-resetState', 'resetState', 'snapshotState']

function parseArgs(argv) {
	const args = {
		packagesRoot: null,
		qjs: null,
		json: null,
		sizes: [100, 1000],
		samples: 15,
		stackProbe: true,
		stackSize: null,
		probesOnly: false,
		probePhases: PROBE_PHASE_NAMES,
		workloads: WORKLOAD_NAMES,
		maxSeconds: 60,
		probeTimeoutSeconds: 120,
		bundleOut: null,
	}
	const value = (i, option) => {
		if (i >= argv.length || argv[i].startsWith('--'))
			throw new Error(`${option} needs a value`)
		return argv[i]
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--packages-root') {
			args.packagesRoot = resolve(value(++i, arg))
		}
		else if (arg === '--qjs') {
			args.qjs = value(++i, arg)
		}
		else if (arg === '--json') {
			args.json = resolve(value(++i, arg))
		}
		else if (arg === '--sizes') {
			args.sizes = value(++i, arg)
				.split(',')
				.map(Number)
		}
		else if (arg === '--samples') {
			args.samples = Number(value(++i, arg))
		}
		else if (arg === '--stack-probe') {
			const flag = value(++i, arg)
			if (flag !== 'true' && flag !== 'false')
				throw new Error('--stack-probe takes true or false')
			args.stackProbe = flag === 'true'
		}
		else if (arg === '--stack-size') {
			args.stackSize = Number(value(++i, arg))
		}
		else if (arg === '--probes-only') {
			const flag = value(++i, arg)
			if (flag !== 'true' && flag !== 'false')
				throw new Error('--probes-only takes true or false')
			args.probesOnly = flag === 'true'
		}
		else if (arg === '--probe-phases') {
			args.probePhases = value(++i, arg)
				.split(',')
		}
		else if (arg === '--workloads') {
			args.workloads = value(++i, arg)
				.split(',')
		}
		else if (arg === '--max-seconds') {
			args.maxSeconds = Number(value(++i, arg))
		}
		else if (arg === '--probe-timeout') {
			args.probeTimeoutSeconds = Number(value(++i, arg))
		}
		else if (arg === '--bundle-out') {
			args.bundleOut = resolve(value(++i, arg))
		}
		else {
			throw new Error(`unknown argument ${arg}`)
		}
	}
	for (const [name, present] of [['--packages-root', args.packagesRoot], ['--qjs', args.qjs], ['--json', args.json]]) {
		if (present === null)
			throw new Error(`${name} is required`)
	}
	if (args.sizes.some(size => !Number.isInteger(size) || size < 10))
		throw new Error('--sizes takes integers of at least 10')
	if (!Number.isInteger(args.samples) || args.samples < 5)
		throw new Error('--samples takes an integer of at least 5')
	if (args.stackSize !== null && (!Number.isInteger(args.stackSize) || args.stackSize < 1))
		throw new Error('--stack-size takes a positive integer (KB)')
	const unknownPhases = args.probePhases.filter(name => !PROBE_PHASE_NAMES.includes(name))
	if (unknownPhases.length > 0 || args.probePhases.length === 0)
		throw new Error(`unknown probe phase ${unknownPhases.join(', ') || '(none given)'} (known: ${PROBE_PHASE_NAMES.join(', ')})`)
	if (args.probesOnly)
		args.stackProbe = true
	const unknown = args.workloads.filter(name => !WORKLOAD_NAMES.includes(name))
	if (unknown.length > 0)
		throw new Error(`unknown workload ${unknown.join(', ')} (known: ${WORKLOAD_NAMES.join(', ')})`)
	return args
}

// ----- bundling ----------------------------------------------------------------------------------

/** The esbuild that already sits in a workspace's node_modules (never added as a dependency; same lookup as scenarios/size.mjs). */
function findEsbuild(roots) {
	for (const root of roots) {
		const store = join(root, 'node_modules', '.pnpm')
		if (!existsSync(store))
			continue
		const dir = readdirSync(store)
			.find(name => name.startsWith('esbuild@'))
		if (dir === undefined)
			continue
		try {
			return createRequire(join(store, dir, 'node_modules', 'esbuild', 'package.json'))('esbuild')
		}
		catch {}
	}
	throw new Error(`no esbuild found under ${roots.map(root => join(root, 'node_modules', '.pnpm'))
		.join(' or ')} (run pnpm install)`)
}

/**
 * esbuild plugin: `@bench/core` is the checkout's Core build; `benchmarks/lib/load.mjs` (a Node-only loader that
 * gen.mjs imports) becomes a module that hands out that same Core namespace; gen.mjs's top-level
 * `await loadCore()` is made synchronous so the bundle has no top-level await (every engine runs it the same way).
 */
function benchPlugin(coreEntry) {
	const genFile = join(harnessRoot, 'benchmarks', 'lib', 'gen.mjs')
	return {
		name: 'widget-bench',
		setup(build) {
			build.onResolve({ filter: /^@bench\/core$/ }, () => ({ path: coreEntry }))
			build.onResolve({ filter: /(^|\/)load\.mjs$/ }, args => (
				args.importer === genFile ? { path: 'load', namespace: 'bench-virtual' } : undefined
			))
			build.onLoad({ filter: /.*/, namespace: 'bench-virtual' }, () => ({
				contents: 'import * as core from \'@bench/core\'\nexport const loadCore = () => core\n',
				resolveDir: here,
			}))
			build.onLoad({ filter: /[\\/]gen\.mjs$/ }, (args) => {
				if (args.path !== genFile)
					return undefined
				const source = readFileSync(args.path, 'utf8')
				return { contents: source.replace('await loadCore()', 'loadCore()'), loader: 'js' }
			})
		},
	}
}

/** Versions of what went into the bundle, so two result files built from different dependencies can be told apart. */
function dependencyVersions(inputs, packagesRoot) {
	const versions = {}
	try {
		versions.core = JSON.parse(readFileSync(join(packagesRoot, 'packages', 'core', 'package.json'), 'utf8')).version
	}
	catch {}
	const alien = inputs.find(input => /[\\/]alien-signals[\\/]/.test(input))
	if (alien !== undefined) {
		let dir = dirname(resolve(alien))
		while (dir !== dirname(dir)) {
			const manifest = join(dir, 'package.json')
			if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'alien-signals') {
				versions.alienSignals = JSON.parse(readFileSync(manifest, 'utf8')).version
				break
			}
			dir = dirname(dir)
		}
	}
	return versions
}

async function bundle(packagesRoot) {
	const coreEntry = join(packagesRoot, 'packages', 'core', 'dist', 'index.mjs')
	if (!existsSync(coreEntry))
		throw new Error(`${coreEntry} is missing: build Core in that checkout first (pnpm --filter "./packages/core" build)`)
	const esbuild = findEsbuild([harnessRoot, packagesRoot])
	const result = await esbuild.build({
		entryPoints: [join(here, 'entry.mjs')],
		bundle: true,
		format: 'esm',
		platform: 'neutral',
		target: 'es2022',
		write: false,
		logLevel: 'silent',
		metafile: true,
		plugins: [benchPlugin(coreEntry)],
	})
	const inputs = Object.keys(result.metafile.inputs)
	if (inputs.some(input => input.startsWith('node:')))
		throw new Error(`the bundle pulled in a Node built-in: ${inputs.filter(input => input.startsWith('node:'))}`)
	return { code: result.outputFiles[0].text, esbuildVersion: esbuild.version, dependencies: dependencyVersions(inputs, packagesRoot) }
}

// ----- running the engine --------------------------------------------------------------------------

function engineCommand(args, file) {
	if (args.qjs === 'node' || args.qjs === 'node-jitless') {
		const flags = args.qjs === 'node-jitless' ? ['--jitless'] : []
		if (args.stackSize !== null)
			flags.push(`--stack-size=${args.stackSize}`)
		return { command: process.execPath, argv: [...flags, file] }
	}
	const flags = args.stackSize === null ? [] : ['--stack-size', `${args.stackSize}k`]
	return { command: resolve(args.qjs), argv: [...flags, '-m', file] }
}

/** Writes `config` in front of the bundle, runs it, returns `{ payload }` or `{ failure }`. */
function runBundle(args, workdir, code, config, label, timeoutSeconds) {
	const file = join(workdir, `${label.replace(/[^\w.-]/g, '_')}.mjs`)
	writeFileSync(file, `globalThis.__WIDGET_BENCH__ = ${JSON.stringify(config)};\n${code}`)
	const { command, argv } = engineCommand(args, file)
	const result = spawnSync(command, argv, { encoding: 'utf8', timeout: timeoutSeconds * 1000, maxBuffer: 256 * 1024 * 1024 })
	rmSync(file, { force: true })
	if (result.error !== undefined) {
		const timedOut = result.error.code === 'ETIMEDOUT'
		return { failure: { kind: timedOut ? 'timeout' : 'spawn', message: String(result.error.message), status: null, signal: result.signal ?? null } }
	}
	const line = result.stdout.split('\n')
		.reverse()
		.find(text => text.startsWith(MARKER))
	if (line === undefined) {
		return {
			failure: {
				kind: result.signal === null ? 'no-result' : 'crash',
				message: `exit ${result.status}${result.signal === null ? '' : `, signal ${result.signal}`}; stderr: ${result.stderr.trim()
					.slice(-400)}`,
				status: result.status,
				signal: result.signal,
				stderr: result.stderr.slice(0, 4000),
			},
		}
	}
	const payload = JSON.parse(line.slice(MARKER.length))
	if (payload.error !== undefined)
		return { failure: { kind: 'script-error', message: `${payload.error.name}: ${payload.error.message}`, status: result.status, signal: null, stack: payload.error.stack } }
	return { payload }
}

function engineVersion(args) {
	if (args.qjs === 'node' || args.qjs === 'node-jitless')
		return { name: args.qjs, version: process.version, command: args.qjs === 'node' ? 'node' : 'node --jitless' }
	const result = spawnSync(resolve(args.qjs), ['--version'], { encoding: 'utf8' })
	if (result.error !== undefined || result.status !== 0)
		throw new Error(`${args.qjs} --version failed: ${result.error?.message ?? result.stderr}`)
	const text = result.stdout.trim()
	return { name: /^QuickJS version/i.test(text) ? 'quickjs' : 'quickjs-ng', version: text, command: resolve(args.qjs) }
}

function gitInfo(root) {
	const git = (...argv) => spawnSync('git', ['-C', root, ...argv], { encoding: 'utf8' })
	const sha = git('rev-parse', 'HEAD')
	if (sha.status !== 0)
		return { sha: null, dirty: null }
	return { sha: sha.stdout.trim(), dirty: git('status', '--porcelain', '--untracked-files=no').stdout.trim() !== '' }
}

// ----- stack probes --------------------------------------------------------------------------------

/**
 * The error of an attempt whose process produced no result line. QuickJS (quickjs-ng >= 0.18) makes InternalError
 * uncatchable by script code, so an error of that class would end the script without a result: its name and message
 * are then read from the uncaught-exception report on stderr; a crash or a timeout is reported as such.
 */
function processError(failure) {
	const match = /^(\w*Error): (.*)$/m.exec(failure.stderr ?? '')
	if (failure.kind === 'no-result' && match !== null)
		return { name: match[1], constructor: match[1], message: match[2].slice(0, 300), uncaught: true }
	return { name: failure.kind, constructor: '', message: failure.message.slice(0, 300) }
}

function runProbes(args, workdir, code, results) {
	const probes = []
	for (const { shape, unit, start, ceiling } of PROBE_SHAPES) {
		for (const { phase } of PROBE_PHASES.filter(item => args.probePhases.includes(item.phase))) {
			const attempts = []
			const tryLength = (length) => {
				const run = runBundle(args, workdir, code, { kind: 'probe', shape, phase, length }, `probe-${shape}-${phase}-${length}`, args.probeTimeoutSeconds)
				let record
				if (run.failure !== undefined)
					record = { length, ok: false, stage: 'process', error: processError(run.failure) }
				else
					record = { length, ...run.payload.outcome }
				record.processFailure = record.stage === 'process' && record.error.uncaught !== true
				attempts.push(record)
				process.stderr.write(`  probe ${shape}/${phase} ${length} ${unit}: ${record.ok ? 'ok' : `FAIL ${record.error.name}: ${record.error.message.slice(0, 80)}`}\n`)
				return record.ok
			}
			let low = 0
			let high = null
			let length = start
			for (;;) {
				if (tryLength(length)) {
					low = length
					if (length >= ceiling)
						break
					length = Math.min(length * 2, ceiling)
				}
				else {
					high = length
					break
				}
			}
			while (high !== null && high - low > Math.max(1, Math.ceil(low * 0.01))) {
				const mid = Math.floor((low + high) / 2)
				if (tryLength(mid))
					low = mid
				else
					high = mid
			}
			const firstFail = high === null ? undefined : attempts.find(a => a.length === high && !a.ok)
			process.stderr.write(`  => ${shape}/${phase}: ${high === null ? `at least ${low} ${unit} (still works at the cap of the search)` : low === 0 ? `fails already at ${start} ${unit}` : `largest ${low} ${unit}`}\n`)
			probes.push({
				shape,
				phase,
				unit,
				start,
				cap: ceiling,
				// `maxOk` is a limit only when `ceiling` is false; when it is true the probe still worked at `maxOk` (= the cap): "at least".
				maxOk: low,
				firstFail: firstFail === undefined ? null : { length: firstFail.length, stage: firstFail.stage, error: firstFail.error },
				ceiling: high === null,
				// A crash or a timeout is not an engine stack-overflow error: say so.
				inconclusive: attempts.some(a => a.processFailure === true),
				attempts: attempts.sort((a, b) => a.length - b.length),
			})
		}
	}
	results.probes = probes
}

// ----- main ----------------------------------------------------------------------------------------

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const startedAt = new Date()
		.toISOString()
	const { code, esbuildVersion, dependencies } = await bundle(args.packagesRoot)
	if (args.bundleOut !== null) {
		mkdirSync(dirname(args.bundleOut), { recursive: true })
		writeFileSync(args.bundleOut, code)
	}
	const engine = engineVersion(args)
	const workdir = mkdtempSync(join(tmpdir(), 'widget-qjs-'))
	const results = {
		schema: 1,
		engine,
		packagesRoot: args.packagesRoot,
		git: gitInfo(args.packagesRoot),
		harnessGit: gitInfo(harnessRoot),
		bundle: { bytes: Buffer.byteLength(code), esbuild: esbuildVersion, ...dependencies },
		args: { sizes: args.sizes, samples: args.samples, stackProbe: args.stackProbe, stackSize: args.stackSize, probesOnly: args.probesOnly, probePhases: args.probePhases, workloads: args.workloads },
		startedAt,
		finishedAt: null,
		rows: [],
		probes: [],
		failures: [],
	}
	const write = () => {
		results.finishedAt = new Date()
			.toISOString()
		mkdirSync(dirname(args.json), { recursive: true })
		writeFileSync(args.json, `${JSON.stringify(results, null, '\t')}\n`)
	}
	try {
		const info = runBundle(args, workdir, code, { kind: 'info' }, 'info', 60)
		if (info.failure !== undefined)
			throw new Error(`the engine cannot run the bundle: ${info.failure.kind}: ${info.failure.message}`)
		results.engine.clock = info.payload.clock
		results.engine.fineClock = info.payload.fineClock
		results.engine.plainRecursionDepth = info.payload.plainRecursionDepth
		if (info.payload.userAgent !== undefined)
			results.engine.userAgent = info.payload.userAgent
		for (const size of args.probesOnly ? [] : args.sizes) {
			for (const workload of args.workloads) {
				process.stderr.write(`${workload} @ ${size}\n`)
				const run = runBundle(args, workdir, code, { kind: 'timing', workload, size, samples: args.samples, maxSeconds: args.maxSeconds }, `${workload}-${size}`, 900)
				if (run.failure !== undefined) {
					results.failures.push({ workload, size, ...run.failure })
					process.stderr.write(`  FAILED ${run.failure.kind}: ${run.failure.message}\n`)
				}
				else {
					results.rows.push(...run.payload.rows)
					const row = run.payload.rows[0]
					process.stderr.write(`  median ${(row.median / 1000).toFixed(1)} us/op, spread ${(row.spread * 100).toFixed(1)}%, ${row.samples} samples x ${row.reps} reps\n`)
				}
				write()
			}
		}
		if (args.stackProbe) {
			process.stderr.write('stack probes\n')
			runProbes(args, workdir, code, results)
		}
	}
	finally {
		rmSync(workdir, { recursive: true, force: true })
		write()
	}
	if (results.failures.length > 0) {
		process.stderr.write(`${results.failures.length} measurement group(s) failed\n`)
		process.exitCode = 1
	}
}

await main()
