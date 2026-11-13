/**
 * Core: retained heap per widget. Needs --expose-gc (the runner always passes it).
 *
 * Method: build the document first (it is shared by reference with the Blueprint and is not counted), warm
 * everything with one throw-away compile and Runtime, then take `heapUsed` after several forced collections
 * before and after each step. Repeated three times per size; the median is reported with the range.
 */

import { createFixture, PROFILES } from '../lib/gen.mjs'
import { heapUsedAfterGc } from '../lib/harness.mjs'
import { median } from '../lib/stats.mjs'
import { treeOf } from './common.mjs'

function readAllProperties(runtime, f) {
	let count = 0
	for (const id of f.unitIds()) {
		const widget = runtime.getWidget(id)
		for (const name of Object.keys(widget.properties ?? {})) {
			widget.properties[name].get()
			count++
		}
	}
	return count
}

function oneRun(profile, n) {
	const f = createFixture(treeOf(profile), n)
	// Warm-up: lets lazily created module-level state exist and the JIT settle before the baseline.
	const warm = f.compileValid()
	warm.createRuntime()
		.dispose()
	const h0 = heapUsedAfterGc()
	let bp = f.compileValid()
	const h1 = heapUsedAfterGc()
	let rt = bp.createRuntime()
	const h2 = heapUsedAfterGc()
	readAllProperties(rt, f)
	const h3 = heapUsedAfterGc()
	rt.dispose()
	const h4 = heapUsedAfterGc()
	rt = null
	bp = null
	const h5 = heapUsedAfterGc()
	return {
		blueprint: (h1 - h0) / n,
		runtime: (h2 - h1) / n,
		activated: (h3 - h2) / n,
		afterDispose: (h4 - h0) / n,
		afterDrop: (h5 - h0) / n,
		members: n,
	}
}

export const scenarios = [{
	id: 'memory.retained',
	area: 'core',
	kind: 'custom',
	jitless: false,
	summary: 'Retained heap per widget for a Blueprint, a Runtime, and a Runtime with every Property evaluated; leak check after dispose.',
	inside: 'n/a (heap measurement)',
	outside: 'the shared source document',
	async execute({ log }) {
		const rows = []
		for (const [name, profile] of [['bare', PROFILES.bare], ['standard', PROFILES.standard], ['crossDeps', PROFILES.crossDeps]]) {
			for (const n of [1000, 4000, 16000]) {
				const runs = [oneRun(profile, n), oneRun(profile, n), oneRun(profile, n)]
				const pick = key => median(runs.map(r => r[key]))
				const range = key => `${Math.round(Math.min(...runs.map(r => r[key])))}..${Math.round(Math.max(...runs.map(r => r[key])))}`
				rows.push([
					name,
					n,
					Math.round(pick('blueprint')),
					range('blueprint'),
					Math.round(pick('runtime')),
					range('runtime'),
					Math.round(pick('activated')),
					Math.round(pick('afterDispose')),
					Math.round(pick('afterDrop')),
				])
				log(`  ${name} @${n}: blueprint ${Math.round(pick('blueprint'))} B/widget, runtime ${Math.round(pick('runtime'))} B/widget`)
			}
		}
		return {
			title: 'Retained heap per widget (bytes)',
			columns: ['profile', 'widgets', 'Blueprint B/w', 'range', 'Runtime B/w', 'range', '+ all Properties evaluated B/w', 'Blueprint+Runtime after dispose() B/w', 'after dropping refs B/w'],
			rows,
		}
	},
}]
