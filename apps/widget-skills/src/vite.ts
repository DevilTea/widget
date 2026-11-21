/**
 * `widgetDocs(options)`: a Vite plugin that serves the documentation of a Widget System, generated from its
 * TypeScript types and JSDoc at build time, as `virtual:widget-docs/<name>` (a default export of type `WidgetDocs`,
 * see `docs-types.ts` and `virtual-widget-docs.d.ts`).
 *
 * It works the same in `vite dev`, `vite build` and Vitest. Generation goes through the disk cache of
 * `docs-cache.ts`: a hit builds no TypeScript program and imports nothing.
 *
 * Unless `runtime: false`, generating **imports the System's module, which runs its top-level code** (and that of
 * everything it imports), to cross-check the names in the types against `system.catalog` and `inspectPlugin`. Only
 * name modules you would run. A disagreement fails the load with an error that lists it.
 *
 * In dev, the input files of each System are added to Vite's watcher. A change to one of them invalidates only the
 * virtual modules of the Systems that read it, and Vite updates their importers (HMR, or a reload when an importer
 * does not accept the update). A change to any other file regenerates nothing.
 */

import type { HmrContext, ModuleNode, Plugin, ViteDevServer } from 'vite'
import type { DocsCache, DocsCacheOptions, DocsResult } from './docs-cache'
import { resolve } from 'node:path'
import process from 'node:process'
import { formatCheck } from './check'
import { createDocsCache, defaultCacheDir } from './docs-cache'

export interface WidgetDocsSystemOptions {
	/** The module that exports the System, relative to Vite's `root`. */
	module: string
	/** The name of the exported System. */
	export: string
	/**
	 * The tsconfig the module is compiled with, relative to `root`: for an application its app tsconfig (`tsconfig.app.json`).
	 * Defaults to the nearest `tsconfig.json` above the module, which in a project with references is usually a solution file
	 * and is refused: the tsconfig must include the module and enable `strictNullChecks`.
	 */
	tsconfig?: string
	/** A tsconfig whose `compilerOptions.paths` are added on top (for example to resolve workspace packages to source). */
	sourceTsconfig?: string
}

export interface WidgetDocsOptions {
	/** Each key `<name>` is served as `virtual:widget-docs/<name>`. A name matches `[\w.-]+`. */
	systems: Record<string, WidgetDocsSystemOptions>
	/** The cache directory, relative to `root`; `false` disables the disk cache. Default `node_modules/.cache/widget-docs`. */
	cacheDir?: string | false
	/** Import the System's module for the runtime cross-check (runs its top-level code). Default `true`. */
	runtime?: boolean
	/** Seams for tests. */
	createProgram?: DocsCacheOptions['createProgram']
	loadRuntime?: DocsCacheOptions['loadRuntime']
}

export const WIDGET_DOCS_PREFIX = 'virtual:widget-docs/'
const RESOLVED_PREFIX = `\0${WIDGET_DOCS_PREFIX}`

export function widgetDocs(options: WidgetDocsOptions): Plugin {
	let root = process.cwd()
	let cache: DocsCache | undefined
	let serving = false
	/** Vite's dev watcher; the input files of a System are added to it when the System is loaded. */
	let watcher: ViteDevServer['watcher'] | undefined
	/** System name to the input files of its last generation (absolute, as TypeScript and Vite spell them). */
	const inputs = new Map<string, ReadonlySet<string>>()
	const pending = new Map<string, Promise<DocsResult>>()

	const systemOf = (name: string) => Object.hasOwn(options.systems, name) ? options.systems[name] : undefined

	function load(name: string): Promise<DocsResult> {
		const running = pending.get(name)
		if (running !== undefined)
			return running
		const system = systemOf(name)!
		cache ??= createDocsCache({
			cacheDir: options.cacheDir === false ? null : options.cacheDir === undefined ? defaultCacheDir(root) : resolve(root, options.cacheDir),
			root,
			runtime: options.runtime,
			createProgram: options.createProgram,
			loadRuntime: options.loadRuntime,
		})
		const promise = cache.load(name, {
			module: resolve(root, system.module),
			export: system.export,
			tsconfig: system.tsconfig === undefined ? undefined : resolve(root, system.tsconfig),
			sourceTsconfig: system.sourceTsconfig === undefined ? undefined : resolve(root, system.sourceTsconfig),
		})
			.then((result) => {
				inputs.set(name, new Set(result.files))
				watcher?.add(result.files)
				return result
			})
			.finally(() => pending.delete(name))
		pending.set(name, promise)
		return promise
	}

	return {
		name: 'widget-docs',
		configResolved(config) {
			root = config.root
			serving = config.command === 'serve' && !config.isProduction && config.server.watch !== null
		},
		resolveId(id) {
			if (!id.startsWith(WIDGET_DOCS_PREFIX))
				return null
			const name = id.slice(WIDGET_DOCS_PREFIX.length)
			if (systemOf(name) === undefined) {
				this.error(`widget-docs: no System "${name}" in the plugin options (known: ${Object.keys(options.systems)
					.join(', ') || 'none'}).`)
			}
			return `${RESOLVED_PREFIX}${name}`
		},
		async load(id) {
			if (!id.startsWith(RESOLVED_PREFIX))
				return null
			const name = id.slice(RESOLVED_PREFIX.length)
			const result = await load(name)
			// In dev `load()` adds the files to Vite's watcher and `handleHotUpdate` invalidates; in a watched build
			// Rollup re-runs on these files. A hit reports no documentation problems (none were computed).
			if (!serving) {
				for (const file of result.files)
					this.addWatchFile(file)
			}
			if (result.check !== null && !result.check.ok)
				this.warn(`widget-docs: "${name}" has documentation problems:\n${formatCheck(result.check)}`)
			return `export default JSON.parse(${JSON.stringify(JSON.stringify(result.docs))})\n`
		},
		configureServer(server) {
			watcher = server.watcher
		},
		handleHotUpdate(context: HmrContext) {
			const file = resolve(context.file)
			const affected: ModuleNode[] = []
			for (const [name, files] of inputs) {
				if (!files.has(file))
					continue
				const module = context.server.moduleGraph.getModuleById(`${RESOLVED_PREFIX}${name}`)
				if (module !== undefined) {
					context.server.moduleGraph.invalidateModule(module)
					affected.push(module)
				}
			}
			if (affected.length === 0)
				return undefined
			return [...context.modules, ...affected]
		},
	}
}
