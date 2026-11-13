/**
 * Stack-depth probes: one attempt builds a document with a long dependency chain, compiles it and (for the
 * `evaluate` phase) creates a Runtime and reads the head Property cold. Plain ECMAScript only. Each attempt runs
 * in a process of its own (see run.mjs), so an overflow, or a crash, never affects the next attempt.
 *
 * Shapes:
 *   chain   one widget, State `x`, then Properties p0 ... p{L-1}: `p{i}` reads `p{i+1}` and `p{L-1}` reads `x`; L counts
 *           Properties; the head is `p0`, which reads all the others. The head is declared FIRST on purpose: the
 *           compiler's cycle search visits members in declaration order and follows dependencies, so this order makes
 *           its recursion as deep as the chain (declared tail first, the same chain still compiled at 65 536 links, because
 *           every member's dependencies are already visited).
 *   survey  W flat `q` widgets; `q<k>.visible` reads `q<k+1>.value`, `q<k>.value` reads its own State and its own
 *           `visible` (the shape of a survey whose question visibility depends on the previous question); L counts
 *           widgets (2 Properties each); the head is `q0.value`.
 */

import * as core from '@bench/core'

const { createWidgetPlugin, createWidgetSystem } = core

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

function buildChain(length) {
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
		read: runtime => runtime.getWidget('c').properties.p0.get(),
		expected: length,
	}
}

function buildSurvey(widgets) {
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
				compute: ({ deps }) => (deps.next === undefined ? true : deps.next().ok),
			})
			.value({
				registerDeps: ({ dep }) => ({
					answer: dep.self.state.get('answer'),
					visible: dep.self.properties.get('visible'),
				}),
				compute: ({ deps }) => {
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
		read: runtime => runtime.getWidget('q0').properties.value.get(),
		expected: 1,
	}
}

const BUILDERS = { chain: buildChain, survey: buildSurvey }

/** Runs one attempt. Returns `{ ok, stage, error? }`; `stage` is where it stopped (`done` when everything passed). */
export function attempt({ shape, phase, length }) {
	let stage = 'build-plugin'
	try {
		const build = BUILDERS[shape]
		if (build === undefined)
			throw new Error(`unknown probe shape ${shape}`)
		const fixture = build(length)
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
		stage = 'create-runtime'
		const runtime = blueprint.createRuntime()
		stage = 'read'
		const result = fixture.read(runtime)
		if (!result.ok) {
			const first = result.diagnostics?.[0]
			return { ok: false, stage, error: { name: 'PropertyFailure', constructor: '', message: `${first?.code}: ${first?.message}`.slice(0, 300) } }
		}
		if (result.value !== fixture.expected)
			return { ok: false, stage, error: { name: 'WrongValue', constructor: '', message: `read ${result.value}, expected ${fixture.expected}` } }
		return { ok: true, stage: 'done' }
	}
	catch (error) {
		return { ok: false, stage, error: describeError(error) }
	}
}
