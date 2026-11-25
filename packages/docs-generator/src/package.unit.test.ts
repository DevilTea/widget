/**
 * The built package (`dist`), as Node loads it: its subpaths, the bin, the run-time worker, the docs cache's generator
 * hash and the `./runtime` chunk graph. Every test runs the built files in a plain `node` child process (no TypeScript
 * loader, no Vite transform). Run `pnpm build` (or `pnpm --filter @deviltea/widget-docs-generator... build`) first.
 */

import { execFileSync, spawnSync } from 'node:child_process'
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
 * Runs an ES module script with plain `node` in `cwd` and returns its standard output. The script is a file, not
 * `--eval`: a worker thread inherits the process's `execArgv`, and `--input-type` is not allowed there.
 */
function runNode(script: string, cwd: string = packageRoot): string {
	const file = join(scripts, `script-${String(scriptCount++)}.mjs`)
	writeFileSync(file, script)
	return execFileSync(process.execPath, [file], { cwd, encoding: 'utf8' })
}

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
		expect(pkg.peerDependencies.vite)
			.toBeDefined()
		expect(pkg.peerDependenciesMeta?.vite?.optional)
			.toBe(true)
		expect(Object.keys(pkg.dependencies)
			.sort())
			.toEqual(['tsx', 'typescript'])
		expect(pkg.engines?.node)
			.toBe('>=22.14.0')
	})

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
	})
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
	}, 60_000)
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

	/** The cache key of the fixture System, generated (no disk cache, no runtime) by the `dist` in `directory`. */
	function keyFrom(directory: string): string {
		return runNode(`
			import { createDocsCache } from ${JSON.stringify(pathToFileURL(join(directory, 'index.mjs')).href)}
			const cache = createDocsCache({ cacheDir: null, root: ${JSON.stringify(packageRoot)}, runtime: false })
			const result = await cache.load('survey', { module: ${JSON.stringify(fixture)}, export: 'surveySystem', tsconfig: ${JSON.stringify(tsconfig)} })
			console.log(result.key)
		`)
			.trim()
	}

	it('hashes the built generator: an identical copy keeps the key, a changed chunk changes it', () => {
		const same = join(scratch, 'same')
		const changed = join(scratch, 'changed')
		cpSync(dist, same, { recursive: true })
		cpSync(dist, changed, { recursive: true })
		const chunk = readdirSync(changed)
			.find(name => name.startsWith('flat-') && name.endsWith('.mjs'))!
		appendFileSync(join(changed, chunk), '\n// a change to the generator\n')

		const original = keyFrom(dist)
		expect(original)
			.toMatch(/^[0-9a-f]{64}$/)
		expect(keyFrom(same))
			.toBe(original)
		expect(keyFrom(changed)).not.toBe(original)
	}, 120_000)
})

describe('the bin', () => {
	it('prints its usage under its own name without the required options', () => {
		const result = spawnSync(process.execPath, [join(dist, 'cli.mjs')], { cwd: packageRoot, encoding: 'utf8' })
		expect(result.status)
			.toBe(2)
		expect(result.stderr)
			.toMatch(/^Usage: widget-docs-generator --module <path> --export <name> /)
	})

	it('imports a System that only tsx can load, resolving Core through --source-tsconfig paths alone', () => {
		// In the OS temporary directory: no `node_modules` resolves Core, only the source tsconfig's `paths` (to Core's
		// sources, whose extensionless imports Node cannot load either), and the module imports a sibling without an
		// extension. Node's own type stripping loads neither; the worker's tsx does.
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
			const result = spawnSync(process.execPath, [join(dist, 'cli.mjs'), '--check', '--module', join(directory, 'system.ts'), '--export', 'system', '--tsconfig', join(directory, 'tsconfig.json'), '--source-tsconfig', join(directory, 'tsconfig.source.json')], { cwd: directory, encoding: 'utf8' })
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
	}, 120_000)

	it('checks the fixture System with plain node', () => {
		const result = spawnSync(process.execPath, [join(dist, 'cli.mjs'), '--check', '--module', fixture, '--export', 'surveySystem', '--tsconfig', tsconfig], { cwd: packageRoot, encoding: 'utf8' })
		expect(result.stderr)
			.toBe('')
		expect(result.stdout)
			.toBe('69/69 descriptions documented, 0 error(s), 0 warning(s).\n')
		expect(result.status)
			.toBe(0)
	}, 60_000)

	it('writes the committed example output byte for byte, with the example compiled in its worker', () => {
		const out = mkdtempSync(join(tmpdir(), 'widget-docs-bin-'))
		try {
			const result = spawnSync(process.execPath, [join(dist, 'cli.mjs'), '--module', './fixtures/survey-system.ts', '--export', 'surveySystem', '--tsconfig', './tsconfig.json', '--root', '../..', '--example', './fixtures/survey-example.json', '--out', out], { cwd: packageRoot, encoding: 'utf8' })
			expect(result.stderr)
				.toBe('')
			expect(result.status)
				.toBe(0)
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
	}, 120_000)

	it('refuses an example that does not compile', () => {
		const out = mkdtempSync(join(tmpdir(), 'widget-docs-bin-'))
		try {
			const broken = join(out, 'broken.json')
			const example = JSON.parse(readFileSync(join(packageRoot, 'fixtures/survey-example.json'), 'utf8')) as Record<string, unknown>
			appendFileSync(broken, JSON.stringify({ ...example, type: 'Missing' }))
			const result = spawnSync(process.execPath, [join(dist, 'cli.mjs'), '--module', fixture, '--export', 'surveySystem', '--tsconfig', tsconfig, '--example', broken, '--out', join(out, 'out')], { cwd: packageRoot, encoding: 'utf8' })
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
	}, 60_000)
})
