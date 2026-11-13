/**
 * Imports the BUILT packages by relative path. Nothing here goes through `src/`, so what is measured is
 * exactly what is published. Run `pnpm --filter "./packages/*" build` first.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export const dist = {
	core: new URL('../../packages/core/dist/', import.meta.url),
	vue: new URL('../../packages/vue/dist/', import.meta.url),
	inspector: new URL('../../packages/inspector/dist/', import.meta.url),
}

export function assertBuilt() {
	for (const [name, url] of Object.entries(dist)) {
		if (!existsSync(fileURLToPath(new URL('index.mjs', url))) && name !== 'inspector')
			throw new Error(`packages/${name}/dist is missing. Run: pnpm --filter "./packages/*" build`)
	}
	if (!existsSync(fileURLToPath(new URL('agent.mjs', dist.inspector))))
		throw new Error('packages/inspector/dist is missing. Run: pnpm --filter "./packages/*" build')
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
