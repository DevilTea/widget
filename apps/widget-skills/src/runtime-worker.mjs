/**
 * The worker thread `importRuntimeFacts` (`runtime-facts.ts`) starts for one run and terminates afterwards, so the
 * System's modules, tsx's state and the Core instance they loaded are freed with the thread.
 *
 * Plain JavaScript: it registers tsx itself (from this package's dependencies, whatever the process's working
 * directory), with the tsconfig the parent names. When the parent passes `paths` (a source tsconfig's aliases, with
 * absolute targets), a temporary tsconfig extends that tsconfig and adds them, so the import resolves the files the
 * type checker read. The System's module and `@deviltea/widget-core/inspection` are imported in one tsx namespace,
 * the latter as the module would import it, so both come from one Core instance.
 *
 * `workerData`: `{ modulePath, exportName, tsconfig?: string, paths?: Record<string, string[]> }`. Posts
 * `{ ok: true, facts }` or `{ ok: false, message, stack }`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import { register } from 'tsx/esm/api'

/** Imports the System in a tsx namespace and reads its facts. */
async function run({ modulePath, exportName, tsconfig, paths }) {
	let temporary
	try {
		let tsconfigOption = tsconfig
		if (paths !== undefined) {
			temporary = mkdtempSync(join(tmpdir(), 'widget-docs-tsconfig-'))
			// Relative to the temporary tsconfig, which is where `paths` resolve from when it sets no `baseUrl`.
			const relativePaths = Object.fromEntries(Object.entries(paths)
				.map(([key, targets]) => [key, targets.map(target => relative(temporary, target) || '.')]))
			tsconfigOption = join(temporary, 'tsconfig.json')
			writeFileSync(tsconfigOption, JSON.stringify({ ...(tsconfig === undefined ? {} : { extends: tsconfig }), compilerOptions: { paths: relativePaths } }))
		}
		const api = register({ namespace: 'widget-docs', ...(tsconfigOption === undefined ? {} : { tsconfig: tsconfigOption }) })
		const moduleUrl = pathToFileURL(modulePath).href
		const module = await api.import(moduleUrl, import.meta.url)
		const system = module[exportName]
		if (system === undefined || system === null)
			throw new Error(`${modulePath} has no export "${exportName}".`)
		const { inspectPlugin } = await api.import('@deviltea/widget-core/inspection', moduleUrl)
		const { collectRuntimeFacts } = await api.import(new URL('./runtime-facts.ts', import.meta.url).href, import.meta.url)
		return collectRuntimeFacts(system, inspectPlugin)
	}
	finally {
		if (temporary !== undefined)
			rmSync(temporary, { recursive: true, force: true })
	}
}

run(workerData)
	.then(facts => parentPort.postMessage({ ok: true, facts }))
	.catch(error => parentPort.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }))
