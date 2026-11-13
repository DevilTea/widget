/**
 * Scenario registry. Scenario modules are imported lazily by area, and the Vue and Inspector modules
 * load their packages inside `setup`, so listing or running Core scenarios never loads either of them.
 */

const AREAS = [
	'./core-compile.mjs',
	'./core-runtime.mjs',
	'./core-memory.mjs',
	'./vue.mjs',
	'./inspector.mjs',
	'./size.mjs',
]

let cache = null

export async function listScenarios() {
	if (cache === null) {
		cache = []
		for (const area of AREAS) {
			const module = await import(area)
			cache.push(...module.scenarios)
		}
	}
	return cache
}

export async function findScenario(id) {
	return (await listScenarios()).find(scenario => scenario.id === id)
}
