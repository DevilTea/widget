/**
 * Reads the runtime side of a System (`system.catalog` and `inspectPlugin`) into plain data, so the extractor
 * can cross-check the names it read from the types.
 *
 * `loadRuntimeFacts` imports the System's module and Core's inspection entry from the same module graph: Core
 * identifies its plugins by module-private brands, so both must come from one Core instance.
 */

import type { Capability, RuntimeFacts } from './ir'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { CAPABILITIES } from './ir'

interface InspectionLike {
	readonly state: ReadonlyMap<PropertyKey, { readonly authorWritable: boolean }> | null
	readonly properties: ReadonlyMap<PropertyKey, unknown> | null
	readonly events: ReadonlyMap<PropertyKey, unknown> | null
}

interface SystemLike {
	readonly plugins: readonly { readonly type: string }[]
	readonly catalog: { readonly widgets: readonly { readonly type: string, readonly capabilities: Readonly<Record<Capability, boolean>>, readonly slots: readonly PropertyKey[] | null }[] }
}

/** The semantic facts Core 0.3 still carries: the catalog (type, capabilities, slot names) and `inspectPlugin` (members). */
export function collectRuntimeFacts(system: unknown, inspectPlugin: (plugin: never) => unknown): RuntimeFacts {
	const { plugins, catalog } = system as SystemLike
	const catalogTypes = catalog.widgets.map(widget => widget.type)
	const pluginTypes = plugins.map(plugin => plugin.type)
	if (catalogTypes.join('\n') !== pluginTypes.join('\n'))
		throw new Error(`system.catalog lists [${catalogTypes.join(', ')}] but system.plugins is [${pluginTypes.join(', ')}].`)
	return {
		plugins: catalog.widgets.map((entry, index) => {
			const inspection = inspectPlugin(plugins[index] as never) as InspectionLike
			return {
				type: entry.type,
				capabilities: Object.fromEntries(CAPABILITIES.map(capability => [capability, entry.capabilities[capability] === true])) as Record<Capability, boolean>,
				slots: entry.slots === null ? null : entry.slots.map(String),
				state: inspection.state === null ? null : [...inspection.state].map(([name, member]) => ({ name: String(name), authorWritable: member.authorWritable })),
				properties: inspection.properties === null ? null : [...inspection.properties.keys()].map(String),
				events: inspection.events === null ? null : [...inspection.events.keys()].map(String),
			}
		}),
	}
}

type InspectPlugin = (plugin: never) => unknown

/**
 * The file of `@deviltea/widget-core/inspection` as the module at `modulePath` would import it: the nearest
 * `node_modules/@deviltea/widget-core` above the module, through its `exports`. (`require.resolve` cannot do
 * this: Core exports only the `import` condition.)
 */
function resolveInspectionEntry(modulePath: string): string {
	for (let directory = dirname(modulePath); ; directory = dirname(directory)) {
		const packageRoot = join(directory, 'node_modules', '@deviltea', 'widget-core')
		const manifestPath = join(packageRoot, 'package.json')
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: Record<string, { import?: string } | string> }
			const entry = manifest.exports?.['./inspection']
			const target = typeof entry === 'string' ? entry : entry?.import
			if (target === undefined)
				throw new Error(`${manifestPath} does not export "./inspection".`)
			return join(packageRoot, target)
		}
		if (dirname(directory) === directory)
			throw new Error(`No node_modules/@deviltea/widget-core above ${modulePath}.`)
	}
}

/**
 * Core's `inspectPlugin` from the Core instance that built `system`'s plugins.
 *
 * Core brands its plugins per module instance, so an `inspectPlugin` from another copy of Core throws
 * `foreign-plugin`. The System's module decides which copy that is, not this package: the entry is resolved from
 * the module's own location first, then as this package sees it (which is what a `paths` alias to source yields),
 * and the first one that accepts the System's first plugin is used.
 */
