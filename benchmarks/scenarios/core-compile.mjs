/**
 * Core: authoring and compile scenarios.
 *
 * Every scenario says what is inside and outside the timed region. In short: documents, Systems and plugins
 * are built before the clock starts; the clock covers exactly one call of the public entry point named by
 * the scenario. Anything the library caches per input (inspection facades) gets a fresh input per call.
 */

import { createFixture, createInvalidFixture, PROFILES } from '../lib/gen.mjs'
import { loadCore, loadCoreInspection } from '../lib/load.mjs'
import { counter, freshBatch, SIZES, treeOf } from './common.mjs'

const core = await loadCore()
const { createWidgetDocument, createWidgetPlugin, createWidgetSystem, normalizeSeparatedWidgetSource, separateWidgetSource } = core

/** `P` distinct trivial plugins, so createWidgetSystem has something to register. */
function makePlugins(count) {
	const plugins = []
	for (let i = 0; i < count; i++) {
		plugins.push(createWidgetPlugin(`p${i}`)
			.description('Synthetic plugin')
			.interfaces()
			.state(s => s.a({ validate: v => typeof v === 'number', default: () => 0 })
				.b({ validate: v => typeof v === 'number' }))
			.properties(p => p.c({ registerDeps: ({ dep }) => dep.self.state.get('a'), compute: ({ deps }) => deps().ok ? 1 : 0 }))
			.methods(m => m.d({ validateArgs: a => a.length === 0, execute: () => 0 }))
			.events(e => e.changed({ description: 'changed' }))
			.done())
	}
	return plugins
}

/** Number of widgets in a (nested, authored) source tree; iterative, so a deep document cannot overflow the stack. */
function countWidgets(source) {
	let count = 0
	const stack = [source]
	while (stack.length > 0) {
		const node = stack.pop()
		count++
		for (const child of node.slots?.children ?? [])
			stack.push(child)
	}
	return count
}

/** Asserts (once, in set-up) that a Blueprint is invalid with exactly `expected` `duplicate-widget-id` diagnostics. */
function assertDuplicateIds(blueprint, expected, what) {
	const duplicates = blueprint.diagnostics.filter(d => d.code === 'duplicate-widget-id').length
	if (blueprint.status !== 'invalid' || duplicates !== expected)
		throw new Error(`${what}: expected an invalid Blueprint with ${expected} duplicate-widget-id diagnostics, got ${blueprint.status} with ${duplicates}`)
}

function compileVariants(label, entries) {
	return entries.map(([name, profile, shape]) => ({
		name,
		sizes: SIZES,
		note: label,
		setup(n) {
			const fixture = createFixture({ ...profile, shape }, n)
			fixture.compileValid()
			return {
				run: () => fixture.system.createBlueprint(fixture.source),
			}
		},
	}))
}

