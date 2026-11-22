import type { HmrContext, Plugin, ViteDevServer } from 'vite'
import type { DocsSystem, RuntimeFacts, WidgetDocs, WidgetDocsSlim } from './index'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { inspectPlugin } from '@deviltea/widget-core/inspection'
import ts from 'typescript'
import docsFromVitest from 'virtual:widget-docs/survey'
import { build, createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { surveySystem } from '../fixtures/survey-system'
import { generatorHashOf, getGeneratorHash } from './docs-cache'
import { collectRuntimeFacts, createDocsCache, emitDocs, extractIr, slimDocs } from './index'
import { widgetDocs } from './vite'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repositoryRoot = resolve(packageRoot, '../..')
const tsconfig = resolve(packageRoot, 'tsconfig.json')
const survey: DocsSystem = { module: resolve(packageRoot, 'fixtures/survey-system.ts'), export: 'surveySystem', tsconfig }
const surveyFacts = (): Promise<RuntimeFacts> => Promise.resolve(collectRuntimeFacts(surveySystem, inspectPlugin as never))

const scratch = mkdtempSync(join(tmpdir(), 'widget-docs-test-'))

let expected: WidgetDocs

beforeAll(() => {
	expected = emitDocs(extractIr({ modulePath: survey.module, exportName: survey.export, tsconfigPath: tsconfig, runtime: collectRuntimeFacts(surveySystem, inspectPlugin as never), cwd: repositoryRoot }))
}, 120_000)
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A `createProgram` that counts the programs it builds. */
function countingFactory(): { createProgram: (options: ts.CreateProgramOptions) => ts.Program, count: () => number } {
	let programs = 0
	return {
		createProgram: (options) => {
			programs++
			return ts.createProgram(options)
		},
		count: () => programs,
	}
}

/**
 * A small System in its own directory, so its files can be edited: `system.ts` imports `labels.ts`; `unrelated.ts`
 * is imported by nothing. Core's types come from the built package through `paths`.
 */
function writableSystem(): { directory: string, system: DocsSystem } {
	const directory = mkdtempSync(join(scratch, 'system-'))
	writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
		compilerOptions: {
			strict: true,
			module: 'esnext',
			moduleResolution: 'bundler',
			target: 'esnext',
			skipLibCheck: true,
			types: [],
			paths: { '@deviltea/widget-core': [resolve(repositoryRoot, 'packages/core/dist/index.d.mts')] },
		},
	}))
	writeFileSync(join(directory, 'labels.ts'), '/** A label. */\nexport interface Label {\n\t/** The text. */\n\ttext: string\n}\n')
	writeFileSync(join(directory, 'unrelated.ts'), 'export const unrelated = 1\n')
	writeFileSync(join(directory, 'system.ts'), [
		'import type { WidgetPlugin, WidgetSystem } from \'@deviltea/widget-core\'',
		'import type { Label } from \'./labels\'',
		'/** A badge. */',
		'interface BadgeInterfaces {',
		'\t/** The badge config. */',
		'\tconfig: { raw: Label, resolved: Label }',
		'}',
		'export declare const system: WidgetSystem<readonly [WidgetPlugin<\'Badge\', BadgeInterfaces>]>',
		'',
	].join('\n'))
	return { directory, system: { module: join(directory, 'system.ts'), export: 'system', tsconfig: join(directory, 'tsconfig.json') } }
}

