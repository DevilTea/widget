/**
 * Driver of the `benchmark.yml` workflow: measures several commits INTERLEAVED in one job and compares them.
 *
 *   node benchmarks/ci/run-ab.mjs resolve --request <request.json> --out <resolved.json>
 *       validates the request; `BENCH_REQ_*` environment variables (the workflow_dispatch inputs) override its fields
 *   node benchmarks/ci/run-ab.mjs prepare --request <resolved.json> --refs-dir <dir>
 *       one detached `git worktree` per ref at <dir>/<index>, installed and built (the packages only)
 *   node benchmarks/ci/run-ab.mjs run --request <resolved.json> --refs-dir <dir> --out <results dir>
 *       `rounds` rounds; each round measures every ref once, in an order that rotates from round to round
 *       With a non-empty `stackSizes` it runs the stack-size sweep instead: no harness and no timing workload, only
 *       the QuickJS stack probes, once per ref and per stack size (plus the engine's default), see commandSweep
 *
 * Why interleaved: a hosted runner is a shared virtual machine, so absolute numbers differ between jobs and between
 * machines. The only valid comparison is between refs measured in the same job, alternating, with ONE copy of the
 * harness (the one in the checkout that runs this script; `BENCH_PACKAGES_ROOT` points it at each ref's packages).
 *
 * Failure policy: a scenario that fails in one round is listed in the summary and does not stop anything; a ref that
 * cannot be resolved or built, a measurement that wrote no JSON, or a comparison that crashes makes the exit code
 * non-zero (after the summary is written). A regression is a result, never a failure.
 */

import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, release, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { renderSweepTable, SHAPE_NOTE } from '../quickjs/probe-table.mjs'

const harnessRoot = fileURLToPath(new URL('../..', import.meta.url))
const MODES = ['normal', 'jitless', 'alloc']
const PACKAGES = ['core', 'vue', 'inspector']
const MIN_STACK_SIZE_KB = 64
const MAX_STACK_SIZE_KB = 1_048_576
const MAX_STACK_SIZES = 12
const IN_CI = process.env.GITHUB_ACTIONS === 'true'
/** The step summary of GitHub is limited to 1 MiB; stay well below it. */
const SUMMARY_BUDGET = 800_000

function fail(message) {
	if (IN_CI)
		console.log(`::error::${message.replace(/\r?\n/g, ' ')}`)
	console.error(`error: ${message}`)
	process.exit(1)
}

function group(title) {
	console.log(IN_CI ? `::group::${title}` : `\n=== ${title} ===`)
}

function endGroup() {
	if (IN_CI)
		console.log('::endgroup::')
}

function warn(message) {
	console.log(IN_CI ? `::warning::${message}` : `warning: ${message}`)
}

function seconds(ms) {
	const total = Math.round(ms / 1000)
	return total < 60
		? `${total}s`
		: `${Math.floor(total / 60)}m${String(total % 60)
			.padStart(2, '0')}s`
}

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	}
	catch (error) {
		return fail(`cannot read ${file}: ${error.message}`)
	}
}

function parseArgs(argv) {
	const [command, ...rest] = argv
	const args = { command, request: null, out: null, refsDir: null }
	for (let i = 0; i < rest.length; i++) {
		const option = rest[i]
		const value = rest[++i]
		if (value === undefined || value.startsWith('--'))
			fail(`${option} needs a value`)
		if (option === '--request')
			args.request = resolve(value)
		else if (option === '--out')
			args.out = resolve(value)
		else if (option === '--refs-dir')
			args.refsDir = resolve(value)
		else
			fail(`unknown option ${option}`)
	}
	return args
}

// ---------------------------------------------------------------------------------------------------------------
// The request

function list(value, name) {
	if (value === undefined || value === null)
		return []
	const items = Array.isArray(value)
		? value
		: String(value)
				.split(',')
	return items.map(item => String(item)
		.trim())
		.filter(item => item !== '')
		.map((item) => {
			if (/\s/.test(item) || item.startsWith('-'))
				fail(`${name}: "${item}" is not a plain name (no whitespace, no leading dash)`)
			return item
		})
}

function flag(value, name) {
	if (typeof value === 'boolean')
		return value
	if (value === 'true')
		return true
	if (value === 'false')
		return false
	return fail(`${name} must be true or false, got ${JSON.stringify(value)}`)
}

