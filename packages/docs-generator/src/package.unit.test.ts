/**
 * The built package (`dist`), as Node loads it: its subpaths, the bin, the run-time worker, the docs cache's generator
 * hash and the `./runtime` chunk graph. Every test runs the built files in a plain `node` child process (no TypeScript
 * loader, no Vite transform). Run `pnpm build` (or `pnpm --filter @deviltea/widget-docs-generator... build`) first.
 */

import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const dist = join(packageRoot, 'dist')
const fixture = join(packageRoot, 'fixtures/survey-system.ts')
const tsconfig = join(packageRoot, 'tsconfig.json')

interface PackageJson {
	readonly private?: boolean
	readonly version: string
	readonly publishConfig?: { readonly access?: string }
	readonly files: readonly string[]
	readonly sideEffects?: boolean
	readonly exports: Record<string, { readonly types: string, readonly import?: string }>
	readonly bin: Record<string, string>
	readonly dependencies: Record<string, string>
	readonly peerDependencies: Record<string, string>
	readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>
	readonly devDependencies: Record<string, string>
	readonly engines?: { readonly node?: string }
}

const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as PackageJson

const scripts = mkdtempSync(join(tmpdir(), 'widget-docs-package-'))
afterAll(() => rmSync(scripts, { recursive: true, force: true }))
let scriptCount = 0

/**
 * How long one child process may run. Every test that starts one has a timeout above this, so a hung child is killed
 * and fails its test with a message instead of blocking the Vitest worker (a synchronous call ignores the test timeout).
 */
const CHILD_TIMEOUT = 45_000
const TEST_TIMEOUT = 60_000

interface ChildResult {
	status: number | null
	stdout: string
	stderr: string
}

/** Runs `node <args>` in `cwd`; throws when the child cannot start or outlives `timeout`. */
function runChild(args: readonly string[], cwd: string, timeout: number = CHILD_TIMEOUT): ChildResult {
	const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL' })
	if (result.error !== undefined) {
		const reason = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? `did not finish within ${String(timeout)} ms and was killed` : `failed to run (${result.error.message})`
		throw new Error(`node ${args.join(' ')} ${reason}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
	}
	return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Runs an ES module script with plain `node` in `cwd` and returns its standard output; throws on a non-zero exit or a
 * timeout. The script is a file, not `--eval`: a worker thread inherits the process's `execArgv`, and `--input-type`
 * is not allowed there.
 */
function runNode(script: string, { cwd = packageRoot, timeout = CHILD_TIMEOUT }: { cwd?: string, timeout?: number } = {}): string {
	const file = join(scripts, `script-${String(scriptCount++)}.mjs`)
	writeFileSync(file, script)
	const result = runChild([file], cwd, timeout)
	if (result.status !== 0)
		throw new Error(`node ${file} exited with ${String(result.status)}:\n${result.stderr}`)
	return result.stdout
}

/** Runs the built bin in `cwd`. */
function runBin(args: readonly string[], cwd: string = packageRoot): ChildResult {
	return runChild([join(dist, 'cli.mjs'), ...args], cwd)
}

describe('the child-process helpers', () => {
	it('kill a child that outlives its timeout and fail with a message that says so', () => {
		expect(() => runNode('await new Promise(resolve => setTimeout(resolve, 30_000))', { timeout: 300 }))
			.toThrow(/did not finish within 300 ms and was killed/)
	})
})

beforeAll(() => {
	if (!existsSync(join(dist, 'index.mjs')))
		throw new Error(`${dist} is missing: run \`pnpm build\` first.`)
})