describe('createDocsCache', () => {
	it('on a hit builds no TypeScript program, imports nothing and returns identical output', async () => {
		const cacheDir = mkdtempSync(join(scratch, 'cache-'))
		const factory = countingFactory()
		let imports = 0
		const loadRuntime = async (): Promise<RuntimeFacts> => {
			imports++
			return surveyFacts()
		}
		const cold = await createDocsCache({ cacheDir, root: repositoryRoot, createProgram: factory.createProgram, loadRuntime })
			.load('survey', survey)
		expect(cold)
			.toMatchObject({ hit: false, check: { ok: true } })
		expect(cold.docs)
			.toStrictEqual(expected)
		expect([factory.count(), imports])
			.toEqual([1, 1])
		// A new cache object, as a new process would create.
		const warm = await createDocsCache({ cacheDir, root: repositoryRoot, createProgram: factory.createProgram, loadRuntime })
			.load('survey', survey)
		expect(warm)
			.toMatchObject({ hit: true, key: cold.key, files: cold.files, missing: [] })
		// The check result is stored with the docs.
		expect(warm.check)
			.toStrictEqual(cold.check)
		expect(warm.docs)
			.toStrictEqual(cold.docs)
		expect([factory.count(), imports])
			.toEqual([1, 1])
		// The inputs are the program's sources outside node_modules, the built Core declarations and the tsconfig.
		expect(cold.files)
			.toContain(survey.module)
		expect(cold.files)
			.toContain(tsconfig)
		expect(cold.files.some(file => file.endsWith('packages/core/dist/index.d.mts')))
			.toBe(true)
		expect(cold.files.some(file => file.includes('/node_modules/')))
			.toBe(false)
		expect(readdirSync(cacheDir)
			.sort())
			.toEqual([`${cold.key}.json`, 'survey.manifest.json'].sort())
	}, 120_000)

	it('regenerates when a file of the program changes, and not for an unrelated file', async () => {
		const cacheDir = mkdtempSync(join(scratch, 'cache-'))
		const { directory, system } = writableSystem()
		const factory = countingFactory()
		const cache = () => createDocsCache({ cacheDir, root: directory, runtime: false, createProgram: factory.createProgram })
		const first = await cache()
			.load('badge', system)
		expect(first.docs.plugins.Badge!.config!.schema)
			.toMatchObject({ $defs: { type_Label: { properties: { text: { description: 'The text.' } } } } })
		// The System's own files and Core's built declarations; not the file nothing imports.
		expect(first.files.filter(file => file.startsWith(directory)))
			.toEqual([join(directory, 'labels.ts'), join(directory, 'system.ts'), join(directory, 'tsconfig.json')])
		// Core's declarations, the JavaScript next to them and Core's package.json.
		const core = first.files.filter(file => !file.startsWith(directory))
		expect(core.every(file => file.startsWith(resolve(repositoryRoot, 'packages/core/dist/')) || file === resolve(repositoryRoot, 'packages/core/package.json')))
			.toBe(true)
		expect(core)
			.toContain(resolve(repositoryRoot, 'packages/core/dist/index.mjs'))
		expect(core)
			.toContain(resolve(repositoryRoot, 'packages/core/package.json'))

		writeFileSync(join(directory, 'unrelated.ts'), 'export const unrelated = 2\n')
		const unrelated = await cache()
			.load('badge', system)
		expect([unrelated.hit, unrelated.key, factory.count()])
			.toEqual([true, first.key, 1])

		writeFileSync(join(directory, 'labels.ts'), '/** A label. */\nexport interface Label {\n\t/** The text shown. */\n\ttext: string\n}\n')
		const changed = await cache()
			.load('badge', system)
		expect(changed.hit)
			.toBe(false)
		expect(changed.key).not.toBe(first.key)
		expect(factory.count())
			.toBe(2)
		expect(changed.docs.plugins.Badge!.config!.schema)
			.toMatchObject({ $defs: { type_Label: { properties: { text: { description: 'The text shown.' } } } } })
		// The superseded entry is removed with the manifest that pointed at it.
		expect(readdirSync(cacheDir)
			.sort())
			.toEqual([`${changed.key}.json`, 'badge.manifest.json'].sort())

		// A changed tsconfig is an input too.
		writeFileSync(system.tsconfig!, readFileSync(system.tsconfig!, 'utf8')
			.replace('"strict":true', '"strict":true,"noImplicitOverride":true'))
		expect((await cache()
			.load('badge', system)).hit)
			.toBe(false)
		expect(factory.count())
			.toBe(3)
	}, 120_000)

	it('regenerates over a corrupt or mismatching entry or manifest', async () => {
		const cacheDir = mkdtempSync(join(scratch, 'cache-'))
		const { system } = writableSystem()
		const factory = countingFactory()
		const load = () => createDocsCache({ cacheDir, root: scratch, runtime: false, createProgram: factory.createProgram })
			.load('badge', system)
		const first = await load()
		const entry = join(cacheDir, `${first.key}.json`)
		const manifest = join(cacheDir, 'badge.manifest.json')

		writeFileSync(entry, '{ not json')
		const afterCorruptEntry = await load()
		expect([afterCorruptEntry.hit, factory.count()])
			.toEqual([false, 2])
		expect(afterCorruptEntry.docs)
			.toStrictEqual(first.docs)
		expect(JSON.parse(readFileSync(entry, 'utf8')))
			.toEqual({ key: first.key, docs: first.docs, check: first.check })

		writeFileSync(entry, JSON.stringify({ key: 'another', docs: first.docs }))
		expect((await load()).hit)
			.toBe(false)

		writeFileSync(manifest, '')
		expect((await load()).hit)
			.toBe(false)

		writeFileSync(manifest, JSON.stringify({ key: first.key, fixed: 'stale', files: [] }))
		expect((await load()).hit)
			.toBe(false)

		const listed = JSON.parse(readFileSync(manifest, 'utf8')) as { files: string[] }
		writeFileSync(manifest, JSON.stringify({ ...listed, files: [...listed.files, join(scratch, 'gone.ts')] }))
		expect((await load()).hit)
			.toBe(false)
		expect(factory.count())
			.toBe(6)
		// Each regeneration rewrote both files: the next load hits again.
		expect((await load()).hit)
			.toBe(true)
		expect(factory.count())
			.toBe(6)
	}, 120_000)

	it('does not cache a program with an unresolved relative import, and caches it once the file exists', async () => {
		const cacheDir = mkdtempSync(join(scratch, 'cache-'))
		const { directory, system } = writableSystem()
		writeFileSync(system.module, `${readFileSync(system.module, 'utf8')}export type { Later } from './later'\n`)
		const factory = countingFactory()
		const load = () => createDocsCache({ cacheDir, root: directory, runtime: false, createProgram: factory.createProgram })
			.load('badge', system)
		const unresolved = await load()
		expect(unresolved.missing)
			.toContain(join(directory, 'later.ts'))
		expect(unresolved.missing.some(file => file.includes('/node_modules/')))
			.toBe(false)
		expect(readdirSync(cacheDir))
			.toEqual([])
		expect([(await load()).hit, factory.count()])
			.toEqual([false, 2])

		writeFileSync(join(directory, 'later.ts'), 'export interface Later { at: number }\n')
		const resolved = await load()
		expect([resolved.hit, resolved.missing])
			.toEqual([false, []])
		expect(resolved.files)
			.toContain(join(directory, 'later.ts'))
		expect([(await load()).hit, factory.count()])
			.toEqual([true, 3])
	}, 120_000)

	it('misses when the installed state, the JavaScript next to a declaration file or a package.json changes', async () => {
		const cacheDir = mkdtempSync(join(scratch, 'cache-'))
		const { directory, system } = writableSystem()
		mkdirSync(join(directory, 'node_modules/.pnpm'), { recursive: true })
		writeFileSync(join(directory, 'node_modules/.pnpm/lock.yaml'), 'lockfileVersion: 1\n')
		writeFileSync(join(directory, 'package.json'), '{ "name": "badge", "type": "module" }\n')
		mkdirSync(join(directory, 'lib'))
		writeFileSync(join(directory, 'lib/size.d.mts'), 'export type Size = number\n')
		writeFileSync(join(directory, 'lib/size.mjs'), 'export {}\n')
		writeFileSync(system.module, `${readFileSync(system.module, 'utf8')}export type { Size } from './lib/size.mjs'\n`)
		const factory = countingFactory()
		const load = () => createDocsCache({ cacheDir, root: directory, runtime: false, createProgram: factory.createProgram })
			.load('badge', system)
		const first = await load()
		expect(first.files)
			.toEqual(expect.arrayContaining([join(directory, 'lib/size.d.mts'), join(directory, 'lib/size.mjs'), join(directory, 'package.json')]))
		const hits: boolean[] = [(await load()).hit]

		writeFileSync(join(directory, 'node_modules/.pnpm/lock.yaml'), 'lockfileVersion: 2\n')
		hits.push((await load()).hit, (await load()).hit)
		writeFileSync(join(directory, 'lib/size.mjs'), 'export const size = 1\n')
		hits.push((await load()).hit, (await load()).hit)
		writeFileSync(join(directory, 'package.json'), '{ "name": "badge", "type": "commonjs" }\n')
		hits.push((await load()).hit)
		expect(hits)
			.toEqual([true, false, true, false, true, false])
		expect(factory.count())
			.toBe(4)
	}, 120_000)

	it('reports the stored documentation problems on a hit', async () => {
		const cacheDir = mkdtempSync(join(scratch, 'cache-'))
		const counter: DocsSystem = { module: resolve(here, 'fixtures/undocumented-system.ts'), export: 'undocumentedSystem', tsconfig }
		const load = () => createDocsCache({ cacheDir, root: repositoryRoot, runtime: false })
			.load('counter', counter)
		const cold = await load()
		expect(cold.check.ok)
			.toBe(false)
		const warm = await load()
		expect(warm.hit)
			.toBe(true)
		expect(warm.check)
			.toStrictEqual(cold.check)
		expect(warm.check.problems.map(problem => problem.where))
			.toContain('Counter.state.step')
	}, 120_000)

	it('returns the docs and warns once when the cache cannot be written', async () => {
		const { system } = writableSystem()
		// A regular file where the cache directory's parent should be: every write fails with ENOTDIR.
		const blocker = join(mkdtempSync(join(scratch, 'blocked-')), 'file')
		writeFileSync(blocker, '')
		const warnings: string[] = []
		const factory = countingFactory()
		const cache = createDocsCache({ cacheDir: join(blocker, 'cache'), root: scratch, runtime: false, createProgram: factory.createProgram, warn: message => warnings.push(message) })
		const first = await cache.load('badge', system)
		const second = await cache.load('badge', system)
		expect([first.hit, second.hit, factory.count()])
			.toEqual([false, false, 2])
		expect(second.docs)
			.toStrictEqual(first.docs)
		expect(first.docs.plugins.Badge!.summary)
			.toBe('A badge.')
		expect(warnings)
			.toHaveLength(1)
		expect(warnings[0])
			.toMatch(/cannot write the cache in .*\(ENOTDIR\)/)
	}, 120_000)

	it.skipIf(process.getuid?.() === 0)('returns the docs when the cache directory is read-only (EACCES)', async () => {
		const { system } = writableSystem()
		const cacheDir = mkdtempSync(join(scratch, 'read-only-'))
		chmodSync(cacheDir, 0o555)
		const warnings: string[] = []
		try {
			const result = await createDocsCache({ cacheDir, root: scratch, runtime: false, warn: message => warnings.push(message) })
				.load('badge', system)
			expect(result.docs.plugins.Badge!.summary)
				.toBe('A badge.')
			expect(warnings)
				.toEqual([expect.stringContaining('(EACCES)')])
			expect(readdirSync(cacheDir))
				.toEqual([])
		}
		finally {
			chmodSync(cacheDir, 0o755)
		}
	}, 120_000)

	it('reads and writes nothing with WIDGET_DOCS_CACHE=off', async () => {
		const { system } = writableSystem()
		const populated = mkdtempSync(join(scratch, 'cache-'))
		const factory = countingFactory()
		const load = (cacheDir: string) => createDocsCache({ cacheDir, root: scratch, runtime: false, createProgram: factory.createProgram })
			.load('badge', system)
		await load(populated)
		expect((await load(populated)).hit)
			.toBe(true)
		vi.stubEnv('WIDGET_DOCS_CACHE', 'off')
		try {
			// A valid entry is not read...
			expect((await load(populated)).hit)
				.toBe(false)
			// ...and nothing is written.
			const empty = mkdtempSync(join(scratch, 'cache-'))
			expect((await load(empty)).hit)
				.toBe(false)
			expect(readdirSync(empty))
				.toEqual([])
			expect(factory.count())
				.toBe(3)
		}
		finally {
			vi.unstubAllEnvs()
		}
	}, 120_000)

	it('refuses a System whose types and runtime disagree, and a name that is not a file name', async () => {
		const loadRuntime = async (): Promise<RuntimeFacts> => {
			const facts = await surveyFacts()
			facts.plugins[1]!.state = []
			return facts
		}
		const cache = createDocsCache({ cacheDir: null, root: repositoryRoot, loadRuntime })
		await expect(cache.load('survey', survey)).rejects.toThrow('Rating.state: declared in the types but not at runtime: value.')
		await expect(cache.load('../survey', survey)).rejects.toThrow('must match')
	}, 120_000)
})

