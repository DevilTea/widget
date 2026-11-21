import type { HmrContext, Plugin, ViteDevServer } from 'vite'
import type { DocsSystem, RuntimeFacts, WidgetDocs } from './index'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectPlugin } from '@deviltea/widget-core/inspection'
import ts from 'typescript'
import docsFromVitest from 'virtual:widget-docs/survey'
import { build, createServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { surveySystem } from '../fixtures/survey-system'
import { collectRuntimeFacts, createDocsCache, emitDocs, extractIr } from './index'
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
			.toMatchObject({ hit: true, key: cold.key, files: cold.files, check: null })
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
		expect(first.files.filter(file => !file.startsWith(directory))
			.every(file => file.startsWith(resolve(repositoryRoot, 'packages/core/dist/'))))
			.toBe(true)

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
			.toEqual({ key: first.key, docs: first.docs })

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
