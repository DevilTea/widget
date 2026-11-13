/**
 * Imports the BUILT packages by relative path. Nothing here goes through `src/`, so what is measured is
 * exactly what is published. Run `pnpm --filter "./packages/*" build` first.
 *
 * Where the packages come from: by default the repository that contains this harness (`harnessRoot`).
 * `BENCH_PACKAGES_ROOT=<absolute path of another checkout>` makes everything that is measured come from that
 * checkout instead (`packages/*\/dist`, and for the Vue scenarios Vue and happy-dom resolved from its
 * `packages/vue`), so one copy of the harness can measure several commits checked out side by side. `root` is
 * the packages root in both cases and ends with a slash; it is resolved to a real path, because that is the
 * path under which Node reports the modules it loads.
 */

import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const harnessRoot = fileURLToPath(new URL('../../', import.meta.url))

const requested = process.env.BENCH_PACKAGES_ROOT
const overridden = requested !== undefined && requested !== ''

/** Why `BENCH_PACKAGES_ROOT` cannot be used, or null. Reported by `assertBuilt` so that it can name the root. */
let rootProblem = null
let resolvedRoot = harnessRoot
if (overridden) {
	if (!isAbsolute(requested)) {
		rootProblem = `BENCH_PACKAGES_ROOT must be an absolute path, got "${requested}"`
	}
	else if (!existsSync(resolve(requested, 'packages'))) {
		rootProblem = `BENCH_PACKAGES_ROOT=${requested} is not a repository checkout (it has no packages/ directory)`
	}
	else {
		resolvedRoot = realpathSync(requested)
	}
}
if (!resolvedRoot.endsWith('/'))
	resolvedRoot += '/'

/** The checkout the measured packages come from (with a trailing slash). */
export const root = resolvedRoot
/** True when `BENCH_PACKAGES_ROOT` selected a checkout other than the harness's own. */
export const rootOverridden = overridden

const rootUrl = pathToFileURL(root)
export const dist = {
	core: new URL('packages/core/dist/', rootUrl),
	vue: new URL('packages/vue/dist/', rootUrl),
	inspector: new URL('packages/inspector/dist/', rootUrl),
}

const BUILD_HINT = 'Run: pnpm --filter "./packages/*" build (inside that checkout)'

export function assertBuilt() {
	if (rootProblem !== null)
		throw new Error(rootProblem)
	const missing = []
	for (const [name, url] of Object.entries(dist)) {
		const entry = name === 'inspector' ? 'agent.mjs' : 'index.mjs'
		if (!existsSync(fileURLToPath(new URL(entry, url))))
			missing.push(`packages/${name}/dist/${entry}`)
	}
	if (missing.length > 0)
		throw new Error(`built packages not found under ${root}${overridden ? ' (BENCH_PACKAGES_ROOT)' : ''}: missing ${missing.join(', ')}. ${BUILD_HINT}`)
}

export async function loadCore() {
	assertBuilt()
	return import(new URL('index.mjs', dist.core).href)
}

export async function loadCoreInspection() {
	assertBuilt()
	return import(new URL('inspection/index.mjs', dist.core).href)
}

export async function loadVue() {
	assertBuilt()
	return import(new URL('index.mjs', dist.vue).href)
}

export async function loadInspector(entry) {
	assertBuilt()
	return import(new URL(`${entry}.mjs`, dist.inspector).href)
}