describe('widgetDocs through Vite', () => {
	const systems = {
		survey: { module: 'fixtures/survey-system.ts', export: 'surveySystem', tsconfig: 'tsconfig.json' },
		counter: { module: 'src/fixtures/undocumented-system.ts', export: 'undocumentedSystem', tsconfig: 'tsconfig.json' },
	}
	let server: ViteDevServer
	let plugin: Plugin
	const warnings: string[] = []

	beforeAll(async () => {
		plugin = widgetDocs({ systems, cacheDir: mkdtempSync(join(scratch, 'cache-')) })
		server = await createServer({
			configFile: false,
			root: packageRoot,
			logLevel: 'silent',
			appType: 'custom',
			server: { middlewareMode: true, hmr: false },
			customLogger: { ...console, info: () => {}, warn: (message: string) => warnings.push(message), warnOnce: () => {}, error: () => {}, clearScreen: () => {}, hasErrorLogged: () => false, hasWarned: false },
			plugins: [plugin],
		})
	}, 60_000)
	afterAll(async () => server.close())

	it('resolves and loads a virtual module, importing the System for the cross-check', async () => {
		const module = await server.ssrLoadModule('virtual:widget-docs/survey') as { default: WidgetDocs }
		expect(module.default)
			.toStrictEqual(expected)
		// authorWritable comes from inspectPlugin, so the runtime was consulted.
		expect(module.default.plugins.Rating!.state!.value!.authorWritable)
			.toBe(true)
		await expect(server.ssrLoadModule('virtual:widget-docs/missing')).rejects.toThrow('no System "missing"')
	}, 120_000)

	it('adds the inputs to the watcher and invalidates only the modules that read a changed file', async () => {
		await server.ssrLoadModule('virtual:widget-docs/survey')
		await server.ssrLoadModule('virtual:widget-docs/counter')
		const watched = Object.entries(server.watcher.getWatched())
			.flatMap(([directory, names]) => names.map(name => join(directory, name)))
		expect(watched)
			.toContain(resolve(packageRoot, 'fixtures/survey-system.ts'))
		expect(watched)
			.toContain(resolve(repositoryRoot, 'packages/core/dist/index.d.mts'))

		const graph = server.moduleGraph
		const node = (name: string) => graph.getModuleById(`\0virtual:widget-docs/${name}`)!
		const hotUpdate = plugin.handleHotUpdate as (context: HmrContext) => ReturnType<NonNullable<Plugin['handleHotUpdate']> & ((...args: never[]) => unknown)>
		const update = (file: string) => hotUpdate.call({} as never, { file, timestamp: Date.now(), modules: [], read: async () => '', server } as HmrContext)
		const isLoaded = (name: string): boolean => node(name).ssrTransformResult !== null

		expect(await update(resolve(packageRoot, 'README.md')))
			.toBeUndefined()
		expect([isLoaded('survey'), isLoaded('counter')])
			.toEqual([true, true])

		expect(await update(resolve(packageRoot, 'fixtures/survey-system.ts')))
			.toEqual([node('survey')])
		expect([isLoaded('survey'), isLoaded('counter')])
			.toEqual([false, true])

		await server.ssrLoadModule('virtual:widget-docs/survey')
		expect(await update(resolve(here, 'fixtures/undocumented-system.ts')))
			.toEqual([node('counter')])
		expect([isLoaded('survey'), isLoaded('counter')])
			.toEqual([true, false])

		await server.ssrLoadModule('virtual:widget-docs/counter')
		expect(await update(resolve(repositoryRoot, 'packages/core/dist/index.d.mts')))
			.toEqual([node('survey'), node('counter')])
	}, 120_000)

	it('warns about documentation problems without failing the load', async () => {
		const module = await server.ssrLoadModule('virtual:widget-docs/counter') as { default: WidgetDocs }
		expect(module.default.plugins.Counter!.slots!.labelled)
			.toMatchObject({ expectedTypes: null, contract: '{ properties: { label: string; }; }' })
		expect(warnings.join('\n'))
			.toContain('Counter.state.step has no JSDoc.')
	}, 120_000)
})