/** Overrides are the workflow_dispatch inputs: an empty string (or `request` for the booleans) keeps the file's value. */
function override(env, name) {
	const value = env[`BENCH_REQ_${name}`]
	return value === undefined || value.trim() === '' || value.trim() === 'request' ? undefined : value.trim()
}

export function normalizeRequest(raw, env = process.env) {
	const merged = { ...raw }
	for (const name of ['refs', 'filters', 'modes', 'sizes', 'stackSizes', 'rounds', 'quickjs', 'quick']) {
		const value = override(env, name.toUpperCase())
		if (value !== undefined)
			merged[name] = value
	}
	if (env.BENCH_REQ_NOTE !== undefined && env.BENCH_REQ_NOTE.trim() !== '')
		merged.note = env.BENCH_REQ_NOTE.trim()

	const refs = list(merged.refs, 'refs')
	if (refs.length < 2)
		fail('refs needs at least two entries: the base first, then what to compare with it')
	const modes = list(merged.modes ?? ['normal', 'jitless'], 'modes')
	const unknownModes = modes.filter(mode => !MODES.includes(mode))
	if (modes.length === 0 || unknownModes.length > 0)
		fail(`modes: unknown ${unknownModes.join(', ') || '(none given)'} (known: ${MODES.join(', ')})`)
	const rounds = Number(merged.rounds ?? 3)
	if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20)
		fail('rounds must be an integer from 1 to 20')
	const stackSizes = [...new Set(list(merged.stackSizes, 'stackSizes')
		.map((item) => {
			if (!/^\d+$/.test(item) || Number(item) < MIN_STACK_SIZE_KB || Number(item) > MAX_STACK_SIZE_KB)
				fail(`stackSizes: "${item}" is not an integer number of KB from ${MIN_STACK_SIZE_KB} to ${MAX_STACK_SIZE_KB}`)
			return Number(item)
		}))]
	if (stackSizes.length > MAX_STACK_SIZES)
		fail(`stackSizes takes at most ${MAX_STACK_SIZES} sizes, got ${stackSizes.length}`)
	return {
		refs,
		filters: list(merged.filters, 'filters'),
		modes: [...new Set(modes)],
		sizes: list(merged.sizes, 'sizes'),
		stackSizes,
		rounds,
		// A stack-size sweep runs on the real QuickJS: asking for one asks for QuickJS.
		quickjs: stackSizes.length > 0 || flag(merged.quickjs ?? false, 'quickjs'),
		quick: flag(merged.quick ?? false, 'quick'),
		note: typeof merged.note === 'string' ? merged.note : '',
	}
}

function commandResolve(args) {
	if (args.request === null || args.out === null)
		fail('resolve needs --request and --out')
	const request = normalizeRequest(readJson(args.request))
	mkdirSync(join(args.out, '..'), { recursive: true })
	writeFileSync(args.out, `${JSON.stringify(request, null, '\t')}\n`)
	console.log(JSON.stringify(request, null, '\t'))
}

// ---------------------------------------------------------------------------------------------------------------
// Preparing the checkouts

function git(cwd, ...gitArgs) {
	return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
		.trim()
}

