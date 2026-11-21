/**
 * Generates the documentation object of a System and caches it on disk, so that a hit builds no TypeScript program
 * and imports nothing.
 *
 * Cache key: a SHA-256 over
 * - the content of every file the TypeScript program loaded that is not under a `node_modules` directory (the
 *   System's sources, everything they import, and workspace packages, which resolve to their real paths), and of
 *   the tsconfig files the program's options came from (the tsconfig, what it `extends` outside `node_modules`, and
 *   the source tsconfig);
 * - the lockfile found above the root (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`), which stands
 *   for every declaration file under `node_modules`, TypeScript's own libraries included;
 * - the System options (module, export, tsconfig paths, whether the runtime is consulted);
 * - the generator: a hash of its own sources and `WIDGET_DOCS_VERSION`.
 *
 * Layout under `cacheDir` (by default `node_modules/.cache/widget-docs`):
 * - `<name>.manifest.json`: `{ key, fixed, files }`, the input file list of the last generation of System `<name>`.
 *   A hit is "hash the listed files, compare with `key`": no program is built to find the inputs.
 * - `<key>.json`: `{ key, docs }`.
 * Both are written atomically (temporary file and rename). An unreadable, corrupt or mismatching entry or manifest
 * is a miss: the System is generated again and both files are rewritten. Delete the directory to clear the cache.
 */

import type ts from 'typescript'
import type { CheckResult } from './check'
import type { WidgetDocs } from './docs-types'
import type { RuntimeFacts } from './ir'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { checkIr } from './check'
import { emitDocs } from './docs'
import { WIDGET_DOCS_VERSION } from './docs-types'
import { createExtractionProgram, extractIrFromProgram, readProgramConfig } from './extract'
import { importRuntimeFacts } from './runtime-facts'

/** One System to document. Paths are absolute. */
export interface DocsSystem {
	/** The module that exports the System. */
	module: string
	/** The name of the exported System. */
	export: string
	/** The tsconfig the module is compiled with. Defaults to the nearest `tsconfig.json` above the module. */
	tsconfig?: string
	/** A tsconfig whose `compilerOptions.paths` are added on top. */
	sourceTsconfig?: string
}

export interface DocsCacheOptions {
	/** The directory of the cache files; `null` disables the disk cache (every load generates). */
	cacheDir: string | null
	/** Where the lockfile search starts, and what the IR's paths are relative to. */
	root: string
	/**
	 * Import the System's module (which runs its top-level code) to cross-check the types against `system.catalog`
	 * and `inspectPlugin`, and to read `authorWritable`. Default `true`.
	 */
	runtime?: boolean
	/** Seam: creates the TypeScript program. Defaults to `ts.createProgram`. */
	createProgram?: (options: ts.CreateProgramOptions) => ts.Program
	/** Seam: reads the runtime facts. Defaults to `importRuntimeFacts`. */
	loadRuntime?: (modulePath: string, exportName: string, tsconfigPath?: string) => Promise<RuntimeFacts>
}

export interface DocsResult {
	docs: WidgetDocs
	/** The input files: the program's non-`node_modules` sources and the tsconfig files. Watch these. */
	files: string[]
	key: string
	/** `true` when the result came from the cache, with no program built. */
	hit: boolean
	/** The `--check` result of a fresh generation; `null` on a hit. */
	check: CheckResult | null
}

interface Manifest {
	key: string
	fixed: string
	files: string[]
}

const NAME = /^[\w.-]+$/

function sha256(...parts: string[]): string {
	const hash = createHash('sha256')
	for (const part of parts) {
		hash.update(part)
			.update('\0')
	}
	return hash.digest('hex')
}

export function isNodeModules(path: string): boolean {
	return path.split(/[\\/]/)
		.includes('node_modules')
}

/** Reads `path` as UTF-8 without a byte order mark, as the TypeScript compiler does. */
function readText(path: string): string {
	const text = readFileSync(path, 'utf8')
	return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

function writeAtomically(path: string, content: string): void {
	const temporary = `${path}.${process.pid}.${randomBytes(6)
		.toString('hex')}.tmp`
	writeFileSync(temporary, content)
	try {
		renameSync(temporary, path)
	}
	catch (error) {
		rmSync(temporary, { force: true })
		throw error
	}
}

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	}
	catch {
		return undefined
	}
}

let generatorHash: string | undefined

/** A hash of this generator's own sources (tests excluded), so a change to the generator invalidates every entry. */
export function getGeneratorHash(): string {
	if (generatorHash !== undefined)
		return generatorHash
	const parts = [String(WIDGET_DOCS_VERSION)]
	try {
		const directory = dirname(fileURLToPath(import.meta.url))
		for (const name of readdirSync(directory)
			.sort()) {
			if (name.endsWith('.ts') && !name.endsWith('.unit.test.ts'))
				parts.push(name, readText(join(directory, name)))
		}
	}
	catch {
		// Bundled without its sources: only the version constant identifies the generator.
	}
	generatorHash = sha256(...parts)
	return generatorHash
}

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock']