describe('the generator hash', () => {
	it('changes with any generator source, and not with a test', () => {
		const directory = mkdtempSync(join(scratch, 'generator-'))
		writeFileSync(join(directory, 'schema.ts'), 'export const a = 1\n')
		writeFileSync(join(directory, 'runtime-worker.mjs'), 'export {}\n')
		writeFileSync(join(directory, 'schema.unit.test.ts'), '// a test\n')
		const first = generatorHashOf(directory)

		writeFileSync(join(directory, 'schema.unit.test.ts'), '// another test\n')
		expect(generatorHashOf(directory))
			.toBe(first)
		writeFileSync(join(directory, 'schema.ts'), 'export const a = 2\n')
		const edited = generatorHashOf(directory)
		expect(edited).not.toBe(first)
		writeFileSync(join(directory, 'runtime-worker.mjs'), 'export const b = 1\n')
		expect(generatorHashOf(directory)).not.toBe(edited)
		writeFileSync(join(directory, 'added.ts'), '')
		expect(generatorHashOf(directory)).not.toBe(generatorHashOf(join(directory, 'missing')))

		// The process-wide hash is the one of this package's own sources.
		expect(getGeneratorHash())
			.toBe(generatorHashOf(here))
	})
})

describe('widgetDocs in a dev server with its real watcher', () => {
	/** Loads `virtual:widget-docs/badge` until `accept` holds or the time runs out (the watcher reports asynchronously). */
	async function loadUntil(server: ViteDevServer, accept: (docs: WidgetDocs) => boolean): Promise<WidgetDocs> {
		const deadline = Date.now() + 20_000
		for (;;) {
			const { default: docs } = await server.ssrLoadModule('virtual:widget-docs/badge') as { default: WidgetDocs }
			if (accept(docs) || Date.now() > deadline)
				return docs
			await new Promise(resolveTimer => setTimeout(resolveTimer, 100))
		}
	}

	it('regenerates and serves the new docs after an edit and after a missing import is created, without HMR', async () => {
		const { directory, system } = writableSystem()
		writeFileSync(system.module, readFileSync(system.module, 'utf8')
			.replace('config: { raw: Label, resolved: Label }', 'config: { raw: Label, resolved: Label }\n\t/** The extra State. */\n\tstate: { extra: Extra }')
			.replace('import type { Label } from \'./labels\'', 'import type { Label } from \'./labels\'\nimport type { Extra } from \'./extra\''))
		const server = await createServer({
			configFile: false,
			root: directory,
			logLevel: 'silent',
			appType: 'custom',
			// HMR off: invalidation must not depend on `handleHotUpdate`.
			server: { middlewareMode: true, hmr: false, ws: false },
			plugins: [widgetDocs({ systems: { badge: { module: 'system.ts', export: 'system', tsconfig: 'tsconfig.json' } }, cacheDir: 'cache', runtime: false })],
		})
		try {
			const fieldsOf = (docs: WidgetDocs): string[] => Object.keys(docs.types)
				.sort()
			const initial = await loadUntil(server, () => true)
			expect(initial.types.Label!.fields!.text!.summary)
				.toBe('The text.')
			// `./extra` does not exist yet: the docs have no Extra type.
			expect(fieldsOf(initial))
				.toEqual(['Label'])

			writeFileSync(join(directory, 'labels.ts'), '/** A label. */\nexport interface Label {\n\t/** The text shown. */\n\ttext: string\n}\n')
			const edited = await loadUntil(server, docs => docs.types.Label!.fields!.text!.summary === 'The text shown.')
			expect(edited.types.Label!.fields!.text!.summary)
				.toBe('The text shown.')

			writeFileSync(join(directory, 'extra.ts'), '/** More. */\nexport interface Extra {\n\t/** A note. */\n\tnote?: string\n}\n')
			const created = await loadUntil(server, docs => 'Extra' in docs.types)
			expect(fieldsOf(created))
				.toEqual(['Extra', 'Label'])
			// Once every import resolves, the result is cached.
			expect(readdirSync(join(directory, 'cache')))
				.toContain('badge.manifest.json')
		}
		finally {
			await server.close()
		}
	}, 120_000)
})