async function inspectPluginFor(modulePath: string, system: SystemLike): Promise<InspectPlugin> {
	const specifier = '@deviltea/widget-core/inspection'
	const candidates: (() => Promise<unknown>)[] = [
		async () => import(pathToFileURL(resolveInspectionEntry(modulePath)).href),
		async () => import(specifier),
	]
	const failures: string[] = []
	for (const candidate of candidates) {
		try {
			const { inspectPlugin } = await candidate() as { inspectPlugin: InspectPlugin }
			const first = system.plugins[0]
			if (first !== undefined)
				inspectPlugin(first as never)
			return inspectPlugin
		}
		catch (error) {
			failures.push(error instanceof Error ? error.message : String(error))
		}
	}
	throw new Error(`Cannot load an inspectPlugin that accepts the plugins of ${modulePath} (one Core instance must serve both): ${failures.join(' | ')}`)
}

/** The System a module exports. Importing the module executes it, and everything it imports. */
async function importSystem(modulePath: string, exportName: string): Promise<SystemLike> {
	const module = await import(pathToFileURL(modulePath).href) as Record<string, unknown>
	const system = module[exportName]
	if (system === undefined || system === null)
		throw new Error(`${modulePath} has no export "${exportName}".`)
	return system as SystemLike
}

/** Imports `modulePath` (absolute) and reads the facts of its export `exportName`. Needs a TypeScript loader (tsx). */
export async function loadRuntimeFacts(modulePath: string, exportName: string): Promise<RuntimeFacts> {
	const system = await importSystem(modulePath, exportName)
	return collectRuntimeFacts(system, await inspectPluginFor(modulePath, system))
}

export interface CompileOutcome {
	status: string
	diagnostics: { code: string, message: string }[]
}

/** Compiles `source` with the System `modulePath` exports, so an example document can be proven valid before it is published. */
export async function compileWithSystem(modulePath: string, exportName: string, source: unknown): Promise<CompileOutcome> {
	const system = await importSystem(modulePath, exportName) as unknown as { createBlueprint: (source: unknown) => { status: string, diagnostics: readonly { code: string, message: string }[] } }
	const blueprint = system.createBlueprint(structuredClone(source))
	return { status: blueprint.status, diagnostics: blueprint.diagnostics.map(({ code, message }) => ({ code, message })) }
}

export interface RuntimeImportOptions {
	/** The tsconfig tsx compiles the module with. */
	tsconfig?: string
	/** Extra `paths` aliases with absolute targets (a source tsconfig's), added on top of the tsconfig's. */
	paths?: Record<string, string[]>
}

interface WorkerReply {
	ok: boolean
	facts?: RuntimeFacts
	message?: string
	stack?: string
}

/**
 * Like `loadRuntimeFacts`, but works in a process without a TypeScript loader (Vite, Vitest): the System's module is
 * imported through tsx in a worker thread (`runtime-worker.mjs`) that is terminated after the run, so a later call sees
 * edited files and nothing the module loaded stays in this process. `@deviltea/widget-core/inspection` is imported in
 * the worker as the System's module would import it, so both come from one Core instance. Importing the module
 * executes it, and everything it imports, in the worker.
 */
export async function importRuntimeFacts(modulePath: string, exportName: string, options: RuntimeImportOptions = {}): Promise<RuntimeFacts> {
	const worker = new Worker(new URL('./runtime-worker.mjs', import.meta.url), {
		workerData: { modulePath, exportName, tsconfig: options.tsconfig, paths: options.paths },
	})
	try {
		const reply = await new Promise<WorkerReply>((resolveReply, reject) => {
			worker.once('message', resolveReply)
			worker.once('error', reject)
			worker.once('exit', code => reject(new Error(`The runtime worker for ${modulePath} exited with code ${String(code)} before it answered.`)))
		})
		if (!reply.ok || reply.facts === undefined) {
			const error = new Error(reply.message ?? `The runtime worker for ${modulePath} failed.`)
			if (reply.stack !== undefined)
				error.stack = reply.stack
			throw error
		}
		return reply.facts
	}
	finally {
		await worker.terminate()
	}
}
