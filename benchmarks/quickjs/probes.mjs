/**
 * Stack-depth probes: one attempt builds a document with a long dependency chain and runs ONE named step on it
 * (`phase`, see probe-defs.mjs). Plain ECMAScript only. Each attempt runs in a process of its own (see run.mjs),
 * so an overflow, or a crash, never affects the next attempt.
 *
 * Shapes:
 *   chain   one widget, State `x`, then Properties p0 ... p{L-1}: `p{i}` reads `p{i+1}` and `p{L-1}` reads `x`; L counts
 *           Properties; the head is `p0`, which reads all the others. The head is declared FIRST on purpose: the
 *           compiler's cycle search used to visit members in declaration order and follow dependencies, so this order
 *           made its recursion as deep as the chain (declared tail first, the same chain still compiled at 65 536
 *           links, because every member's dependencies are already visited). The head reads `x + L`.
 *   survey  W flat `q` widgets; `q<k>.visible` reads `q<k+1>.value`, `q<k>.value` reads its own State and its own
 *           `visible` (the shape of a survey whose question visibility depends on the previous question); L counts
 *           widgets (2 Properties each); the head is `q0.value`. The cold-read probes use the survey as authored:
 *           `visible` is a boolean, so a write to the tail never changes the head. The teardown phases need a write
 *           that does reach the head, so they use the "live" variant, which has the same dependency edges and a
 *           numeric `visible`: `visible` is the next question's `value` (0 for the last one) and `value` is
 *           `answer + visible + 1`, so the head reads `W + answer of the last question`. Both variants read
 *           `visible` before the State.
 *
 * State-first variants, for the `rewrite-all` phase only: every Property reads a State of its own FIRST and its
 * dependency after it, so that once every State is written, every link of the chain is directly stale (each
 * re-evaluation finds its own State changed before it reaches the next link).
 *   chain   States s0 ... s{L-1}; `p{i}` reads `s{i}`, then `p{i+1}` (none for the last); `p{i}` is
 *           `s{i} + p{i+1} + 1`, so the head reads `L + the sum of the States`.
 *   survey  the "live" survey with `value` reading `answer` before `visible`; the head reads `W + the sum of the
 *           answers`.
 *
 * Phases (what the attempt does and what makes it succeed; every phase first needs a valid Blueprint):
 *   compile                    `createBlueprint` returns a valid Blueprint.
 *   evaluate                   a fresh Runtime, then a COLD read of the head returns ok with the expected value.
 *   warm-reread                a fresh Runtime; every Property is read from the tail to the head (each read is shallow
 *                              because its dependency is already cached; a wrong or failed value fails the attempt
 *                              at stage `warm`); then the tail State is written and the head is read: ok, and the
 *                              value reflects the write.
 *   unsubscribe                warm as above, then a listener is subscribed to the head and unsubscribed again.
 *   reread-after-unsubscribe   as `unsubscribe`, then the tail State is written and the head is read as in
 *                              `warm-reread`; the listener must not have been called.
 *   dispose                    warm as above, a listener is subscribed to the head, then `runtime.dispose()`.
 *   rewrite-all                the state-first variant: a fresh Runtime, a COLD read of the head, then two rounds of
 *                              "write every State (1, then 2), read the head"; every read returns ok with the
 *                              expected value (a failure in either round fails the attempt).
 *
 * A failure is detected in three ways, because Core isolates the exceptions of subscriptions and listeners (a throw
 * there is reported through `queueMicrotask` and never reaches the caller):
 *   - an exception thrown to the probe at any step;
 *   - a value read back that is not the expected one, or a failed result;
 *   - a report through `queueMicrotask`: while a teardown attempt runs, `globalThis.queueMicrotask` is replaced by a
 *     function that runs the callback at once and records what it throws (Core's only use of `queueMicrotask` is to
 *     rethrow an isolated exception). Any recorded exception fails the attempt (error name from the exception).
 */

import * as core from '@bench/core'

const { createWidgetPlugin, createWidgetSystem } = core

/** The value written to the tail State by the phases that write. */
const WRITTEN = 5

function describeError(error) {
	try {
		return {
			name: String(error?.name ?? typeof error),
			constructor: String(error?.constructor?.name ?? ''),
			message: String(error?.message ?? error)
				.slice(0, 300),
		}
	}
	catch {
		return { name: 'Unknown', constructor: '', message: 'unprintable error' }
	}
}

function buildChain(length, variant) {
	if (variant === 'state-first')
		return buildStateFirstChain(length)
	const plugin = createWidgetPlugin('chain')
		.description('chain')
		.interfaces()
		.state(s => s.x({ validate: v => typeof v === 'number', default: () => 0 }))
		.properties((s) => {
			let t = s
			for (let i = 0; i < length; i++) {
				t = t[`p${i}`]({
					registerDeps: ({ dep }) => ({ next: i === length - 1 ? dep.self.state.get('x') : dep.self.properties.get(`p${i + 1}`) }),
					compute: ({ deps }) => {
						const r = deps.next()
						return r.ok ? r.value + 1 : 0
					},
				})
			}
			return t
		})
		.done()
	return {
		plugins: [plugin],
		source: { id: 'c', type: 'chain' },
		head: runtime => runtime.getWidget('c').properties.p0,
		expected: length,
		expectedAfterWrite: length + WRITTEN,
		/** Reads p{L-1}, p{L-2}, ... p0: every read finds its dependency cached. */
		warm: (runtime) => {
			const properties = runtime.getWidget('c').properties
			for (let i = length - 1; i >= 0; i--)
				expectValue(properties[`p${i}`].get(), length - i, `p${i}`)
		},
		writeTail: runtime => runtime.getWidget('c').state.x.set(WRITTEN),
	}
}