describe('widgetDocs({ slim: true })', () => {
	it('serves the slim projection of the docs from the cache the full docs filled', async () => {
		const cacheDir = mkdtempSync(join(scratch, 'cache-'))
		const serve = async (slim: boolean, createProgram: (options: ts.CreateProgramOptions) => ts.Program): Promise<unknown> => {
			const server = await createServer({
				configFile: false,
				root: packageRoot,
				logLevel: 'silent',
				appType: 'custom',
				server: { middlewareMode: true, hmr: false },
				plugins: [widgetDocs({ systems: { survey }, cacheDir, slim, createProgram, loadRuntime: surveyFacts })],
			})
			try {
				return ((await server.ssrLoadModule('virtual:widget-docs/survey')) as { default: unknown }).default
			}
			finally {
				await server.close()
			}
		}
		const cold = countingFactory()
		expect(await serve(false, cold.createProgram))
			.toStrictEqual(expected)
		const warm = countingFactory()
		const slim = await serve(true, warm.createProgram) as WidgetDocsSlim
		expect(warm.count())
			.toBe(0)
		expect(slim)
			.toStrictEqual(slimDocs(expected))
		expect(Object.keys(slim))
			.toEqual(['docsVersion', 'system', 'plugins'])
		expect(slim.plugins.Survey)
			.toStrictEqual({
				summary: 'A survey: a header, the questions in order, and a footer note.',
				remarks: 'The root of a survey document. It counts the answered questions through the `questions` contract.',
				config: { summary: 'How the survey is titled and where it is sent.', remarks: '', schema: expected.plugins.Survey!.config!.schema },
				slots: {
					header: { summary: 'Anything shown above the questions.', remarks: '' },
					questions: { summary: 'The questions, in order.', remarks: 'Every question exposes whether it was answered.' },
					footer: { summary: 'Closing notes shown under the questions.', remarks: '' },
				},
				events: { submitted: { summary: 'The survey was sent.', remarks: '' } },
			})
		expect(JSON.stringify(slim).length)
			.toBeLessThan(JSON.stringify(expected).length / 2)
	}, 120_000)
})

describe('widgetDocs in vite build', () => {
	it('inlines the docs object into the bundle', async () => {
		const root = mkdtempSync(join(scratch, 'build-'))
		mkdirSync(join(root, 'src'))
		writeFileSync(join(root, 'src/entry.js'), 'import docs from \'virtual:widget-docs/survey\'\nexport const summary = docs.plugins.Survey.slots.questions.summary\n')
		const result = await build({
			configFile: false,
			root,
			logLevel: 'silent',
			build: { write: false, minify: false, lib: { entry: join(root, 'src/entry.js'), formats: ['es'], fileName: 'entry' } },
			plugins: [widgetDocs({ systems: { survey }, cacheDir: false, loadRuntime: surveyFacts })],
		})
		const output = (Array.isArray(result) ? result[0]! : result) as { output: { type: string, code?: string }[] }
		const code = output.output.find(chunk => chunk.type === 'chunk')!.code!
		expect(code)
			.toContain('The questions, in order.')
	}, 120_000)
})

describe('widgetDocs in Vitest', () => {
	it('serves the virtual module to a test through the project\'s plugin setup', () => {
		expect(docsFromVitest)
			.toStrictEqual(expected)
	})
})
