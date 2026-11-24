/**
 * Generates the documentation object of a System and caches it on disk, so that a hit builds no TypeScript program
 * and imports nothing.
 *
 * Cache key: a SHA-256 over
 * - the content of every file the TypeScript program loaded that is not under a `node_modules` directory (the
 *   System's sources, everything they import, and workspace packages, which resolve to their real paths), of the
 *   run-time JavaScript next to each of those declaration files (`X.mjs` next to `X.d.mts`, `X.js` next to `X.d.ts`,
 *   `X.cjs` next to `X.d.cts`), of the nearest `package.json` of each of these files, and of the tsconfig files the
 *   program's options came from (the tsconfig, what it `extends` outside `node_modules`, and the source tsconfig);
 * - the lockfile found above the root (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`) and the
 *   installed state of the nearest `node_modules` above the root (`.pnpm/lock.yaml`, `.modules.yaml`,
 *   `.package-lock.json`, `.yarn-state.yml`), which stand for every file under `node_modules`, TypeScript's own
 *   libraries included;
 * - the System options (module, export, tsconfig paths, whether the runtime is consulted);
 * - the generator: a hash of its own sources and `WIDGET_DOCS_VERSION`.
 *
 * A generation whose program has an unresolved import outside `node_modules` (a relative import of a file that does
 * not exist yet, a `paths` alias to nothing) is not cached: creating the file changes no hashed input. Its result lists
 * the locations TypeScript looked at (`missing`), and the Vite plugin watches them.
 *
 * Layout under `cacheDir` (by default `node_modules/.cache/widget-docs`):
 * - `<name>.manifest.json`: `{ key, fixed, files }`, the input file list of the last generation of System `<name>`.
 *   A hit is "hash the listed files, compare with `key`": no program is built to find the inputs.
 * - `<key>.json`: `{ key, docs, check }`: the docs and the `--check` result, so a hit reports the same problems.
 * Both are written atomically (temporary file and rename). An unreadable, corrupt or mismatching entry or manifest
 * is a miss: the System is generated again and both files are rewritten. Delete the directory to clear the cache.
 *
 * Writing is best effort: when the cache cannot be written (a read-only or missing file system, no permission, any
 * other error), the generated docs are still returned and one warning is emitted per cache object. The environment
 * variable `WIDGET_DOCS_CACHE=off` bypasses the cache entirely: nothing is read from or written to it.
 */

import type { CheckResult } from './check'
import type { WidgetDocs } from './docs-types'
import type { RuntimeFacts } from './ir'
import type { RuntimeImportOptions } from './runtime-facts'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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
	/** The tsconfig the module is compiled with (see `readProgramConfig`). Defaults to the nearest `tsconfig.json` above the module. */
	tsconfig?: string
	/** A tsconfig whose `compilerOptions.paths` are added on top. */
	sourceTsconfig?: string
}

export interface DocsCacheOptions {
	/**
	 * The directory of the cache files; `null` disables the disk cache (every load generates), and so does the environment
	 * variable `WIDGET_DOCS_CACHE=off`.
	 */
	cacheDir: string | null
	/** Receives the one warning about a cache that cannot be written. Defaults to `console.warn`. */
	warn?: (message: string) => void
	/** Where the lockfile search starts, and what the IR's paths are relative to. */
	root: string
	/**
	 * Import the System's module (which runs its top-level code) to cross-check the types against `system.catalog`
	 * and `inspectPlugin`, to read `authorWritable`, and to read each plugin's `plugin.docs` (all the prose). Default `true`.
	 */
	runtime?: boolean
	/** Seam: creates the TypeScript program. Defaults to `ts.createProgram`. */
	createProgram?: (options: ts.CreateProgramOptions) => ts.Program
	/** Seam: reads the runtime facts. Defaults to `importRuntimeFacts` (a worker thread per call). */
	loadRuntime?: (modulePath: string, exportName: string, options: RuntimeImportOptions) => Promise<RuntimeFacts>
}