describe('the package boundary', () => {
	it('exposes exactly the build-time API, the run-time converter, the docs types, the Vite plugin and the virtual-module types', () => {
		expect(Object.keys(pkg.exports)
			.sort())
			.toEqual(['.', './docs', './runtime', './virtual-widget-docs', './virtual-widget-docs-slim', './vite'])
		expect(JSON.stringify(pkg.exports)).not.toContain('./src/')
		for (const [subpath, file] of [['.', 'index'], ['./docs', 'docs'], ['./runtime', 'runtime'], ['./vite', 'vite']] as const) {
			expect(pkg.exports[subpath])
				.toEqual({ types: `./dist/${file}.d.mts`, import: `./dist/${file}.mjs` })
		}
		for (const target of Object.values(pkg.exports)
			.flatMap(entry => Object.values(entry))) {
			expect(existsSync(join(packageRoot, target)), target)
				.toBe(true)
		}
	})

	it('declares the bin, Core as a peer, vite as an optional peer, and typescript and tsx as dependencies', () => {
		expect(pkg.bin)
			.toEqual({ 'widget-docs-generator': './dist/cli.mjs' })
		expect(readFileSync(join(packageRoot, pkg.bin['widget-docs-generator']!), 'utf8')
			.startsWith('#!/usr/bin/env node\n'))
			.toBe(true)
		expect(pkg.peerDependencies['@deviltea/widget-core'])
			.toBe('workspace:^')
		expect(pkg.devDependencies['@deviltea/widget-core'])
			.toBe('workspace:*')
		// The majors whose plugin API `widgetDocs` uses (Vite 6 added `server.environments`, which `watchChange` reads).
		expect(pkg.peerDependencies.vite)
			.toBe('^6.0.0 || ^7.0.0 || ^8.0.0')
		expect(pkg.peerDependenciesMeta?.vite?.optional)
			.toBe(true)
		expect(Object.keys(pkg.dependencies)
			.sort())
			.toEqual(['tsx', 'typescript'])
		expect(pkg.engines?.node)
			.toBe('>=22.14.0')
	})

	it('is published at the version of the other released packages, with no side effects', () => {
		expect(pkg.private)
			.toBeUndefined()
		expect(pkg.publishConfig)
			.toEqual({ access: 'public' })
		for (const sibling of ['core', 'inspector', 'vue']) {
			const manifest = JSON.parse(readFileSync(join(packageRoot, '..', sibling, 'package.json'), 'utf8')) as PackageJson
			expect(pkg.version, sibling)
				.toBe(manifest.version)
		}
		expect(pkg.sideEffects)
			.toBe(false)
	})

	it('packs the build and the virtual-module declarations, never the sources, tests, fixtures or examples', () => {
		// Sorted: the repository's lint sorts the manifest's `files`.
		expect([...pkg.files].sort())
			.toEqual(['dist', 'virtual-widget-docs-slim.d.ts', 'virtual-widget-docs.d.ts'])
		// A real `pnpm pack`, as the release and CI make it, read back from the tarball: `pnpm pack --dry-run` and its
		// `--json` list leave out the repository's LICENSE, which pnpm adds to the tarball.
		const destination = mkdtempSync(join(tmpdir(), 'widget-docs-pack-'))
		let packed: string[]
		try {
			const pack = spawnSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot, encoding: 'utf8', timeout: CHILD_TIMEOUT })
			expect(pack.status, pack.stderr)
				.toBe(0)
			const tarball = readdirSync(destination)
				.filter(name => name.endsWith('.tgz'))
			expect(tarball)
				.toHaveLength(1)
			const list = spawnSync('tar', ['-tzf', join(destination, tarball[0]!)], { encoding: 'utf8', timeout: CHILD_TIMEOUT })
			expect(list.status, list.stderr)
				.toBe(0)
			packed = list.stdout.split('\n')
				.filter(line => line !== '')
				.map(line => line.replace(/^package\//, ''))
		}
		finally {
			rmSync(destination, { recursive: true, force: true })
		}
		expect(packed.filter(path => !path.startsWith('dist/'))
			.sort())
			.toEqual(['LICENSE', 'README.md', 'package.json', 'virtual-widget-docs-slim.d.ts', 'virtual-widget-docs.d.ts'])
		expect(packed.filter(path => /\.unit\.test\.|(?:^|\/)(?:fixtures|examples|src)\//.test(path)))
			.toEqual([])
		// Every file a subpath or the bin names is in the tarball, and so is the worker the bin starts by URL.
		const targets = [...Object.values(pkg.exports)
			.flatMap(entry => Object.values(entry)), ...Object.values(pkg.bin)].map(target => target.replace(/^\.\//, ''))
		expect(packed)
			.toEqual(expect.arrayContaining([...targets, 'dist/runtime-worker.mjs', 'dist/runtime-facts.mjs']))
	}, TEST_TIMEOUT)

	it('never bundles Core', () => {
		for (const file of readdirSync(dist)
			.filter(name => name.endsWith('.mjs'))) {
			const code = readFileSync(join(dist, file), 'utf8')
			// The definition of Core's builder entry would be in the bundle if Core were inlined.
			expect(code, file).not.toMatch(/function createWidgetPlugin\b/)
		}
	})
})

/** The import specifiers of an ES module (static, side-effect and dynamic imports, re-exports). */
function specifiersOf(file: string): string[] {
	const code = readFileSync(file, 'utf8')
	return [...code.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
		.map(match => match[1] ?? match[2] ?? match[3]!)
}

/** Every module an entry of `dist` reaches, and the external specifiers (bare or `node:`) they import. */
function chunkGraph(entry: string): { files: string[], external: string[] } {
	const files = new Set<string>()
	const external = new Set<string>()
	const visit = (file: string): void => {
		if (files.has(file))
			return
		files.add(file)
		for (const specifier of specifiersOf(file)) {
			if (specifier.startsWith('./') || specifier.startsWith('../'))
				visit(resolve(dirname(file), specifier))
			else
				external.add(specifier)
		}
	}
	visit(join(dist, entry))
	return { files: [...files].map(file => file.slice(dist.length + 1))
		.sort(), external: [...external].sort() }
}

describe('the ./runtime subpath', () => {
	it('reaches no external module: no typescript, no tsx, no node: builtin, nothing build-time', () => {
		const graph = chunkGraph('runtime.mjs')
		expect(graph.external)
			.toEqual([])
		expect(graph.files.some(file => /docs-cache|validate|runtime-facts/.test(file)))
			.toBe(false)
		// The walk does see externals: the build-time entry reaches TypeScript and the worker threads.
		expect(chunkGraph('index.mjs').external)
			.toEqual(expect.arrayContaining(['typescript', 'node:worker_threads']))
	})

	it('converts between the tree and the flat form with the committed IR, in plain Node', () => {
		const output = runNode(`
			import { readFileSync } from 'node:fs'
			import { createFlatConverter, FlatConversionError } from ${JSON.stringify(pathToFileURL(join(dist, 'runtime.mjs')).href)}
			const ir = JSON.parse(readFileSync('examples/survey/ir.json', 'utf8'))
			const tree = JSON.parse(readFileSync('fixtures/survey-example.json', 'utf8'))
			const { treeToFlat, flatToTree } = createFlatConverter(ir)
			const flat = treeToFlat(tree)
			let thrown = false
			try { flatToTree({ nodes: [] }) } catch (error) { thrown = error instanceof FlatConversionError }
			console.log(JSON.stringify({ nodes: flat.nodes.length, roundTrip: JSON.stringify(flatToTree(flat)) === JSON.stringify(tree), thrown }))
		`)
		expect(JSON.parse(output))
			.toEqual({ nodes: expect.any(Number), roundTrip: true, thrown: true })
		expect((JSON.parse(output) as { nodes: number }).nodes)
			.toBeGreaterThan(1)
	}, TEST_TIMEOUT)
})

describe('the run-time worker from dist', () => {
	it('reads the System through tsx and the built runtime-facts, with no loader in the parent process', () => {
		const output = runNode(`
			import { importRuntimeFacts } from ${JSON.stringify(pathToFileURL(join(dist, 'index.mjs')).href)}
			const facts = await importRuntimeFacts(${JSON.stringify(fixture)}, 'surveySystem', { tsconfig: ${JSON.stringify(tsconfig)} })
			const rating = facts.plugins.find(plugin => plugin.type === 'Rating')
			console.log(JSON.stringify({ types: facts.plugins.map(plugin => plugin.type), state: rating.state, described: typeof rating.docs?.description }))
		`)
		expect(JSON.parse(output))
			.toEqual({ types: ['Survey', 'Rating', 'Choice', 'Note'], state: [{ name: 'value', authorWritable: true }], described: 'string' })
	}, TEST_TIMEOUT)
})

describe('the docs cache from dist', () => {
	// Copies of `dist` under this package's `node_modules`, so their bare imports (typescript, tsx) still resolve.
	const copies = join(packageRoot, 'node_modules/.cache/docs-generator-dist-test')
	let scratch: string
	beforeAll(() => {
		mkdirSync(copies, { recursive: true })
		scratch = mkdtempSync(join(copies, 'run-'))
	})
	afterAll(() => rmSync(scratch, { recursive: true, force: true }))

	it('hashes the built generator: an identical copy hits the cache, a changed chunk misses it', () => {
		const same = join(scratch, 'same')
		const changed = join(scratch, 'changed')
		cpSync(dist, same, { recursive: true })
		cpSync(dist, changed, { recursive: true })
		const chunk = readdirSync(changed)
			.find(name => name.startsWith('flat-') && name.endsWith('.mjs'))!
		appendFileSync(join(changed, chunk), '\n// a change to the generator\n')

		// One process and one cache directory (no runtime import): each copy is its own module graph, so each computes
		// its own generator hash; the identical copy is then a hit, which builds no program.
		const output = runNode(`
			const results = []
			for (const entry of ${JSON.stringify([dist, same, changed].map(directory => pathToFileURL(join(directory, 'index.mjs')).href))}) {
				const { createDocsCache } = await import(entry)
				const cache = createDocsCache({ cacheDir: ${JSON.stringify(join(scratch, 'cache'))}, root: ${JSON.stringify(packageRoot)}, runtime: false })
				const { key, hit } = await cache.load('survey', { module: ${JSON.stringify(fixture)}, export: 'surveySystem', tsconfig: ${JSON.stringify(tsconfig)} })
				results.push({ key, hit })
			}
			console.log(JSON.stringify(results))
		`, { timeout: 90_000 })
		const [original, copy, edited] = JSON.parse(output) as { key: string, hit: boolean }[]
		expect(original)
			.toEqual({ key: expect.stringMatching(/^[0-9a-f]{64}$/), hit: false })
		expect(copy)
			.toEqual({ key: original!.key, hit: true })
		expect(edited!.hit)
			.toBe(false)
		expect(edited!.key).not.toBe(original!.key)
	}, 120_000)
})

describe('the bin', () => {
	it('prints its usage under its own name without the required options', () => {
		const result = runBin([])
		expect(result.status)
			.toBe(2)
		expect(result.stderr)
			.toMatch(/^Usage: widget-docs-generator --module <path> --export <name> /)
	}, TEST_TIMEOUT)

	it('checks a System that only tsx can load, resolving Core through --source-tsconfig paths alone', () => {
		// In the OS temporary directory: no `node_modules` resolves Core, only the source tsconfig's `paths` (to Core's
		// sources, whose extensionless imports need tsx as well), and the module imports a sibling without an extension. A plain
		// in-process import loads neither; the worker's tsx does.
		const directory = mkdtempSync(join(tmpdir(), 'widget-docs-bin-system-'))
		try {
			const coreSource = resolve(packageRoot, '../core/src')
			writeFileSync(join(directory, 'package.json'), '{ "type": "module" }\n')
			writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'esnext', skipLibCheck: true, types: [] }, include: ['./*.ts'] }))
			writeFileSync(join(directory, 'tsconfig.source.json'), JSON.stringify({ compilerOptions: { paths: {
				'@deviltea/widget-core': [join(coreSource, 'index.ts')],
				'@deviltea/widget-core/inspection': [join(coreSource, 'inspection/index.ts')],
			} } }))
			writeFileSync(join(directory, 'badge.ts'), [
				'import { createWidgetPlugin } from \'@deviltea/widget-core\'',
				'interface BadgeInterfaces { state: { count: number } }',
				'export const Badge = createWidgetPlugin(\'Badge\')',
				'\t.description(\'A badge.\')',
				'\t.interfaces<BadgeInterfaces>()',
				'\t.state(state => state.count({ description: \'The count.\', validate: (input): input is number => typeof input === \'number\', default: () => 0, authorWritable: true }))',
				'\t.done()',
				'',
			].join('\n'))
			writeFileSync(join(directory, 'system.ts'), 'import { createWidgetSystem } from \'@deviltea/widget-core\'\nimport { Badge } from \'./badge\'\n\nexport const system = createWidgetSystem({ plugins: [Badge] as const })\n')
			const result = runBin(['--check', '--module', join(directory, 'system.ts'), '--export', 'system', '--tsconfig', join(directory, 'tsconfig.json'), '--source-tsconfig', join(directory, 'tsconfig.source.json')], directory)
			expect(result.stderr)
				.toBe('')
			expect(result.stdout)
				.toBe('2/2 descriptions documented, 0 error(s), 0 warning(s).\n')
			expect(result.status)
				.toBe(0)
		}
		finally {
			rmSync(directory, { recursive: true, force: true })
		}
	}, TEST_TIMEOUT)

	it('writes the committed example output byte for byte from the fixture System, with the example compiled in its worker', () => {
		// The `generate:example` run. It also checks the fixture (`check:example` runs the same extraction and `checkIr`;
		// the `--check` output path is the test above).
		const out = mkdtempSync(join(tmpdir(), 'widget-docs-bin-'))
		try {
			const result = runBin(['--module', './fixtures/survey-system.ts', '--export', 'surveySystem', '--tsconfig', './tsconfig.json', '--root', '../..', '--example', './fixtures/survey-example.json', '--out', out])
			expect(result.stderr)
				.toBe('')
			expect(result.status)
				.toBe(0)
			expect(result.stdout)
				.toMatch(/\n69\/69 descriptions documented; --check would report 0 error\(s\) and 0 warning\(s\)\.\n$/)
			const committed = join(packageRoot, 'examples/survey')
			const manifest = JSON.parse(readFileSync(join(out, '.generated.json'), 'utf8')) as { files: string[] }
			for (const path of [...manifest.files, '.generated.json']) {
				expect(readFileSync(join(out, path), 'utf8'), path)
					.toBe(readFileSync(join(committed, path), 'utf8'))
			}
		}
		finally {
			rmSync(out, { recursive: true, force: true })
		}
	}, TEST_TIMEOUT)

	it('refuses an example that does not compile', () => {
		const out = mkdtempSync(join(tmpdir(), 'widget-docs-bin-'))
		try {
			const broken = join(out, 'broken.json')
			const example = JSON.parse(readFileSync(join(packageRoot, 'fixtures/survey-example.json'), 'utf8')) as Record<string, unknown>
			writeFileSync(broken, JSON.stringify({ ...example, type: 'Missing' }))
			const result = runBin(['--module', fixture, '--export', 'surveySystem', '--tsconfig', tsconfig, '--example', broken, '--out', join(out, 'out')])
			expect(result.status)
				.toBe(1)
			expect(result.stderr)
				.toContain(`The example ${broken} is not a valid document:`)
			expect(existsSync(join(out, 'out')))
				.toBe(false)
		}
		finally {
			rmSync(out, { recursive: true, force: true })
		}
	}, TEST_TIMEOUT)
})
