/**
 * Core: runtime scenarios. A Blueprint is compiled before the clock starts in every scenario here (except
 * where the variant says otherwise); the clock covers the Runtime operation only.
 */

import { createFixture, PROFILES } from '../lib/gen.mjs'
import { loadCore } from '../lib/load.mjs'
import { createStar, rootPlugin } from '../lib/star.mjs'
import { counter, freshBatch, SIZES, treeOf } from './common.mjs'

const core = await loadCore()
const { createWidgetPlugin, createWidgetSystem } = core

// ------------------------------------------------------------------------------------------------
// Small purpose-built systems
// ------------------------------------------------------------------------------------------------

/** One State `x`, then L Properties c0..c{L-1}, each depending on the previous one. */
function createChain(length) {
	const chain = createWidgetPlugin('chain')
		.description('chain')
		.interfaces()
		.state(s => s.x({ validate: v => typeof v === 'number', default: () => 0 }))
		.properties((s) => {
			let t = s
			for (let i = 0; i < length; i++) {
				t = t[`c${i}`]({
					registerDeps: ({ dep }) => ({ prev: i === 0 ? dep.self.state.get('x') : dep.self.properties.get(`c${i - 1}`) }),
					compute: ({ deps }) => {
						const r = deps.prev()
						return r.ok ? r.value + 1 : 0
					},
				})
			}
			return t
		})
		.done()
	const system = createWidgetSystem({ plugins: [chain] })
	const blueprint = system.createBlueprint({ id: 'c', type: 'chain' })
	if (blueprint.status !== 'valid')
		throw new Error('chain fixture invalid')
	return { blueprint, last: `c${length - 1}` }
}

/** N `checked` widgets whose State reports a diagnostic for a negative value. */
function createChecked(n) {
	const checked = createWidgetPlugin('checked')
		.description('checked')
		.interfaces()
		.state(s => s.v({
			validate: (input, ctx) => {
				if (typeof input !== 'number')
					return false
				if (input < 0)
					ctx.addDiagnostic({ message: 'negative' })
				return input >= 0
			},
			default: () => 0,
		}))
		.done()
	const system = createWidgetSystem({ plugins: [rootPlugin, checked] })
	const children = []
	for (let i = 0; i < n; i++)
		children.push({ id: `w${i}`, type: 'checked' })
	const blueprint = system.createBlueprint({ id: 'root', type: 'root', slots: { children } })
	if (blueprint.status !== 'valid')
		throw new Error('checked fixture invalid')
	return { blueprint, runtime: blueprint.createRuntime() }
}

// ------------------------------------------------------------------------------------------------
// Standard runtime fixture helpers
// ------------------------------------------------------------------------------------------------

function standard(n, profile = PROFILES.standard, extra = {}) {
	const f = createFixture(treeOf(profile, extra), n)
	const blueprint = f.compileValid()
	return { f, blueprint }
}

function unitWidgets(runtime, f, selector) {
	const out = []
	for (const id of f.unitIds())
		out.push(runtime.getWidget(id))
	return selector ? out.map(selector) : out
}

function middleUnit(f) {
	const ids = f.unitIds()
	return ids[Math.floor(ids.length / 2)]
}

// ------------------------------------------------------------------------------------------------