/** The chain whose every Property reads a State of its own first (see the header); the head reads `L + sum of s{i}`. */
function buildStateFirstChain(length) {
	const plugin = createWidgetPlugin('chain')
		.description('chain')
		.interfaces()
		.state((s) => {
			let t = s
			for (let i = 0; i < length; i++)
				t = t[`s${i}`]({ validate: v => typeof v === 'number', default: () => 0 })
			return t
		})
		.properties((s) => {
			let t = s
			for (let i = 0; i < length; i++) {
				t = t[`p${i}`]({
					registerDeps: ({ dep }) => (i === length - 1
						? { own: dep.self.state.get(`s${i}`) }
						: { own: dep.self.state.get(`s${i}`), next: dep.self.properties.get(`p${i + 1}`) }),
					compute: ({ deps }) => {
						const own = deps.own()
						if (deps.next === undefined)
							return own.ok ? own.value + 1 : 0
						const r = deps.next()
						return own.ok && r.ok ? own.value + r.value + 1 : 0
					},
				})
			}
			return t
		})
		.done()
	return {
		plugins: [plugin],
		source: { id: 'c', type: 'chain' },
		head: runtime => runtime.getWidget('c').properties.p0,
		expected: length,
		writeAll: (runtime, value) => {
			const state = runtime.getWidget('c').state
			for (let i = 0; i < length; i++) {
				if (!state[`s${i}`].set(value).ok)
					throw Object.assign(new Error(`the write to s${i} was rejected`), { name: 'WriteRejected' })
			}
		},
		expectedAfterAll: value => length * (value + 1),
	}
}

function buildSurvey(widgets, variant) {
	const live = variant === 'live' || variant === 'state-first'
	const stateFirst = variant === 'state-first'
	const root = createWidgetPlugin('qroot')
		.description('survey root')
		.interfaces()
		.slots({ children: { description: 'questions' } })
		.done()
	const question = createWidgetPlugin('q')
		.description('survey question')
		.interfaces()
		.state(s => s.answer({ validate: v => typeof v === 'number', default: () => 0 }))
		.properties(s => s
			.visible({
				registerDeps: ({ widget, dep }) => {
					const next = Number(widget.id.slice(1)) + 1
					return next < widgets ? { next: dep.widget(`q${next}`).properties.get('value') } : {}
				},
				compute: live
					? ({ deps }) => {
							if (deps.next === undefined)
								return 0
							const next = deps.next()
							return next.ok ? next.value : 0
						}
					: ({ deps }) => (deps.next === undefined ? true : deps.next().ok),
			})
			.value({
				registerDeps: ({ dep }) => ({
					answer: dep.self.state.get('answer'),
					visible: dep.self.properties.get('visible'),
				}),
				compute: stateFirst
					? ({ deps }) => {
							const answer = deps.answer()
							const visible = deps.visible()
							return answer.ok && visible.ok ? answer.value + visible.value + 1 : 0
						}
					: live
						? ({ deps }) => {
								const visible = deps.visible()
								const answer = deps.answer()
								return answer.ok ? answer.value + (visible.ok ? visible.value : 0) + 1 : 0
							}
						: ({ deps }) => {
								const visible = deps.visible()
								const answer = deps.answer()
								return visible.ok && visible.value && answer.ok ? answer.value + 1 : 0
							},
			}))
		.done()
	const children = []
	for (let i = 0; i < widgets; i++)
		children.push({ id: `q${i}`, type: 'q' })
	return {
		plugins: [root, question],
		source: { id: 'root', type: 'qroot', slots: { children } },
		head: runtime => runtime.getWidget('q0').properties.value,
		expected: live ? widgets : 1,
		expectedAfterWrite: widgets + WRITTEN,
		/** Reads q{W-1}.value, q{W-2}.value, ... q0.value (each pulls in its own `visible`, whose dependency is cached). */
		warm: (runtime) => {
			for (let i = widgets - 1; i >= 0; i--)
				expectValue(runtime.getWidget(`q${i}`).properties.value.get(), widgets - i, `q${i}.value`)
		},
		writeTail: runtime => runtime.getWidget(`q${widgets - 1}`).state.answer.set(WRITTEN),
		writeAll: (runtime, value) => {
			for (let i = 0; i < widgets; i++) {
				if (!runtime.getWidget(`q${i}`).state.answer.set(value).ok)
					throw Object.assign(new Error(`the write to q${i}.answer was rejected`), { name: 'WriteRejected' })
			}
		},
		expectedAfterAll: value => widgets * (value + 1),
	}
}