export interface DocsResult {
	docs: WidgetDocs
	/** The input files: the program's non-`node_modules` sources, their run-time JavaScript and `package.json`, the tsconfig files. Watch these. */
	files: string[]
	/**
	 * Where TypeScript looked for an import outside `node_modules` it could not resolve. Watch these too: creating one
	 * of them changes the program. Such a result is never cached. Empty on a hit.
	 */
	missing: string[]
	key: string
	/** `true` when the result came from the cache, with no program built. */
	hit: boolean
	/** The `--check` result, stored with the docs, so a hit reports the same documentation problems. */
	check: CheckResult
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

/**
 * A hash of the generator sources in `directory` (every `.ts` and `.mjs` file except tests) and `WIDGET_DOCS_VERSION`.
 * An unreadable directory (the generator bundled without its sources) leaves only the version constant.
 */
export function generatorHashOf(directory: string): string {
	const parts = [String(WIDGET_DOCS_VERSION)]
	try {
		for (const name of readdirSync(directory)
			.sort()) {
			if ((name.endsWith('.ts') || name.endsWith('.mjs')) && !name.endsWith('.unit.test.ts'))
				parts.push(name, readText(join(directory, name)))
		}
	}
	catch {
		// Bundled without its sources: only the version constant identifies the generator.
	}
	return sha256(...parts)
}

/** `generatorHashOf` this generator's own directory, computed once per process: a change to the generator invalidates every entry. */
export function getGeneratorHash(): string {
	generatorHash ??= generatorHashOf(dirname(fileURLToPath(import.meta.url)))
	return generatorHash
}

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock']

/** The hash of the nearest lockfile above `root`, which stands for every file under `node_modules` (with `installStateHash`). */
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

/** What a package manager writes into `node_modules` on every install (pnpm, npm, Yarn). */
const INSTALL_STATE_FILES = ['.pnpm/lock.yaml', '.modules.yaml', '.package-lock.json', '.yarn-state.yml']

/**
 * The hash of the installed state of the nearest `node_modules` above `root` that has one: an install that does not
 * change the lockfile (`pnpm install` after switching branches, a hand-edited `node_modules`) still changes it.
 */
export function installStateHash(root: string): string {
	for (let directory = resolve(root); ; directory = dirname(directory)) {
		const present = INSTALL_STATE_FILES.map(name => join(directory, 'node_modules', name))
			.filter(path => existsSync(path))
		if (present.length > 0)
			return sha256(...present.flatMap(path => [path, readText(path)]))
		if (dirname(directory) === directory)
			return 'no-install-state'
	}
}

/** The run-time JavaScript a declaration file describes: `X.mjs` for `X.d.mts`, `X.js` for `X.d.ts`, `X.cjs` for `X.d.cts`. */
function runtimeFileOf(file: string): string | null {
	const match = /\.d\.(m|c)?ts$/.exec(file)
	return match === null ? null : `${file.slice(0, match.index)}.${match[1] ?? ''}js`
}

/** The nearest `package.json` above `file`, or `null`. `known` caches the answer per directory. */
function nearestPackageJson(file: string, known: Map<string, string | null>): string | null {
	const visited: string[] = []
	let found: string | null = null
	for (let directory = dirname(file); ; directory = dirname(directory)) {
		const cached = known.get(directory)
		if (cached !== undefined) {
			found = cached
			break
		}
		visited.push(directory)
		const candidate = join(directory, 'package.json')
		if (existsSync(candidate)) {
			found = candidate
			break
		}
		if (dirname(directory) === directory)
			break
	}
	for (const directory of visited)
		known.set(directory, found)
	return found
}

/**
 * The locations TypeScript looked at for the imports of the program's non-`node_modules` files that it could not
 * resolve, outside `node_modules`. An unresolved bare import that only looked under `node_modules` is not listed: an
 * install that adds the package changes the lockfile or the installed state.
 */
export function unresolvedImportLocations(program: ts.Program, compilerOptions: ts.CompilerOptions): string[] {
	const ambient = new Set(program.getTypeChecker()
		.getAmbientModules()
		.map(symbol => symbol.name.replace(/^"|"$/g, '')))
	const cache = ts.createModuleResolutionCache(program.getCurrentDirectory(), name => name, compilerOptions)
	const locations = new Set<string>()
	for (const sourceFile of program.getSourceFiles()) {
		const file = resolve(sourceFile.fileName)
		if (isNodeModules(file) || program.isSourceFileDefaultLibrary(sourceFile))
			continue
		for (const { fileName: specifier } of ts.preProcessFile(sourceFile.text, true, true).importedFiles) {
			if (ambient.has(specifier))
				continue
			const result = ts.resolveModuleName(specifier, file, compilerOptions, ts.sys, cache)
			if (result.resolvedModule !== undefined)
				continue
			// `failedLookupLocations` is not in the public typings, but it is what the compiler watches for the same reason.
			const failed = ((result as { failedLookupLocations?: readonly string[] }).failedLookupLocations ?? [])
				.map(location => resolve(location))
				.filter(location => !isNodeModules(location))
			if (failed.length === 0 && (specifier.startsWith('.') || specifier.startsWith('/')))
				failed.push(resolve(dirname(file), specifier))
			for (const location of failed)
				locations.add(location)
		}
	}
	return [...locations].sort()
}

/** The `paths` of `compilerOptions` with absolute targets (relative to `baseUrl`, or to the tsconfig that declared them). */
function absolutePaths(compilerOptions: ts.CompilerOptions): Record<string, string[]> {
	const base = compilerOptions.baseUrl ?? (compilerOptions as { pathsBasePath?: string }).pathsBasePath ?? process.cwd()
	return Object.fromEntries(Object.entries(compilerOptions.paths ?? {})
		.map(([key, targets]) => [key, targets.map(target => resolve(base, target))]))
}

function hashFiles(files: readonly string[], contentOf: (file: string) => string): string {
	return sha256(...[...files].sort()
		.flatMap(file => [file, sha256(contentOf(file))]))
}

export interface DocsCache {
	/** The docs of System `name`: from the cache when every input is unchanged, otherwise generated and stored. */
	load: (name: string, system: DocsSystem) => Promise<DocsResult>
}

/** `true` when `WIDGET_DOCS_CACHE=off` asks to bypass the disk cache. */
export function isCacheDisabledByEnvironment(): boolean {
	return process.env.WIDGET_DOCS_CACHE?.trim()
		.toLowerCase() === 'off'
}

export function createDocsCache(options: DocsCacheOptions): DocsCache {
	const cacheDir = isCacheDisabledByEnvironment() ? null : options.cacheDir
	const warn = options.warn ?? ((message: string) => console.warn(message))
	let warnedAboutWrite = false
	const runtime = options.runtime ?? true
	const loadRuntime = options.loadRuntime ?? importRuntimeFacts

	// Read on every load: an install during a dev session changes them.
	const fixedPartOf = (system: DocsSystem): string => sha256(getGeneratorHash(), lockfileHash(options.root), installStateHash(options.root), JSON.stringify({
		module: resolve(system.module),
		export: system.export,
		tsconfig: system.tsconfig === undefined ? null : resolve(system.tsconfig),
		sourceTsconfig: system.sourceTsconfig === undefined ? null : resolve(system.sourceTsconfig),
		runtime,
	}))

	function tryHit(name: string, fixed: string): DocsResult | null {
		if (cacheDir === null)
			return null
		const manifest = readJson(join(cacheDir, `${name}.manifest.json`)) as Partial<Manifest> | undefined
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
		const entry = readJson(join(cacheDir, `${key}.json`)) as { key?: unknown, docs?: WidgetDocs, check?: CheckResult } | undefined
		if (typeof entry !== 'object' || entry === null || entry.key !== key || typeof entry.docs !== 'object' || entry.docs === null || entry.docs.docsVersion !== WIDGET_DOCS_VERSION)
			return null
		if (typeof entry.check !== 'object' || entry.check === null || typeof entry.check.ok !== 'boolean' || !Array.isArray(entry.check.problems))
			return null
		return { docs: entry.docs, files: manifest.files, missing: [], key, hit: true, check: entry.check }
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
		// With a source tsconfig, tsx gets the same `paths` the type checker used, so both read the same files.
		const facts = runtime
			? await loadRuntime(modulePath, system.export, {
					...(config.tsconfigPath === undefined ? {} : { tsconfig: config.tsconfigPath }),
					...(system.sourceTsconfig === undefined ? {} : { paths: absolutePaths(config.compilerOptions) }),
				})
			: undefined
		const ir = extractIrFromProgram(program, { ...extractOptions, runtime: facts })
		if (ir.mismatches.length > 0) {
			throw new Error(`widget-docs: the types and the runtime of "${name}" disagree:\n${ir.mismatches.map(line => `- ${line}`)
				.join('\n')}`)
		}
		const docs = emitDocs(ir)
		const check = checkIr(ir)

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
		// The run-time JavaScript of a declaration file the program read (a workspace package's `dist`): the runtime
		// cross-check imports it.
		for (const file of [...contents.keys()]) {
			const runtimeFile = runtimeFileOf(file)
			if (runtimeFile !== null && !contents.has(runtimeFile) && existsSync(runtimeFile))
				contents.set(runtimeFile, readText(runtimeFile))
		}
		// The `package.json` that decides how each file is resolved and loaded (`exports`, `type`, `imports`).
		const packageJsons = new Map<string, string | null>()
		for (const file of [...contents.keys()]) {
			const manifest = nearestPackageJson(file, packageJsons)
			if (manifest !== null && !isNodeModules(manifest) && !contents.has(manifest))
				contents.set(manifest, readText(manifest))
		}
		const files = [...contents.keys()].sort()
		const missing = unresolvedImportLocations(program, config.compilerOptions)
		const key = sha256(fixed, hashFiles(files, file => contents.get(file)!))

		// A missing file would not change the key when it is created: such a result is never stored.
		if (cacheDir !== null && missing.length === 0) {
			try {
				mkdirSync(cacheDir, { recursive: true })
				const manifestPath = join(cacheDir, `${name}.manifest.json`)
				const previous = readJson(manifestPath) as Partial<Manifest> | undefined
				writeAtomically(join(cacheDir, `${key}.json`), JSON.stringify({ key, docs, check }))
				writeAtomically(manifestPath, `${JSON.stringify({ key, fixed, files } satisfies Manifest, null, '\t')}\n`)
				// The entry the manifest pointed at before belongs to no manifest any more.
				if (typeof previous?.key === 'string' && previous.key !== key && NAME.test(previous.key))
					rmSync(join(cacheDir, `${previous.key}.json`), { force: true })
			}
			catch (error) {
				// Best effort: the docs are correct without the cache.
				if (!warnedAboutWrite) {
					warnedAboutWrite = true
					const reason = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))
					warn(`widget-docs: cannot write the cache in ${cacheDir} (${reason}); the docs are generated on every load. Set WIDGET_DOCS_CACHE=off to skip the cache.`)
				}
			}
		}
		return { docs, files, missing, key, hit: false, check }
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