function resolveSha(ref) {
	for (const candidate of [ref, `origin/${ref}`]) {
		try {
			return git(harnessRoot, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`)
		}
		catch {}
	}
	return fail(`ref "${ref}" does not resolve to a commit (tried "${ref}" and "origin/${ref}"; the checkout must have full history)`)
}

function runOrFail(command, commandArgs, cwd, what) {
	const started = Date.now()
	try {
		execFileSync(command, commandArgs, { cwd, stdio: 'inherit' })
	}
	catch (error) {
		endGroup()
		fail(`${what} failed (${error.status ?? error.signal ?? error.message})`)
	}
	console.log(`${what}: ${seconds(Date.now() - started)}`)
}

function commandPrepare(args) {
	if (args.request === null || args.refsDir === null)
		fail('prepare needs --request and --refs-dir')
	const request = readJson(args.request)
	mkdirSync(args.refsDir, { recursive: true })
	// Resolve everything first so a typo fails in seconds, not after the first ref was built.
	const refs = request.refs.map((ref, index) => ({ index, ref, sha: resolveSha(ref), dir: join(args.refsDir, String(index)) }))
	for (const entry of refs) {
		group(`prepare ref ${entry.index}: ${entry.ref} (${entry.sha.slice(0, 7)})`)
		entry.subject = git(harnessRoot, 'log', '-1', '--format=%s', entry.sha)
		runOrFail('git', ['worktree', 'add', '--detach', entry.dir, entry.sha], harnessRoot, 'git worktree add')
		// Scripts are off on purpose: the root `prepare` script installs git hooks (into the shared .git of a worktree),
		// and nothing the harness measures needs a lifecycle script (esbuild is only used from the main checkout).
		runOrFail('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], entry.dir, 'pnpm install')
		runOrFail('pnpm', ['--filter', './packages/*', 'build'], entry.dir, 'build')
		for (const name of PACKAGES) {
			const hasPackage = existsSync(join(entry.dir, 'packages', name, 'package.json'))
			if (hasPackage && !existsSync(join(entry.dir, 'packages', name, 'dist')))
				fail(`ref "${entry.ref}": packages/${name}/dist is missing after the build`)
		}
		endGroup()
	}
	writeFileSync(join(args.refsDir, 'refs.json'), `${JSON.stringify(refs, null, '\t')}\n`)
	console.log(refs.map(entry => `${entry.index}  ${entry.sha.slice(0, 10)}  ${entry.ref}  ${entry.subject}`)
		.join('\n'))
}

// ---------------------------------------------------------------------------------------------------------------
// Running

/** Spawns a command, copies its output to this process and to a log file, and resolves with the exit status. */
function runLogged(command, commandArgs, { env, logFile }) {
	return new Promise((resolveRun) => {
		const started = Date.now()
		const log = createWriteStream(logFile)
		const child = spawn(command, commandArgs, { cwd: harnessRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
		const forward = (stream, sink) => stream.on('data', (chunk) => {
			sink.write(chunk)
			log.write(chunk)
		})
		forward(child.stdout, process.stdout)
		forward(child.stderr, process.stderr)
		const finish = (code, signal, error) => {
			log.end(() => resolveRun({ code, signal, error, ms: Date.now() - started }))
		}
		child.on('error', error => finish(null, null, error.message))
		child.on('close', (code, signal) => finish(code, signal, undefined))
	})
}

function failedScenarios(logFile) {
	if (!existsSync(logFile))
		return []
	return readFileSync(logFile, 'utf8')
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.startsWith('FAILED '))
}

/** Round `round` measures the refs starting at `round % n`, so no ref is always first (or always last). */
export function rotation(round, count) {
	return Array.from({ length: count }, (_, k) => (k + round) % count)
}

export function comparisonPairs(count) {
	const pairs = []
	for (let i = 0; i + 1 < count; i++)
		pairs.push([i, i + 1])
	if (count > 2)
		pairs.push([0, count - 1])
	return pairs
}

function cpuModel() {
	if (existsSync('/proc/cpuinfo')) {
		const match = readFileSync('/proc/cpuinfo', 'utf8')
			.match(/^(?:model name|Model|Hardware)\t*: (.+)$/m)
		if (match)
			return match[1].trim()
	}
	return cpus()[0]?.model ?? 'unknown'
}

function machineInfo() {
	const env = process.env
	return {
		cpu: cpuModel(),
		cores: cpus().length,
		memoryGiB: Math.round(totalmem() / 2 ** 30 * 10) / 10,
		kernel: release(),
		node: process.version,
		platform: `${process.platform}-${process.arch}`,
		runner: [env.RUNNER_NAME, env.ImageOS, env.ImageVersion].filter(Boolean)
			.join(' / ') || null,
		loadAtStart: loadavg()
			.map(value => Math.round(value * 100) / 100),
		startedAt: new Date()
			.toISOString(),
	}
}

/** Pushes the headings of an embedded comparison table below the summary's own headings (`levels` deeper). */
function demote(text, levels) {
	return text.replace(/^(#{1,5}) /gm, (_, hashes) => `${hashes}${'#'.repeat(levels)} `)
}

function cut(text, budget) {
	if (text.length <= budget)
		return text
	const head = text.slice(0, budget)
	return `${head.slice(0, head.lastIndexOf('\n'))}\n\n_(truncated: the full table is in the artifact)_\n`
}

function runCompare(script, sidesA, sidesB, extra = []) {
	try {
		const output = execFileSync('node', [script, sidesA.join(','), sidesB.join(','), ...extra], {
			cwd: harnessRoot,
			encoding: 'utf8',
			maxBuffer: 256 * 2 ** 20,
		})
		return { ok: true, output }
	}
	catch (error) {
		return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}${error.message}` }
	}
}

async function installQjs(outDir) {
	if (process.env.BENCH_QJS)
		return process.env.BENCH_QJS
	const installer = join(harnessRoot, 'benchmarks/quickjs/install-qjs.sh')
	if (!existsSync(installer))
		throw new Error('benchmarks/quickjs/install-qjs.sh does not exist')
	if (process.platform !== 'linux' || process.arch !== 'x64')
		throw new Error(`no qjs binary for ${process.platform}-${process.arch} (set BENCH_QJS to one)`)
	const output = execFileSync('bash', [installer, join(outDir, 'qjs')], { cwd: harnessRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
	const path = output.trim()
		.split('\n')
		.pop()
	if (!path || !existsSync(path))
		throw new Error(`install-qjs.sh did not print the path of an existing binary (printed "${path}")`)
	return path
}

async function commandRun(args) {
	if (args.request === null || args.refsDir === null || args.out === null)
		fail('run needs --request, --refs-dir and --out')
	const request = readJson(args.request)
	const refs = readJson(join(args.refsDir, 'refs.json'))
	if (refs.length !== request.refs.length)
		fail('refs.json does not match the request; run `prepare` first with the same request')
	const out = args.out
	const logs = join(out, 'logs')
	mkdirSync(logs, { recursive: true })
	const machine = machineInfo()
	writeFileSync(join(out, 'machine.json'), `${JSON.stringify(machine, null, '\t')}\n`)
	writeFileSync(join(out, 'request.json'), `${JSON.stringify(request, null, '\t')}\n`)
	console.log(`runner: ${machine.cpu}, ${machine.cores} cores, ${machine.memoryGiB} GiB, node ${machine.node}`)

	if ((request.stackSizes ?? []).length > 0) {
		await commandSweep({ request, refs, out, logs, machine })
		return
	}

	// `--no-idle-check`: the idle check waits for the machine to be quiet and warns about other processes, which is
	// meaningful on a desktop and meaningless on a dedicated runner (nothing else of ours runs; the neighbours on the
	// host are invisible to it). The interleaving and the rounds are what protect the comparison here.
	const nodeArgs = [
		'benchmarks/run.mjs',
		...request.filters,
		'--mode',
		request.modes.join(','),
		...request.sizes.length > 0 ? ['--sizes', request.sizes.join(',')] : [],
		...request.quick ? ['--quick'] : [],
		'--no-idle-check',
	]

	const problems = []
	let fatal = false
	const runs = []
	const files = refs.map(() => ({ node: [], quickjs: [], calibration: [] }))

	let qjs = null
	let quickjsNote = null
	if (request.quickjs) {
		if (!existsSync(join(harnessRoot, 'benchmarks/quickjs/run.mjs'))) {
			quickjsNote = 'QuickJS was requested but `benchmarks/quickjs/run.mjs` does not exist in this checkout: skipped.'
			warn(quickjsNote)
		}
		else {
			try {
				qjs = await installQjs(out)
				console.log(`qjs: ${qjs}`)
			}
			catch (error) {
				quickjsNote = `QuickJS could not be prepared: ${error.message}`
				problems.push(quickjsNote)
				fatal = true
				warn(quickjsNote)
			}
		}
	}

	// The same in-engine bundle under `node --jitless` next to every QuickJS run: it relates the two engines (and is
	// cheap, without the stack probes), so a QuickJS ratio can be read against a jitless-V8 ratio of the same job.
	const engines = qjs === null
		? []
		: [
				{ key: 'quickjs', title: 'QuickJS', prefix: 'q', engine: qjs, extra: [] },
				{ key: 'calibration', title: 'the same bundle under node --jitless (calibration)', prefix: 'n', engine: 'node-jitless', extra: ['--stack-probe', 'false'] },
			]

	const jobStarted = Date.now()
	for (let round = 0; round < request.rounds; round++) {
		for (const index of rotation(round, refs.length)) {
			const entry = refs[index]
			const label = `round ${round + 1}/${request.rounds}, ref ${index} (${entry.ref} @ ${entry.sha.slice(0, 7)})`
			const env = { BENCH_PACKAGES_ROOT: entry.dir }

			group(`${label}: harness`)
			const jsonFile = join(out, `r${round}-${index}.json`)
			const logFile = join(logs, `r${round}-${index}.log`)
			const result = await runLogged('node', [...nodeArgs, '--json', jsonFile], { env, logFile })
			endGroup()
			console.log(`${label}: harness finished in ${seconds(result.ms)} (exit ${result.code ?? result.signal ?? result.error}); job so far ${seconds(Date.now() - jobStarted)}`)
			const failures = failedScenarios(logFile)
			const hasJson = existsSync(jsonFile)
			if (hasJson)
				files[index].node.push(jsonFile)
			else
				fatal = true
			runs.push({ round, index, kind: 'harness', ms: result.ms, code: result.code ?? result.signal ?? result.error, hasJson, failures })
			if (!hasJson)
				problems.push(`${label}: the harness wrote no JSON (${result.error ?? `exit ${result.code ?? result.signal}`}); see logs/r${round}-${index}.log`)
			else if (result.code !== 0 && failures.length === 0)
				problems.push(`${label}: the harness exited with ${result.code ?? result.signal} without a FAILED line; see logs/r${round}-${index}.log`)
			for (const line of failures)
				problems.push(`${label}: ${line}`)

			for (const engine of engines) {
				group(`${label}: ${engine.title}`)
				const engineFile = join(out, `${engine.prefix}${round}-${index}.json`)
				const engineLog = join(logs, `${engine.prefix}${round}-${index}.log`)
				const engineResult = await runLogged('node', ['benchmarks/quickjs/run.mjs', '--packages-root', entry.dir, '--qjs', engine.engine, ...engine.extra, '--json', engineFile], { env, logFile: engineLog })
				endGroup()
				const exit = engineResult.code ?? engineResult.signal ?? engineResult.error
				console.log(`${label}: ${engine.key} finished in ${seconds(engineResult.ms)} (exit ${exit})`)
				const engineHasJson = existsSync(engineFile)
				if (engineHasJson)
					files[index][engine.key].push(engineFile)
				else
					fatal = true
				runs.push({ round, index, kind: engine.key, ms: engineResult.ms, code: exit, hasJson: engineHasJson, failures: [] })
				if (!engineHasJson)
					problems.push(`${label}: the ${engine.key} runner wrote no JSON (exit ${exit}); see logs/${engine.prefix}${round}-${index}.log`)
				else if (engineResult.code !== 0)
					problems.push(`${label}: the ${engine.key} runner exited with ${exit} (a timing group failed; the JSON is kept); see logs/${engine.prefix}${round}-${index}.log`)
			}
		}
	}
	const totalMs = Date.now() - jobStarted

	// Comparisons: all rounds of each side at once (the median of the files' medians per side).
	const comparisons = []
	for (const [i, j] of comparisonPairs(refs.length)) {
		const entry = { i, j, node: null, nodeSignificant: null, engines: {} }
		if (files[i].node.length > 0 && files[j].node.length > 0) {
			const full = runCompare('benchmarks/compare.mjs', files[i].node, files[j].node)
			const significant = runCompare('benchmarks/compare.mjs', files[i].node, files[j].node, ['--only-significant'])
			writeFileSync(join(out, `compare-${i}-${j}.md`), full.output)
			writeFileSync(join(out, `compare-${i}-${j}.significant.md`), significant.output)
			entry.node = full
			entry.nodeSignificant = significant
			for (const [name, outcome] of [['compare.mjs', full], ['compare.mjs --only-significant', significant]]) {
				if (!outcome.ok) {
					fatal = true
					problems.push(`${name} ${i} vs ${j} failed: ${outcome.output.split('\n')[0]}`)
				}
			}
		}
		else {
			problems.push(`no harness result for ref ${files[i].node.length === 0 ? i : j}: comparison ${i} vs ${j} skipped`)
		}
		for (const engine of engines) {
			if (files[i][engine.key].length > 0 && files[j][engine.key].length > 0) {
				const outcome = runCompare('benchmarks/quickjs/compare.mjs', files[i][engine.key], files[j][engine.key])
				writeFileSync(join(out, `${engine.prefix}compare-${i}-${j}.md`), outcome.output)
				entry.engines[engine.key] = outcome
				if (!outcome.ok) {
					fatal = true
					problems.push(`${engine.key} comparison ${i} vs ${j} failed: ${outcome.output.split('\n')[0]}`)
				}
			}
		}
		comparisons.push(entry)
	}

	const summary = renderSummary({ request, refs, machine, runs, problems, comparisons, quickjsNote, engines, totalMs })
	writeFileSync(join(out, 'summary.md'), summary)
	console.log(`\nsummary: ${join(out, 'summary.md')} (${summary.length} characters); measured in ${seconds(totalMs)}`)
	for (const problem of problems)
		warn(problem)
	if (fatal)
		fail('the measurement is incomplete (see the summary): a harness run wrote no JSON, a comparison crashed, or QuickJS could not be prepared')
}

// ---------------------------------------------------------------------------------------------------------------
// The stack-size sweep

/**
 * `stackSizes` mode: no harness run, no timing workload and no comparison. For every ref and every stack size (and
 * once without `--stack-size`, the engine's default) the QuickJS stack probes run alone (`run.mjs --probes-only
 * true`) on the real binary; the summary has one table per ref with a column per stack size. The probes are
 * deterministic bisections, so there are no rounds. A run that wrote no JSON fails the job (after the summary).
 */
async function commandSweep({ request, refs, out, logs, machine }) {
	const problems = []
	let fatal = false
	let qjs = null
	try {
		qjs = await installQjs(out)
		console.log(`qjs: ${qjs}`)
	}
	catch (error) {
		problems.push(`QuickJS could not be prepared: ${error.message}`)
		fatal = true
	}

	// `null` is the engine's own default stack limit.
	const columns = [null, ...request.stackSizes]
	const runs = []
	const jobStarted = Date.now()
	const results = refs.map(() => [])
	if (qjs !== null) {
		for (const entry of refs) {
			for (const stackSize of columns) {
				const tag = stackSize === null ? 'default' : `${stackSize}k`
				const label = `ref ${entry.index} (${entry.ref} @ ${entry.sha.slice(0, 7)}), stack ${stackSize === null ? 'engine default' : `${stackSize} KB`}`
				group(`${label}: probes`)
				const jsonFile = join(out, `s${entry.index}-${tag}.json`)
				const logFile = join(logs, `s${entry.index}-${tag}.log`)
				const result = await runLogged('node', [
					'benchmarks/quickjs/run.mjs',
					'--packages-root',
					entry.dir,
					'--qjs',
					qjs,
					'--probes-only',
					'true',
					...stackSize === null ? [] : ['--stack-size', String(stackSize)],
					'--json',
					jsonFile,
				], { env: { BENCH_PACKAGES_ROOT: entry.dir }, logFile })
				endGroup()
				const exit = result.code ?? result.signal ?? result.error
				console.log(`${label}: finished in ${seconds(result.ms)} (exit ${exit}); job so far ${seconds(Date.now() - jobStarted)}`)
				const hasJson = existsSync(jsonFile)
				if (hasJson)
					results[entry.index].push({ label: stackSize === null ? 'engine default' : `${stackSize} KB`, data: readJson(jsonFile) })
				else
					fatal = true
				runs.push({ index: entry.index, stackSize, ms: result.ms, code: exit, hasJson })
				if (!hasJson)
					problems.push(`${label}: the probe runner wrote no JSON (exit ${exit}); see logs/s${entry.index}-${tag}.log`)
				else if (result.code !== 0)
					problems.push(`${label}: the probe runner exited with ${exit}; the JSON is kept; see logs/s${entry.index}-${tag}.log`)
			}
		}
	}
	const totalMs = Date.now() - jobStarted

	const summary = renderSweepSummary({ request, refs, machine, runs, problems, results, totalMs })
	writeFileSync(join(out, 'summary.md'), summary)
	console.log(`\nsummary: ${join(out, 'summary.md')} (${summary.length} characters); swept in ${seconds(totalMs)}`)
	for (const problem of problems)
		warn(problem)
	if (fatal)
		fail('the sweep is incomplete (see the summary): a probe runner wrote no JSON, or QuickJS could not be prepared')
}

// ---------------------------------------------------------------------------------------------------------------
// The summary

function cell(text) {
	return String(text)
		.replace(/\|/g, '\\|')
		.replace(/\r?\n/g, ' ')
}

function commitLines(refs) {
	const lines = ['## Commits', '', '| # | ref | SHA | subject |', '| --- | --- | --- | --- |']
	for (const entry of refs)
		lines.push(`| ${entry.index}${entry.index === 0 ? ' (base)' : ''} | \`${cell(entry.ref)}\` | \`${entry.sha.slice(0, 12)}\` | ${cell(entry.subject)} |`)
	lines.push('')
	return lines
}

function runnerLines(machine, totalMs, what) {
	return [
		'## Runner',
		'',
		`- CPU: ${machine.cpu}, ${machine.cores} cores, ${machine.memoryGiB} GiB memory`,
		`- ${machine.platform}, kernel ${machine.kernel}, Node ${machine.node}${machine.runner ? `, runner ${machine.runner}` : ''}`,
		`- load average at start: ${machine.loadAtStart.join(' ')}; ${what} took ${seconds(totalMs)}`,
		'',
	]
}

function renderSweepSummary({ request, refs, machine, runs, problems, results, totalMs }) {
	const lines = ['# QuickJS stack-size sweep', '']
	if (request.note !== '') {
		lines.push(request.note.replace(/\r?\n/g, '\n> ')
			.replace(/^/, '> '), '')
	}
	lines.push(...commitLines(refs))
	lines.push(`Stack sizes: engine default, ${request.stackSizes.map(size => `${size} KB`)
		.join(', ')}. Only the stack probes ran: no timing workload, no comparison between refs.`, '')
	lines.push(...runnerLines(machine, totalMs, 'the sweep'))

	if (problems.length > 0) {
		lines.push('## Problems', '')
		for (const problem of problems)
			lines.push(`- ${problem.replace(/\r?\n/g, ' ')}`)
		lines.push('')
	}

	lines.push('## Largest working length per stack size', '')
	lines.push('Each cell is the largest length at which the step still works (bisection, resolution about 1 %), found on the real QuickJS in fresh processes. "at least N": it still worked at N, the cap of the search, so N is a lower bound and not a limit. "< N": it failed already at the first length tried. The first row is a calibration without any Widget code: how many nested calls of an empty function the engine allows; it should grow in proportion to the stack size, and if it does not, the engine did not read `--stack-size` as KB.', '')
	lines.push(SHAPE_NOTE, '')
	for (const entry of refs) {
		lines.push(`### ${entry.index} \`${cell(entry.ref)}\` (${entry.sha.slice(0, 7)})`, '')
		if (results[entry.index].length === 0)
			lines.push('_No result._', '')
		else
			lines.push(renderSweepTable(results[entry.index]), '')
	}

	lines.push('## Runs', '', '| ref | stack | time | exit | JSON |', '| --- | --- | --- | --- | --- |')
	for (const run of runs)
		lines.push(`| ${run.index} | ${run.stackSize === null ? 'engine default' : `${run.stackSize} KB`} | ${seconds(run.ms)} | ${run.code} | ${run.hasJson ? 'yes' : '**no**'} |`)
	lines.push('')
	lines.push('## Files in the artifact `benchmark-results`', '')
	lines.push('- `s<ref>-<stack>.json`: the complete probe results (every attempt) of ref `<ref>` at `<stack>` (`default` or a size in KB with a `k`)')
	lines.push('- `logs/`: the output of every run; `request.json`, `machine.json`', '')
	return `${lines.join('\n')}\n`
}

function renderSummary({ request, refs, machine, runs, problems, comparisons, quickjsNote, engines, totalMs }) {
	const qjsEnabled = engines.length > 0
	const lines = []
	const name = entry => `${entry.index} \`${entry.ref}\` (${entry.sha.slice(0, 7)})`
	lines.push('# Benchmark comparison', '')
	if (request.note !== '') {
		lines.push(request.note.replace(/\r?\n/g, '\n> ')
			.replace(/^/, '> '), '')
	}

	lines.push(...commitLines(refs))
	const filters = request.filters.length > 0
		? request.filters.map(filter => `\`${filter}\``)
				.join(', ')
		: 'everything'
	lines.push(`Scenarios: ${filters}. Modes: ${request.modes.join(', ')}. Sizes: ${request.sizes.length > 0 ? request.sizes.join(', ') : 'all'}. Rounds: ${request.rounds}${request.quick ? '. **Quick mode: few samples, not baseline quality.**' : '.'} QuickJS: ${qjsEnabled ? 'yes' : request.quickjs ? 'requested but not run' : 'no'}.`, '')
	lines.push(`In each comparison A is the first ref of the pair and B the second; a B/A ratio above 1 means B is slower (or allocates more).`, '')

	lines.push(...runnerLines(machine, totalMs, 'measuring'))

	if (problems.length > 0) {
		lines.push('## Problems', '')
		for (const problem of problems)
			lines.push(`- ${problem.replace(/\r?\n/g, ' ')}`)
		lines.push('')
	}

	const sections = comparisons.length
	const budget = Math.max(20_000, Math.floor(SUMMARY_BUDGET / Math.max(1, sections * (1 + engines.length))))
	lines.push('## Significant differences', '', `Rows whose medians differ by more than the threshold (5 %), the median of the ${request.rounds} per-round medians per side. The full tables are in the artifact.`, '')
	for (const entry of comparisons) {
		const a = refs[entry.i]
		const b = refs[entry.j]
		lines.push(`### ${name(a)} vs ${name(b)}`, '')
		if (entry.nodeSignificant === null)
			lines.push('_Not compared: a side has no result._', '')
		else if (!entry.nodeSignificant.ok)
			lines.push('_The comparison failed; see the artifact logs._', '')
		else
			lines.push(entry.nodeSignificant.output.trim() === '' ? '_No output._' : cut(demote(entry.nodeSignificant.output, 2), budget), '')
		for (const engine of engines) {
			const outcome = entry.engines[engine.key]
			if (outcome === undefined)
				continue
			lines.push(`#### ${engine.title}`, '')
			lines.push(outcome.ok ? cut(demote(outcome.output, 3), budget) : '_The comparison failed; see the artifact._', '')
		}
	}
	if (quickjsNote !== null)
		lines.push(`> ${quickjsNote}`, '')

	lines.push('## Runs', '', '| round | ref | part | time | exit | JSON | failed scenarios |', '| --- | --- | --- | --- | --- | --- | --- |')
	for (const run of runs)
		lines.push(`| ${run.round + 1} | ${run.index} | ${run.kind} | ${seconds(run.ms)} | ${run.code} | ${run.hasJson ? 'yes' : '**no**'} | ${run.failures.length} |`)
	lines.push('')

	lines.push('## Files in the artifact `benchmark-results`', '')
	lines.push('- `compare-<i>-<j>.md`: the full comparison table of refs i and j (`compare-<i>-<j>.significant.md`: only the significant rows)')
	if (qjsEnabled)
		lines.push('- `qcompare-<i>-<j>.md`, `ncompare-<i>-<j>.md`: the QuickJS comparison and the node --jitless calibration comparison')
	lines.push('- `r<round>-<i>.json`: every raw sample of the harness run of ref i in that round (round numbers start at 0)')
	if (qjsEnabled)
		lines.push('- `q<round>-<i>.json`, `n<round>-<i>.json`: the QuickJS and node --jitless calibration results')
	lines.push('- `logs/`: the complete output of every run; `request.json`, `machine.json`', '')

	lines.push('## How to read these numbers', '')
	lines.push('Numbers are comparable only within this job. Hosted runners are shared virtual machines: absolute timings differ from run to run and from machine to machine, so a figure from this job must never be compared with a figure from another job, another runner or a developer machine. The commits above were measured in this one job on this one runner, interleaved (the order of the refs rotates from round to round) and with the same copy of the harness, which is the only comparison that is meaningful. `--jitless` rows (an interpreter-only engine) are the most reproducible; normal-mode rows of sub-microsecond operations can differ between processes by more than their own spread shows.', '')
	return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2))
	if (args.command === 'resolve')
		commandResolve(args)
	else if (args.command === 'prepare')
		commandPrepare(args)
	else if (args.command === 'run')
		await commandRun(args)
	else
		fail('usage: run-ab.mjs resolve|prepare|run (see the header of this file)')
}