const BUILDERS = { chain: buildChain, survey: buildSurvey }

const TEARDOWN_PHASES = new Set(['warm-reread', 'unsubscribe', 'reread-after-unsubscribe', 'dispose'])

/** Throws unless `result` is an ok result holding `expected`; a stack overflow inside a read arrives here as a wrong value. */
function expectValue(result, expected, what) {
	if (!result.ok) {
		const first = result.diagnostics?.[0]
		const error = new Error(`${what}: ${first?.code}: ${first?.message}`)
		error.name = 'PropertyFailure'
		throw error
	}
	if (result.value !== expected) {
		const error = new Error(`${what}: read ${result.value}, expected ${expected}`)
		error.name = 'WrongValue'
		throw error
	}
}

/** Core reports an isolated exception by rethrowing it from a microtask; run those callbacks at once and keep what they throw. */
function captureReportedExceptions() {
	const original = globalThis.queueMicrotask
	const reported = []
	globalThis.queueMicrotask = (callback) => {
		try {
			callback()
		}
		catch (error) {
			reported.push(error)
		}
	}
	return {
		reported,
		restore: () => {
			globalThis.queueMicrotask = original
		},
	}
}

/** The steps after a valid Blueprint of a teardown phase; `at(stage)` records where an exception thrown to us happened. */
function runTeardown(phase, fixture, blueprint, at, calls) {
	at('create-runtime')
	const runtime = blueprint.createRuntime()
	at('warm')
	fixture.warm(runtime)
	const head = fixture.head(runtime)
	const writeAndRead = () => {
		at('write')
		const written = fixture.writeTail(runtime)
		if (!written.ok)
			throw Object.assign(new Error('the write to the tail State was rejected'), { name: 'WriteRejected' })
		at('read')
		expectValue(head.get(), fixture.expectedAfterWrite, 'head after the write')
	}
	if (phase === 'warm-reread') {
		writeAndRead()
		return
	}
	at('subscribe')
	const unsubscribe = head.subscribe(() => {
		calls.count++
	})
	if (phase === 'dispose') {
		at('dispose')
		runtime.dispose()
		return
	}
	at('unsubscribe')
	unsubscribe()
	if (phase === 'unsubscribe')
		return
	writeAndRead()
	if (calls.count !== 0) {
		throw Object.assign(new Error(`the listener was called ${calls.count} time(s) after it was unsubscribed`), { name: 'ListenerStillActive' })
	}
}

/** The steps of `rewrite-all` after a valid Blueprint: a cold read, then two rounds of writing every State and reading the head. */
function runRewriteAll(fixture, blueprint, at) {
	at('create-runtime')
	const runtime = blueprint.createRuntime()
	const head = fixture.head(runtime)
	at('read')
	expectValue(head.get(), fixture.expected, 'head')
	for (const value of [1, 2]) {
		at(`write-${value}`)
		fixture.writeAll(runtime, value)
		at(`read-${value}`)
		expectValue(head.get(), fixture.expectedAfterAll(value), `head after writing every State to ${value}`)
	}
}

/** Runs one attempt. Returns `{ ok, stage, error? }`; `stage` is where it stopped (`done` when everything passed). */
export function attempt({ shape, phase, length }) {
	let stage = 'build-plugin'
	const teardown = TEARDOWN_PHASES.has(phase)
	const capture = teardown ? captureReportedExceptions() : null
	try {
		const build = BUILDERS[shape]
		if (build === undefined)
			throw new Error(`unknown probe shape ${shape}`)
		const fixture = build(length, phase === 'rewrite-all' ? 'state-first' : teardown ? 'live' : 'authored')
		stage = 'create-system'
		const system = createWidgetSystem({ plugins: fixture.plugins })
		stage = 'compile'
		const blueprint = system.createBlueprint(fixture.source)
		if (blueprint.status !== 'valid') {
			const first = blueprint.diagnostics[0]
			return { ok: false, stage, error: { name: 'InvalidBlueprint', constructor: '', message: `${first?.code}: ${first?.message}`.slice(0, 300) } }
		}
		if (phase === 'compile')
			return { ok: true, stage: 'done' }
		if (phase === 'rewrite-all') {
			runRewriteAll(fixture, blueprint, (next) => {
				stage = next
			})
			return { ok: true, stage: 'done' }
		}
		if (teardown) {
			runTeardown(phase, fixture, blueprint, (next) => {
				stage = next
			}, { count: 0 })
			if (capture.reported.length > 0)
				return { ok: false, stage: `${stage} (reported)`, error: { ...describeError(capture.reported[0]), reported: capture.reported.length } }
			return { ok: true, stage: 'done' }
		}
		stage = 'create-runtime'
		const runtime = blueprint.createRuntime()
		stage = 'read'
		expectValue(fixture.head(runtime)
			.get(), fixture.expected, 'head')
		return { ok: true, stage: 'done' }
	}
	catch (error) {
		return { ok: false, stage, error: describeError(error) }
	}
	finally {
		if (capture !== null)
			capture.restore()
	}
}