/** The hash of the nearest lockfile above `root`, which stands for every declaration file under `node_modules`. */
export function lockfileHash(root: string): string {
	for (let directory = resolve(root); ; directory = dirname(directory)) {
		for (const name of LOCKFILES) {
			const path = join(directory, name)
			if (existsSync(path))
				return sha256(path, readText(path))
		}
		if (dirname(directory) === directory)
			return 'no-lockfile'
	}
}

function hashFiles(files: readonly string[], contentOf: (file: string) => string): string {
	return sha256(...[...files].sort()
		.flatMap(file => [file, sha256(contentOf(file))]))
}

export interface DocsCache {
	/** The docs of System `name`: from the cache when every input is unchanged, otherwise generated and stored. */
	load: (name: string, system: DocsSystem) => Promise<DocsResult>
}

export function createDocsCache(options: DocsCacheOptions): DocsCache {
	const runtime = options.runtime ?? true
	const loadRuntime = options.loadRuntime ?? importRuntimeFacts
	const lockHash = lockfileHash(options.root)

	const fixedPartOf = (system: DocsSystem): string => sha256(getGeneratorHash(), lockHash, JSON.stringify({
		module: resolve(system.module),
		export: system.export,
		tsconfig: system.tsconfig === undefined ? null : resolve(system.tsconfig),
		sourceTsconfig: system.sourceTsconfig === undefined ? null : resolve(system.sourceTsconfig),
		runtime,
	}))

	function tryHit(name: string, fixed: string): DocsResult | null {
		if (options.cacheDir === null)
			return null
		const manifest = readJson(join(options.cacheDir, `${name}.manifest.json`)) as Partial<Manifest> | undefined
		if (typeof manifest !== 'object' || manifest === null || manifest.fixed !== fixed || typeof manifest.key !== 'string' || !Array.isArray(manifest.files) || !manifest.files.every(file => typeof file === 'string'))
			return null
		let key: string
		try {
			key = sha256(fixed, hashFiles(manifest.files, readText))
		}
		catch {
			// A listed file is gone or unreadable.
			return null
		}
		if (key !== manifest.key || !NAME.test(key))
			return null
		const entry = readJson(join(options.cacheDir, `${key}.json`)) as { key?: unknown, docs?: WidgetDocs } | undefined
		if (typeof entry !== 'object' || entry === null || entry.key !== key || typeof entry.docs !== 'object' || entry.docs === null || entry.docs.docsVersion !== WIDGET_DOCS_VERSION)
			return null
		return { docs: entry.docs, files: manifest.files, key, hit: true, check: null }
	}

	async function generate(name: string, system: DocsSystem, fixed: string): Promise<DocsResult> {
		const modulePath = resolve(system.module)
		const extractOptions = {
			modulePath,
			exportName: system.export,
			tsconfigPath: system.tsconfig,
			sourceTsconfigPath: system.sourceTsconfig,
			cwd: options.root,
			createProgram: options.createProgram,
		}
		const config = readProgramConfig(extractOptions)
		const program = createExtractionProgram(extractOptions, config)
		const facts = runtime ? await loadRuntime(modulePath, system.export, system.tsconfig) : undefined
		const ir = extractIrFromProgram(program, { ...extractOptions, runtime: facts })
		if (ir.mismatches.length > 0) {
			throw new Error(`widget-docs: the types and the runtime of "${name}" disagree:\n${ir.mismatches.map(line => `- ${line}`)
				.join('\n')}`)
		}
		const docs = emitDocs(ir)

		// The content the program read, not a later read from disk: an edit racing the build cannot be cached under
		// the new content's key.
		const contents = new Map<string, string>()
		for (const sourceFile of program.getSourceFiles()) {
			const file = resolve(sourceFile.fileName)
			if (!isNodeModules(file))
				contents.set(file, sourceFile.text)
		}
		for (const file of config.configFiles) {
			if (!isNodeModules(file))
				contents.set(file, readText(file))
		}
		const files = [...contents.keys()].sort()
		const key = sha256(fixed, hashFiles(files, file => contents.get(file)!))

		if (options.cacheDir !== null) {
			mkdirSync(options.cacheDir, { recursive: true })
			const manifestPath = join(options.cacheDir, `${name}.manifest.json`)
			const previous = readJson(manifestPath) as Partial<Manifest> | undefined
			writeAtomically(join(options.cacheDir, `${key}.json`), JSON.stringify({ key, docs }))
			writeAtomically(manifestPath, `${JSON.stringify({ key, fixed, files } satisfies Manifest, null, '\t')}\n`)
			// The entry the manifest pointed at before belongs to no manifest any more.
			if (typeof previous?.key === 'string' && previous.key !== key && NAME.test(previous.key))
				rmSync(join(options.cacheDir, `${previous.key}.json`), { force: true })
		}
		return { docs, files, key, hit: false, check: checkIr(ir) }
	}

	return {
		async load(name, system) {
			if (!NAME.test(name))
				throw new Error(`widget-docs: the System name "${name}" must match ${String(NAME)}.`)
			const fixed = fixedPartOf(system)
			return tryHit(name, fixed) ?? generate(name, system, fixed)
		},
	}
}

/** The default cache directory under `root`. */
export function defaultCacheDir(root: string): string {
	return join(root, 'node_modules', '.cache', 'widget-docs')
}