export const scenarios = [
	{
		id: 'runtime.create',
		perWidget: true,
		area: 'core',
		jitless: true,
		alloc: true,
		summary: 'blueprint.createRuntime() for an N-widget Blueprint.',
		inside: 'one blueprint.createRuntime(options) call',
		outside: 'compiling the Blueprint (once per size); disposing each Runtime afterwards',
		variants: [
			['bare', PROFILES.bare, false],
			['standard', PROFILES.standard, false],
			['crossDeps', PROFILES.crossDeps, false],
			['standard.overrides', PROFILES.standard, true],
		].map(([name, profile, withOverrides]) => ({
			name,
			sizes: SIZES,
			note: withOverrides ? 'overrideStateDefaults sets s0 and s1 of every unit' : undefined,
			setup(n) {
				const { f, blueprint } = standard(n, profile)
				let options
				if (withOverrides) {
					const overrideStateDefaults = {}
					for (const id of f.unitIds())
						overrideStateDefaults[id] = { s0: 7, s1: 9 }
					options = { overrideStateDefaults }
				}
				return {
					maxBatch: freshBatch(n),
					run: () => blueprint.createRuntime(options),
					after: (_, runtime) => runtime.dispose(),
				}
			},
		})),
	},
	{
		id: 'runtime.dispose',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'runtime.dispose() on an N-widget Runtime.',
		inside: 'one runtime.dispose() call',
		outside: 'compiling and creating the Runtime (a fresh Runtime per call)',
		variants: [{
			name: 'plain',
			note: 'a Runtime nobody subscribed to; the cost does not depend on N, so there is no per-widget column',
			perWidget: false,
			sizes: SIZES,
			setup(n) {
				const { blueprint } = standard(n)
				return { maxBatch: freshBatch(n), fresh: () => blueprint.createRuntime(), run: runtime => runtime.dispose() }
			},
		}, {
			name: 'subscribed',
			note: 'every unit: s0 State listener and ps0 Property listener; plus runtime diagnostics and disposal listeners',
			sizes: SIZES,
			setup(n) {
				const { f, blueprint } = standard(n)
				const noop = () => {}
				return {
					maxBatch: freshBatch(n),
					fresh() {
						const runtime = blueprint.createRuntime()
						for (const id of f.unitIds()) {
							const widget = runtime.getWidget(id)
							widget.state.s0.subscribe(noop)
							widget.properties.ps0.subscribe(noop)
						}
						runtime.subscribeDiagnostics(noop)
						runtime.subscribeDisposal(noop)
						return runtime
					},
					run: runtime => runtime.dispose(),
				}
			},
		}],
	},
	{
		id: 'runtime.state.set',
		area: 'core',
		jitless: true,
		alloc: true,
		summary: 'One State write with K dependents (a star: K follower widgets whose Property reads the written State).',
		inside: 'one `src.state.v.set(value)` (a different value each time) [+ the reads the variant names]',
		outside: 'compile, runtime creation, subscribing',
		variants: [
			{
				name: 'property-subscribed',
				note: 'all K follower Properties subscribed: every write recomputes and notifies K',
				sizeLabel: 'K dependents',
				perWidget: true,
				sizes: [0, 10, 100, 1000, 10000],
				setup(k) {
					const star = createStar(k)
					const noop = () => {}
					for (const p of star.followerProps)
						p.subscribe(noop)
					const next = counter()
					return { run: () => star.src.state.v.set(next()) }
				},
			},
			{
				name: 'nobody-subscribed',
				note: 'K follower Properties exist, none read or subscribed',
				sizeLabel: 'K dependents',
				sizes: [0, 10, 100, 1000, 10000],
				setup(k) {
					const star = createStar(k)
					const next = counter()
					return { run: () => star.src.state.v.set(next()) }
				},
			},
			{
				name: 'write-then-read-all',
				note: 'nobody subscribed; each run writes, then reads all K follower Properties (lazy recompute)',
				perWidget: true,
				sizeLabel: 'K dependents',
				sizes: [0, 10, 100, 1000, 10000],
				setup(k) {
					const star = createStar(k)
					const next = counter()
					const props = star.followerProps
					return {
						run() {
							star.src.state.v.set(next())
							let total = 0
							for (let i = 0; i < props.length; i++)
								total += props[i].get().value
							return total
						},
					}
				},
			},
			{
				name: 'state-listeners',
				note: 'K State listeners on the written member',
				perWidget: true,
				sizeLabel: 'K listeners',
				sizes: [0, 10, 100, 1000, 10000],
				setup(k) {
					const star = createStar(0)
					const noop = () => {}
					for (let i = 0; i < k; i++)
						star.src.state.v.subscribe(noop)
					const next = counter()
					return { run: () => star.src.state.v.set(next()) }
				},
			},
			{
				name: 'same-value',
				note: 'writing the value the State already holds, K Properties subscribed: no propagation expected',
				sizeLabel: 'K dependents',
				sizes: [10, 1000],
				setup(k) {
					const star = createStar(k)
					const noop = () => {}
					for (const p of star.followerProps)
						p.subscribe(noop)
					star.src.state.v.set(5)
					return { run: () => star.src.state.v.set(5) }
				},
			},
		],
	},
	{
		id: 'runtime.property.get',
		area: 'core',
		jitless: true,
		alloc: true,
		summary: 'Property reads: first (cold) read, cached read, recompute after a write, and a chain of L dependent Properties.',
		inside: 'the reads named by the variant (for `cold.all-units-ps0` that includes the runtime.getWidget(id) lookups: on a fresh Runtime they are part of the cold cost)',
		outside: 'compile, Runtime creation (a fresh Runtime per call for `cold`), the write that invalidates (`invalidated.one` and `chain.recompute` include it by design, see note)',
		variants: [
			{
				name: 'cold.all-units-ps0',
				note: 'first read of ps0 on every unit of a fresh Runtime; per-op = per Property',
				sizes: SIZES,
				setup(n) {
					const { f, blueprint } = standard(n)
					const ids = f.unitIds()
					return {
						ops: ids.length,
						maxBatch: freshBatch(n),
						fresh: () => blueprint.createRuntime(),
						run(runtime) {
							let total = 0
							for (let i = 0; i < ids.length; i++)
								total += runtime.getWidget(ids[i]).properties.ps0.get().value
							return total
						},
						after: runtime => runtime.dispose(),
					}
				},
			},
			{
				name: 'warm.all-units-ps0',
				note: 'CACHE HIT: reading an already evaluated Property again; per-op = per read',
				sizes: SIZES,
				setup(n) {
					const { f, blueprint } = standard(n)
					const runtime = blueprint.createRuntime()
					const props = unitWidgets(runtime, f, w => w.properties.ps0)
					for (const p of props)
						p.get()
					return {
						ops: props.length,
						warmPass: true,
						run() {
							let total = 0
							for (let i = 0; i < props.length; i++)
								total += props[i].get().value
							return total
						},
					}
				},
			},
			{
				name: 'invalidated.one',
				note: 'write one State, then read the one Property that depends on it (recompute); size = widgets in the Runtime',
				sizes: SIZES,
				setup(n) {
					const { f, blueprint } = standard(n)
					const runtime = blueprint.createRuntime()
					const widget = runtime.getWidget(middleUnit(f))
					widget.properties.ps0.get()
					const next = counter()
					return {
						run() {
							widget.state.s0.set(next())
							return widget.properties.ps0.get()
						},
					}
				},
			},
			...[true, false].map(recompute => ({
				name: recompute ? 'chain.recompute' : 'chain.warm',
				note: recompute
					? 'write x, then read the LAST of L chained Properties: L recomputations per run'
					: 'CACHE HIT: read the last Property of a warm chain',
				sizeLabel: 'chain length L',
				// A cached read of the last Property does not depend on L, so only the recompute variant has a per-link figure.
				perWidget: recompute,
				sizes: [10, 100, 500, 1000],
				setup(length) {
					const { blueprint, last } = createChain(length)
					const runtime = blueprint.createRuntime()
					const widget = runtime.getWidget('c')
					widget.properties[last].get()
					const next = counter()
					return recompute
						? {
								run: () => {
									widget.state.x.set(next())
									return widget.properties[last].get()
								},
							}
						: { warmPass: true, run: () => widget.properties[last].get() }
				},
			})),
			{
				name: 'chain.cold',
				note: 'first read of the last Property of a chain on a fresh Runtime (L Properties materialized and evaluated)',
				sizeLabel: 'chain length L',
				perWidget: true,
				sizes: [10, 100, 500, 1000],
				setup(length) {
					const { blueprint, last } = createChain(length)
					return {
						maxBatch: 4,
						fresh: () => blueprint.createRuntime(),
						run: runtime => runtime.getWidget('c').properties[last].get(),
						after: runtime => runtime.dispose(),
					}
				},
			},
		],
	},
	{
		id: 'runtime.method.invoke',
		area: 'core',
		jitless: true,
		alloc: true,
		summary: 'Method invocation on one unit of an N-widget Runtime (the size column is N; cost should not depend on it).',
		inside: 'one `widget.methods.<name>(...)` call',
		outside: 'compile, Runtime creation, subscribing',
		variants: (() => {
			const sizes = [100, 1000, 4000]
			const make = (name, note, prepare) => ({
				name,
				note,
				sizes,
				setup(n) {
					const { f, blueprint } = standard(n)
					const runtime = blueprint.createRuntime()
					const ids = f.unitIds()
					const widget = runtime.getWidget(ids[Math.floor(ids.length / 2)])
					const next = counter()
					return prepare({ runtime, widget, ids, next, f })
				},
			})
			return [
				make('noop', 'no dependencies', ({ widget }) => ({ run: () => widget.methods.noop() })),
				make('rw', 'reads s0 and s1, writes s2 through registered dependencies; every call writes a DIFFERENT value (the argument is added to the written value)', ({ widget, next }) => {
					// Guard against measuring the no-change write path: an s2 listener must fire on every call.
					let fired = 0
					const unsubscribe = widget.state.s2.subscribe(() => {
						fired++
					})
					for (let i = 1; i <= 3; i++) {
						widget.methods.rw(next())
						if (fired !== i)
							throw new Error(`rw did not change s2 on call ${i}: the s2 listener fired ${fired} times`)
					}
					unsubscribe()
					return { run: () => widget.methods.rw(next()) }
				}),
				make('invokeSelf', 'invokes another Method and reads a Property', ({ widget }) => {
					widget.properties.ps0.get()
					return { run: () => widget.methods.invokeSelf() }
				}),
				make('emit.0-listeners', 'writes s0 and emits an Event nobody listens to', ({ widget, next }) => ({ run: () => widget.methods.emit(next()) })),
				make('emit.1-listener', 'same, one Event listener', ({ widget, next }) => {
					widget.events.changed.subscribe(() => {})
					return { run: () => widget.methods.emit(next()) }
				}),
				make('emit.10-listeners', 'same, ten Event listeners', ({ widget, next }) => {
					for (let i = 0; i < 10; i++)
						widget.events.changed.subscribe(() => {})
					return { run: () => widget.methods.emit(next()) }
				}),
				make('emit.dependents-subscribed', 'emit writes s0 while ps0 of this unit and pw0 of the unit that depends on it are subscribed', ({ runtime, widget, ids, next }) => {
					widget.properties.ps0.subscribe(() => {})
					const index = ids.indexOf(widget.id)
					runtime.getWidget(ids[(index - 1 + ids.length) % ids.length]).properties.pw0.subscribe(() => {})
					return { run: () => widget.methods.emit(next()) }
				}),
				make('invalid-args', 'validateArgs rejects: the failure path', ({ widget }) => ({ run: () => widget.methods.emit('x') })),
			]
		})(),
	},
	{
		id: 'runtime.subscribe.churn',
		area: 'core',
		jitless: true,
		summary: 'subscribe + unsubscribe pairs on one widget of an N-widget Runtime (size column is N).',
		inside: 'one subscribe call plus its unsubscribe',
		outside: 'compile, Runtime creation',
		variants: (() => {
			const noop = () => {}
			// `evaluations` (the two Property variants): the number of ps0 evaluations one iteration must cause.
			// It is checked on a separate 100-widget fixture whose ps0 counts its evaluations (the measured
			// fixtures carry no counter).
			function verifyEvaluations(name, pick, expected) {
				let evaluations = 0
				const { f, blueprint } = standard(100, PROFILES.standard, { onEvaluate: () => evaluations++ })
				const runtime = blueprint.createRuntime()
				const widget = runtime.getWidget(middleUnit(f))
				widget.properties.ps0.get()
				const subscribe = pick(runtime, widget)
				const iterations = 5
				// The first iteration finds the Property clean (it was just read); from the second on it is dirty.
				subscribe(noop)()
				evaluations = 0
				for (let i = 0; i < iterations; i++)
					subscribe(noop)()
				runtime.dispose()
				if (evaluations !== expected * iterations)
					throw new Error(`runtime.subscribe.churn / ${name}: expected ${expected} Property evaluation(s) per iteration, saw ${evaluations / iterations}`)
			}
			const make = (name, pick, note, evaluations) => ({
				name,
				note,
				sizes: [100, 1000, 4000],
				setup(n) {
					if (evaluations !== undefined)
						verifyEvaluations(name, pick, evaluations)
					const { f, blueprint } = standard(n)
					const runtime = blueprint.createRuntime()
					const widget = runtime.getWidget(middleUnit(f))
					widget.properties.ps0.get()
					const subscribe = pick(runtime, widget)
					return { dispose: () => runtime.dispose(), run: () => subscribe(noop)() }
				},
			})
			return [
				make('state', (_, w) => w.state.s0.subscribe),
				make('property', (_, w) => w.properties.ps0.subscribe, 'Property already evaluated; when the LAST subscriber leaves, the Property is marked dirty, so every iteration includes one Property re-evaluation (verified in setup; compare property.watched)', 1),
				make('property.watched', (_, w) => {
					// A second, permanent subscriber keeps the Property watched, so the churning subscription never
					// makes it dirty: the row is the subscription cost alone.
					w.properties.ps0.subscribe(noop)
					return w.properties.ps0.subscribe
				}, 'a second permanent subscriber keeps the Property watched: no re-evaluation per iteration (verified in setup), the subscription cost alone', 0),
				make('event', (_, w) => w.events.changed.subscribe),
				make('state.diagnostics', (_, w) => w.state.s0.subscribeDiagnostics),
				make('widget.diagnostics', (_, w) => w.subscribeDiagnostics),
				make('runtime.diagnostics', r => r.subscribeDiagnostics),
				make('disposal', r => r.subscribeDisposal),
			]
		})(),
	},
	{
		id: 'runtime.diagnostics',
		area: 'core',
		jitless: true,
		summary: 'Runtime diagnostic aggregate on N `checked` widgets while members fail and recover.',
		inside: 'the writes and reads named by the variant',
		outside: 'compile, Runtime creation, priming (initial failing widgets)',
		variants: [
			{
				name: 'get.unchanged',
				note: 'CACHE HIT: getDiagnostics() when nothing changed',
				sizes: SIZES,
				setup(n) {
					const { runtime } = createChecked(n)
					runtime.getDiagnostics()
					return { warmPass: true, run: () => runtime.getDiagnostics() }
				},
			},
			{
				name: 'write-then-get',
				note: 'one widget alternates failing/recovering; each run writes, then reads getDiagnostics() (no subscriber)',
				sizes: SIZES,
				setup(n) {
					const { runtime } = createChecked(n)
					const widget = runtime.getWidget(`w${n >> 1}`)
					let bad = false
					return {
						run() {
							bad = !bad
							widget.state.v.set(bad ? -1 : 1)
							return runtime.getDiagnostics()
						},
					}
				},
			},
			{
				name: 'subscribed.fail-recover',
				note: 'root subscribeDiagnostics listener; one run = one failing write + one recovering write (ops = 2)',
				sizes: SIZES,
				setup(n) {
					const { runtime } = createChecked(n)
					let seen = 0
					runtime.subscribeDiagnostics((diagnostics) => {
						seen += diagnostics.length
					})
					const widget = runtime.getWidget(`w${n >> 1}`)
					return {
						ops: 2,
						run() {
							widget.state.v.set(-1)
							widget.state.v.set(1)
							return seen
						},
					}
				},
			},
			{
				name: 'subscribed.10pct-failing',
				note: 'as above, but 10% of the widgets are already failing, so every published snapshot carries N/10 diagnostics',
				sizes: SIZES,
				setup(n) {
					const { runtime } = createChecked(n)
					for (let i = 0; i < n; i += 10)
						runtime.getWidget(`w${i}`).state.v.set(-1)
					let seen = 0
					runtime.subscribeDiagnostics((diagnostics) => {
						seen += diagnostics.length
					})
					const widget = runtime.getWidget(`w${(n >> 1) | 1}`)
					return {
						ops: 2,
						run() {
							widget.state.v.set(-1)
							widget.state.v.set(1)
							return seen
						},
					}
				},
			},
			{
				name: 'widget.getDiagnostics',
				note: 'one widget, failing: the per-widget aggregate',
				sizes: [100, 1000, 4000],
				setup(n) {
					const { runtime } = createChecked(n)
					const widget = runtime.getWidget(`w${n >> 1}`)
					widget.state.v.set(-1)
					return { warmPass: true, run: () => widget.getDiagnostics() }
				},
			},
		],
	},
	{
		id: 'runtime.reset',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'runtime.resetState() on an N-widget Runtime.',
		inside: 'one resetState() call',
		outside: 'the writes that dirty the Runtime beforehand (one batch of 1 per sample, so every sample resets freshly dirtied State)',
		variants: [
			{
				name: 'dirty',
				note: 'every unit s0 written before each call',
				sizes: SIZES,
				setup(n) {
					const { f, blueprint } = standard(n)
					const runtime = blueprint.createRuntime()
					const states = unitWidgets(runtime, f, w => w.state.s0)
					const next = counter(100)
					return {
						maxBatch: 1,
						fresh() {
							const v = next()
							for (const s of states)
								s.set(v)
						},
						run: () => runtime.resetState(),
					}
				},
			},
			{
				name: 'dirty.subscribed',
				note: 'as dirty, with a State listener and a ps0 Property listener on every unit',
				sizes: SIZES,
				setup(n) {
					const { f, blueprint } = standard(n)
					const runtime = blueprint.createRuntime()
					const noop = () => {}
					const units = unitWidgets(runtime, f)
					for (const w of units) {
						w.state.s0.subscribe(noop)
						w.properties.ps0.subscribe(noop)
					}
					const states = units.map(w => w.state.s0)
					const next = counter(100)
					return {
						maxBatch: 1,
						fresh() {
							const v = next()
							for (const s of states)
								s.set(v)
						},
						run: () => runtime.resetState(),
					}
				},
			},
			{
				name: 'clean',
				note: 'nothing was written since creation',
				sizes: SIZES,
				setup(n) {
					const { blueprint } = standard(n)
					const runtime = blueprint.createRuntime()
					return { run: () => runtime.resetState() }
				},
			},
		],
	},
	{
		id: 'runtime.snapshot',
		perWidget: true,
		area: 'core',
		jitless: true,
		summary: 'runtime.snapshotState() on an N-widget Runtime.',
		inside: 'one snapshotState() call',
		outside: 'compile, Runtime creation',
		variants: [{
			name: 'default',
			sizes: SIZES,
			setup(n) {
				const { blueprint } = standard(n)
				const runtime = blueprint.createRuntime()
				return { warmPass: true, run: () => runtime.snapshotState() }
			},
		}],
	},
	{
		id: 'embedded.loop',
		area: 'core',
		jitless: true,
		alloc: true,
		summary: 'The embedded-host pattern: compile once; per input apply a few State values, invoke 3 Methods, read 4 Properties.',
		inside: 'M = 10 inputs per run (per-op = per input), each input as described by the variant',
		outside: 'the one compile (except in compile-per-input, which is the no-reuse reference and uses M = 2)',
		note: 'the input values are a function of the input index alone; set-up checks that every variant gives the same 3 Method results and 4 Property values as the reference for the same inputs (it throws otherwise)',
		variants: (() => {
			// Allocation mode uses two inputs per run so one window stays far below the semi-space.
			const inputsPerRun = mode => (mode === 'alloc' ? 2 : 10)
			// Every per-input value is a function of the input index alone (never of a shared counter), so all
			// variants receive identical inputs and must produce identical results.
			const CHECKED_INPUTS = 10
			const emitValue = i => 1000 + i
			/**
			 * The Method calls and Property reads of one input. Returns the sum of the four Property values (the
			 * timed regions keep only that); with a `trace` array it also records every Method result and every
			 * Property value, which the set-up uses to compare the variants.
			 */
			function actions(runtime, ids, i, trace) {
				const a = runtime.getWidget(ids[0])
				const b = runtime.getWidget(ids[1])
				const c = runtime.getWidget(ids[2])
				const rw = a.methods.rw()
				const emit = b.methods.emit(emitValue(i))
				const invokeSelf = c.methods.invokeSelf()
				const p0 = a.properties.ps0.get().value
				const p1 = b.properties.ps0.get().value
				const p2 = a.properties.pw0.get().value
				const p3 = b.properties.pp0.get().value
				if (trace !== undefined)
					trace.push(JSON.stringify(rw), JSON.stringify(emit), JSON.stringify(invokeSelf), p0, p1, p2, p3)
				return p0 + p1 + p2 + p3
			}
			function makeOverrides(ids, i) {
				const overrideStateDefaults = {}
				for (let k = 0; k < 5; k++)
					overrideStateDefaults[ids[k]] = { s0: i + k, s1: i }
				return { overrideStateDefaults }
			}
			function applyByWrite(runtime, ids, i) {
				for (let k = 0; k < 5; k++) {
					const w = runtime.getWidget(ids[k])
					w.state.s0.set(i + k)
					w.state.s1.set(i)
				}
			}
			// The per-input logic of each variant, shared by the timed region and the set-up check.
			const logic = {
				createOverrides(blueprint, ids, i, trace) {
					const runtime = blueprint.createRuntime(makeOverrides(ids, i))
					const total = actions(runtime, ids, i, trace)
					runtime.dispose()
					return total
				},
				createWrites(blueprint, ids, i, trace) {
					const runtime = blueprint.createRuntime()
					applyByWrite(runtime, ids, i)
					const total = actions(runtime, ids, i, trace)
					runtime.dispose()
					return total
				},
				reuse(runtime, ids, i, trace) {
					runtime.resetState()
					applyByWrite(runtime, ids, i)
					return actions(runtime, ids, i, trace)
				},
				compile(f, ids, i, trace) {
					const blueprint = f.system.createBlueprint(f.source)
					const runtime = blueprint.createRuntime(makeOverrides(ids, i))
					const total = actions(runtime, ids, i, trace)
					runtime.dispose()
					return total
				},
			}
			// The reference results for inputs 0..CHECKED_INPUTS-1 (made by the simplest path), per document size.
			const references = new Map()
			function reference(n, blueprint, ids) {
				if (!references.has(n)) {
					const traces = []
					for (let i = 0; i < CHECKED_INPUTS; i++) {
						const trace = []
						logic.createOverrides(blueprint, ids, i, trace)
						traces.push(trace)
					}
					references.set(n, traces)
				}
				return references.get(n)
			}
			/** Throws unless `step(i, trace)` gives the reference results for inputs 0..count-1. */
			function assertSameWork(name, n, blueprint, ids, count, step) {
				const expected = reference(n, blueprint, ids)
				for (let i = 0; i < count; i++) {
					const trace = []
					step(i, trace)
					if (trace.length !== expected[i].length || trace.some((value, k) => value !== expected[i][k]))
						throw new Error(`embedded.loop / ${name} does not do the same work as the reference on input ${i}: [${trace}] vs [${expected[i]}]`)
				}
			}
			return [
				{
					name: 'create-per-input.overrides',
					note: 'createRuntime({ overrideStateDefaults }) + actions + dispose, per input',
					sizes: [100, 1000, 4000],
					setup(n, { mode }) {
						const M = inputsPerRun(mode)
						const { f, blueprint } = standard(n)
						const ids = f.unitIds()
						assertSameWork('create-per-input.overrides', n, blueprint, ids, CHECKED_INPUTS, (i, trace) => logic.createOverrides(blueprint, ids, i, trace))
						return {
							ops: M,
							run() {
								let total = 0
								for (let i = 0; i < M; i++)
									total += logic.createOverrides(blueprint, ids, i)
								return total
							},
						}
					},
				},
				{
					name: 'create-per-input.writes',
					note: 'createRuntime() + State writes + actions + dispose, per input',
					sizes: [100, 1000, 4000],
					setup(n, { mode }) {
						const M = inputsPerRun(mode)
						const { f, blueprint } = standard(n)
						const ids = f.unitIds()
						assertSameWork('create-per-input.writes', n, blueprint, ids, CHECKED_INPUTS, (i, trace) => logic.createWrites(blueprint, ids, i, trace))
						return {
							ops: M,
							run() {
								let total = 0
								for (let i = 0; i < M; i++)
									total += logic.createWrites(blueprint, ids, i)
								return total
							},
						}
					},
				},
				{
					name: 'reuse.resetState',
					note: 'one Runtime kept: resetState() + State writes + actions, per input',
					sizes: [100, 1000, 4000],
					setup(n, { mode }) {
						const M = inputsPerRun(mode)
						const { f, blueprint } = standard(n)
						const ids = f.unitIds()
						const runtime = blueprint.createRuntime()
						assertSameWork('reuse.resetState', n, blueprint, ids, CHECKED_INPUTS, (i, trace) => logic.reuse(runtime, ids, i, trace))
						return {
							ops: M,
							dispose: () => runtime.dispose(),
							run() {
								let total = 0
								for (let i = 0; i < M; i++)
									total += logic.reuse(runtime, ids, i)
								return total
							},
						}
					},
				},
				{
					name: 'compile-per-input',
					note: 'NO reuse: system.createBlueprint + createRuntime(overrides) + actions + dispose, per input (M = 2)',
					sizes: [100, 1000, 4000],
					setup(n) {
						const { f, blueprint } = standard(n)
						const ids = f.unitIds()
						assertSameWork('compile-per-input', n, blueprint, ids, 2, (i, trace) => logic.compile(f, ids, i, trace))
						return {
							ops: 2,
							run() {
								let total = 0
								for (let i = 0; i < 2; i++)
									total += logic.compile(f, ids, i)
								return total
							},
						}
					},
				},
			]
		})(),
	},
]