export const scenarios = [
	{
		id: 'system.create',
		perWidget: true,
		area: 'core',
		jitless: true,
		alloc: false,
		summary: 'createWidgetSystem({ plugins }) with P registered plugins.',
		inside: 'the createWidgetSystem call (plugin registry validation, catalog)',
		outside: 'building the P plugins',
		variants: [{
			name: 'plugins',
			sizeLabel: 'plugins',
			sizes: [2, 10, 50, 200, 1000],
			setup(p) {
				const plugins = makePlugins(p)
				return { run: () => createWidgetSystem({ plugins }) }
			},
		}],
	},
	{
		id: 'plugin.create',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'The plugin builder chain (state/properties/methods) to done(), with M members per section.',
		inside: 'the builder chain from createWidgetPlugin to done() (definition capture and validation)',
		outside: 'nothing; the member definitions are closures built once',
		variants: [{
			name: 'members',
			sizeLabel: 'members per section',
			sizes: [3, 30, 300],
			setup(m) {
				const stateDef = { validate: v => typeof v === 'number', default: () => 0 }
				const propDef = { compute: () => 1 }
				const methodDef = { validateArgs: a => a.length === 0, execute: () => 0 }
				return {
					run: () => createWidgetPlugin('x')
						.description('x')
						.interfaces()
						.state((s) => {
							let t = s
							for (let i = 0; i < m; i++)
								t = t[`s${i}`](stateDef)
							return t
						})
						.properties((s) => {
							let t = s
							for (let i = 0; i < m; i++)
								t = t[`p${i}`](propDef)
							return t
						})
						.methods((s) => {
							let t = s
							for (let i = 0; i < m; i++)
								t = t[`m${i}`](methodDef)
							return t
						})
						.done(),
				}
			},
		}],
	},
	{
		id: 'blueprint.compile.valid',
		perWidget: true,
		area: 'core',
		jitless: true,
		alloc: true,
		summary: 'system.createBlueprint(source) for a valid N-widget document; shapes and dependency mixes vary.',
		inside: 'one system.createBlueprint(source) call (recovery, identity, config, structure, dependency resolution, graph analysis)',
		outside: 'document generation, System and plugin construction. The same source object is reused (the library keeps no cache keyed by source; checked in README)',
		variants: compileVariants('flat = one root with N-1 children; tree = 8-ary; deep = 60-level spine with leaves hanging off it', [
			['flat.bare', PROFILES.bare, 'flat'],
			['flat.standard', PROFILES.standard, 'flat'],
			['tree.bare', PROFILES.bare, 'tree'],
			['tree.selfDeps', PROFILES.selfDeps, 'tree'],
			['tree.standard', PROFILES.standard, 'tree'],
			['tree.crossDeps', PROFILES.crossDeps, 'tree'],
			['tree.validated', PROFILES.validated, 'tree'],
			['tree.aggregated', PROFILES.aggregated, 'tree'],
			['deep.standard', PROFILES.standard, 'deep'],
		]),
	},
	{
		id: 'blueprint.compile.json',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'createBlueprintFromJson(text) against JSON.parse(text) + createBlueprint(value) (standard tree).',
		inside: 'the whole call chain named by the variant (for the parse variants this includes JSON.parse)',
		outside: 'JSON.stringify of the document',
		variants: [
			{
				name: 'fromJson',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const text = f.json
					return { run: () => f.system.createBlueprintFromJson(text) }
				},
			},
			{
				name: 'parse+create',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const text = f.json
					return { run: () => f.system.createBlueprint(JSON.parse(text)) }
				},
			},
			{
				name: 'parse-only',
				sizes: SIZES,
				note: 'reference: JSON.parse alone, the floor of both variants above',
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const text = f.json
					return { run: () => JSON.parse(text) }
				},
			},
		],
	},
	{
		id: 'blueprint.compile.invalid',
		perWidget: true,
		area: 'core',
		jitless: true,
		alloc: false,
		summary: 'Compiling documents with many diagnostics (about one per node), flat bare documents.',
		inside: 'one system.createBlueprint(source) call that ends invalid',
		outside: 'document generation',
		variants: [
			...['unknown-type', 'bad-config', 'unexpected-field', 'duplicate-id-pairs'].map(kind => ({
				name: kind,
				sizes: SIZES,
				setup(n) {
					const f = createInvalidFixture(kind, n)
					if (f.system.createBlueprint(f.source).status !== 'invalid')
						throw new Error('fixture should be invalid')
					return { run: () => f.system.createBlueprint(f.source) }
				},
			})),
			{
				name: 'duplicate-id-one',
				note: 'ALL N nodes share ONE id (the known quadratic path; 16000 is left out on purpose: it exhausts the default 4 GB heap, see README)',
				sizes: [100, 500, 1000, 2000, 4000],
				setup(n) {
					const f = createInvalidFixture('duplicate-id-one', n)
					assertDuplicateIds(f.system.createBlueprint(f.source), n, 'duplicate-id-one')
					return { run: () => f.system.createBlueprint(f.source) }
				},
			},
			{
				name: 'duplicate-id-one.k',
				note: 'N = 4000 nodes total, K of them share one id; the size column is K',
				sizeLabel: 'nodes sharing the id',
				perWidget: false,
				sizes: [2, 10, 100, 1000, 4000],
				setup(k) {
					const f = createInvalidFixture('duplicate-id-one', 4000, { sharing: k })
					assertDuplicateIds(f.system.createBlueprint(f.source), k, 'duplicate-id-one.k')
					return { run: () => f.system.createBlueprint(f.source) }
				},
			},
		],
	},
	{
		id: 'document.patch',
		area: 'core',
		jitless: true,
		summary: 'The editor-keystroke path: WidgetDocument.applyPatch of one small edit on an N-widget standard tree.',
		inside: 'one document.applyPatch(patch) call: mechanical patch + (when it changes anything) a full recompile + commit',
		outside: 'document creation (its initial compile); for add/remove the opposite edit that restores the document runs outside the clock',
		note: '`noop` (an equal-value patch: it applies the patch but stops before recompiling) is the proxy for the cost of applying a patch; the public API does not allow separating patch application from the recompile in the other variants',
		variants: [
			{
				name: 'baseline.compile',
				note: 'system.createBlueprint(source) of the same document, for reference (the recompile that the changing patches below include)',
				perWidget: true,
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					return { run: () => f.system.createBlueprint(f.source) }
				},
			},
			{
				name: 'noop',
				note: 'replace a config value with an equal value: changed:false, no recompile, no notification',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const doc = createWidgetDocument({ system: f.system, source: f.source })
					const path = [...doc.getSnapshot().blueprint.getSourcePath(doc.getSnapshot().blueprint.getWidget('u0')), 'config', 'step']
					const patch = [{ op: 'replace', path, value: 1 }]
					return { run: () => doc.applyPatch(patch) }
				},
			},
			{
				name: 'replace-config',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const doc = createWidgetDocument({ system: f.system, source: f.source })
					const path = [...doc.getSnapshot().blueprint.getSourcePath(doc.getSnapshot().blueprint.getWidget('u0')), 'config', 'step']
					const next = counter(100)
					return { run: () => doc.applyPatch([{ op: 'replace', path, value: next() }]) }
				},
			},
			{
				name: 'replace-config.subscribed',
				note: 'same, with 3 document subscribers',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const doc = createWidgetDocument({ system: f.system, source: f.source })
					for (let i = 0; i < 3; i++)
						doc.subscribe(() => {})
					const path = [...doc.getSnapshot().blueprint.getSourcePath(doc.getSnapshot().blueprint.getWidget('u0')), 'config', 'step']
					const next = counter(100)
					return { run: () => doc.applyPatch([{ op: 'replace', path, value: next() }]) }
				},
			},
			{
				name: 'add-widget',
				note: 'append one empty group under the root (JSON Pointer /slots/children/-)',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const doc = createWidgetDocument({ system: f.system, source: f.source })
					const rootChildren = f.layout.childCount[0]
					const next = counter(0)
					return {
						maxBatch: 1,
						run: () => doc.applyPatch([{ op: 'add', path: '/slots/children/-', value: { id: `x${next()}`, type: 'group', slots: { children: [] } } }]),
						after: () => doc.applyPatch([{ op: 'remove', path: `/slots/children/${rootChildren}` }]),
						// Every run() is undone by after(), so the document must end with exactly the N widgets it began with;
						// a harness that skipped after() would make it grow (and every sample slower than the last).
						dispose() {
							const snapshot = doc.getSnapshot()
							const widgets = countWidgets(snapshot.blueprint.source)
							if (snapshot.blueprint.status !== 'valid' || widgets !== n)
								throw new Error(`document.patch / add-widget ended with ${widgets} widgets (${snapshot.blueprint.status}), expected ${n}`)
						},
					}
				},
			},
			{
				name: 'remove-widget',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const doc = createWidgetDocument({ system: f.system, source: f.source })
					const rootChildren = f.layout.childCount[0]
					const next = counter(0)
					return {
						maxBatch: 1,
						fresh: () => doc.applyPatch([{ op: 'add', path: '/slots/children/-', value: { id: `x${next()}`, type: 'group', slots: { children: [] } } }]),
						run: () => doc.applyPatch([{ op: 'remove', path: `/slots/children/${rootChildren}` }]),
					}
				},
			},
		],
	},
	{
		id: 'separated.roundtrip',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'separateWidgetSource / normalizeSeparatedWidgetSource on an N-widget standard tree.',
		inside: 'the named call(s)',
		outside: 'document generation; for `normalize` the separation that produces its input',
		variants: [
			{
				name: 'separate',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					return { run: () => separateWidgetSource(f.source) }
				},
			},
			{
				name: 'normalize',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					const { separated } = separateWidgetSource(f.source)
					return { run: () => normalizeSeparatedWidgetSource(separated) }
				},
			},
			{
				name: 'roundtrip',
				sizes: SIZES,
				setup(n) {
					const f = createFixture(treeOf(PROFILES.standard), n)
					return { run: () => normalizeSeparatedWidgetSource(separateWidgetSource(f.source).separated) }
				},
			},
		],
	},
	{
		id: 'inspection.blueprint',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'inspectBlueprint(blueprint) over an N-widget standard tree (first call materializes the whole snapshot).',
		inside: 'one inspectBlueprint(blueprint) call on a Blueprint nobody has inspected',
		outside: 'compiling that Blueprint (a fresh one per call, because the facade is cached per Blueprint)',
		variants: [{
			name: 'cold',
			sizes: SIZES,
			setup: async (n) => {
				const { inspectBlueprint } = await loadCoreInspection()
				const f = createFixture(treeOf(PROFILES.standard), n)
				return {
					maxBatch: freshBatch(n),
					fresh: () => f.compileValid(),
					run: blueprint => inspectBlueprint(blueprint).nodes.length,
				}
			},
		}, {
			name: 'cached',
			note: 'CACHE HIT: reference, the second call (WeakMap hit); constant time, so no per-widget column',
			perWidget: false,
			sizes: SIZES,
			setup: async (n) => {
				const { inspectBlueprint } = await loadCoreInspection()
				const f = createFixture(treeOf(PROFILES.standard), n)
				const blueprint = f.compileValid()
				inspectBlueprint(blueprint)
				return { run: () => inspectBlueprint(blueprint) }
			},
		}],
	},
	{
		id: 'inspection.runtime',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'inspectRuntime(runtime) (the facade) and a walk over it: the `s0` snapshot of every unit (groups are not visited) over N widgets.',
		inside: 'the named call(s)',
		outside: 'compiling and creating the Runtime; for `facade` the Blueprint inspection is already cached on the shared Blueprint',
		variants: [{
			name: 'facade',
			note: 'the call wraps the already cached Blueprint inspection, so its work does not depend on N (no per-widget column); the Runtime is built outside the clock',
			perWidget: false,
			sizes: SIZES,
			setup: async (n) => {
				const { inspectBlueprint, inspectRuntime } = await loadCoreInspection()
				const f = createFixture(treeOf(PROFILES.standard), n)
				const blueprint = f.compileValid()
				inspectBlueprint(blueprint)
				return {
					maxBatch: freshBatch(n),
					fresh: () => blueprint.createRuntime(),
					run: runtime => inspectRuntime(runtime).blueprint.nodes.length,
					after: runtime => runtime.dispose(),
				}
			},
		}, {
			name: 'walk',
			note: 'getWidget + getState(s0).getSnapshot() for every unit; the first (cold) call creates the State facades (cached in Maps afterwards), so the samples are a repeated walk over cached facades, memory-bound at large N; the /unit column divides by N widgets, of which about 87.5% are units',
			sizes: SIZES,
			setup: async (n) => {
				const { inspectRuntime } = await loadCoreInspection()
				const f = createFixture(treeOf(PROFILES.standard), n)
				const blueprint = f.compileValid()
				const runtime = blueprint.createRuntime()
				const inspection = inspectRuntime(runtime)
				const ids = inspection.blueprint.nodes.filter(node => node.resolved && node.node.type === 'unit')
					.map(node => node.nodeId)
				for (const id of ids)
					inspection.getWidget(id)
				return {
					warmPass: true,
					run() {
						let total = 0
						for (const id of ids) {
							total += inspection.getWidget(id)
								.getState('s0')
								.getSnapshot().value
						}
						return total
					},
				}
			},
		}],
	},
]
