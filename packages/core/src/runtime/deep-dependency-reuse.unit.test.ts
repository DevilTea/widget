/**
 * Conformance: re-reading a Property is not bounded by the engine stack either (DevilTea/widget Discussion #12,
 * https://github.com/DevilTea/widget/discussions/12#discussioncomment-19593596).
 *
 * On a reused Runtime, writing every State and reading the head again makes every link of a chain stale at
 * once. When each link reads something changed before its next link (its own State, here), alien-signals'
 * dirty check re-evaluates each link from inside the re-evaluation of the link above it, one nesting level
 * per link. Core bounds that nesting like a first read's: the stack a re-read needs does not grow with the
 * chain, the values are those of an evaluation that had enough stack, and afterwards nothing is left to
 * evaluate again.
 */

import type { ExecutionResult } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectRuntime } from '../inspection'

const isNumber = (input: unknown): input is number => typeof input === 'number'

function numberOf(result: ExecutionResult<unknown, unknown>): number {
	return result.ok && typeof result.value === 'number' ? result.value : -1
}

const env = {
	computeCalls: 0,
	/** Deepest engine stack a `compute` ran on since the last reset, while `probing`. */
	deepest: 0,
	probing: false,
	onCompute: null as null | ((id: string) => void),
}

function compute(id: string): void {
	env.computeCalls++
	if (env.probing)
		env.deepest = Math.max(env.deepest, new Error('depth probe').stack!.split('\n').length)
	env.onCompute?.(id)
}

/**
 * Runs `step` with the deepest stack of every `compute` recorded (see `env.deepest`) and returns that depth, or
 * the deepest stack and the result when the step returns one.
 */
function deepestDuring(step: () => void): number {
	const stackTraceLimit = Error.stackTraceLimit
	Error.stackTraceLimit = Number.POSITIVE_INFINITY
	env.probing = true
	env.deepest = 0
	try {
		step()
	}
	finally {
		env.probing = false
		Error.stackTraceLimit = stackTraceLimit
	}
	return env.deepest
}

// ---------------------------------------------------------------------------------------------------------
// The survey: `visible` reads the next question's `value`; `value` reads its own `answer` and its `visible`,
// in the order the config says. `value` is `answer + visible + 1`, `visible` the next question's value (0 for
// the last), so the first question's value is the number of questions plus the sum of the answers.
// ---------------------------------------------------------------------------------------------------------

interface QuestionConfig {
	readonly next: string | null
	readonly stateFirst: boolean
}

interface QuestionInterfaces {
	config: { raw: QuestionConfig, resolved: QuestionConfig }
	state: { answer: number }
	properties: { visible: number, value: number }
}

const questionPlugin = createWidgetPlugin('question')
	.description('Test widget')
	.interfaces<QuestionInterfaces>()
	.config({
		description: 'Question',
		validate: (input): input is QuestionConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.state(state => state.answer({ validate: isNumber, default: () => 0 }))
	.properties(properties => properties
		.visible({
			registerDeps: ({ dep, config }) => ({
				next: dep.widget(config.next ?? 'absent')
					.optional()
					.properties
					.get('value'),
			}),
			compute: ({ deps, config, widget }) => {
				compute(`${widget.id}.visible`)
				return config.next === null ? 0 : numberOf(deps.next())
			},
		})
		.value({
			registerDeps: ({ dep }) => ({
				answer: dep.self.state.get('answer'),
				visible: dep.self.properties.get('visible'),
			}),
			compute: ({ deps, config, widget }) => {
				compute(`${widget.id}.value`)
				if (config.stateFirst) {
					const answer = numberOf(deps.answer())
					return answer + numberOf(deps.visible()) + 1
				}
				const visible = numberOf(deps.visible())
				return numberOf(deps.answer()) + visible + 1
			},
		}))
	.done()

const listPlugin = createWidgetPlugin('list')
	.description('Test widget')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Items' } })
	.done()

const system = createWidgetSystem({ plugins: [questionPlugin, listPlugin] })

function createSurvey(length: number, stateFirst: boolean) {
	const items = Array.from({ length }, (_, index) => ({
		id: `q${index}`,
		type: 'question',
		config: { next: index + 1 < length ? `q${index + 1}` : null, stateFirst },
	}))
	const blueprint = system.createBlueprint({ id: 'survey', type: 'list', slots: { items } })
	if (blueprint.status !== 'valid')
		throw new Error('expected a valid Blueprint')
	const runtime = blueprint.createRuntime()
	const question = (index: number) => {
		const widget = runtime.getWidget(`q${index}`)
		if (widget?.type !== 'question')
			throw new Error('expected a question widget')
		return widget
	}
	const head = question(0).properties.value
	/** Writes `value` to the answer of every question selected by `which` (all by default). */
	const write = (value: number, which: (index: number) => boolean = () => true) => {
		for (let index = 0; index < length; index++) {
			if (which(index))
				question(index).state.answer.set(value)
		}
	}
	return { runtime, question, head, write }
}

const reported: unknown[] = []
function onUncaughtException(error: unknown): void {
	reported.push(error)
}

beforeEach(() => {
	reported.length = 0
	env.onCompute = null
	process.on('uncaughtException', onUncaughtException)
})

afterEach(async () => {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	process.off('uncaughtException', onUncaughtException)
})

const LENGTH = 150

/** These tests read long chains with a stack probe on every `compute`, or from many host stack depths. */
const HEAVY_TEST_TIMEOUT = 30_000

describe.each([
	{ order: 'its answer first', stateFirst: true },
	{ order: 'its visible first', stateFirst: false },
])('a survey whose value reads $order, re-read after writing answers', ({ stateFirst }) => {
	it('nests no deeper than the first cold read, wherever the answers were written', () => {
		const survey = createSurvey(LENGTH, stateFirst)
		const cold = deepestDuring(() => {
			expect(survey.head.get())
				.toEqual({ ok: true, value: LENGTH })
		})
		const flows: Array<{ step: () => void, expected: number }> = [
			{ step: () => survey.write(1), expected: 2 * LENGTH },
			{ step: () => survey.write(2), expected: 3 * LENGTH },
			{ step: () => survey.runtime.resetState(), expected: LENGTH },
			{ step: () => survey.write(1), expected: 2 * LENGTH },
			// Only every other question written: half the links stale.
			{ step: () => survey.write(3, index => index % 2 === 1), expected: 2 * LENGTH + LENGTH },
		]
		for (const [round, { step, expected }] of flows.entries()) {
			step()
			env.computeCalls = 0
			const deepest = deepestDuring(() => {
				expect(survey.head.get(), `round ${round}`)
					.toEqual({ ok: true, value: expected })
			})
			expect(deepest, `round ${round}`)
				.toBeLessThanOrEqual(2 * cold)
			// Two Properties per question, each evaluated at most about twice.
			expect(env.computeCalls, `round ${round}`)
				.toBeLessThanOrEqual(5 * LENGTH)
			env.computeCalls = 0
			survey.head.get()
			for (let index = LENGTH - 1; index >= 0; index--)
				survey.question(index).properties.value.get()
			expect(env.computeCalls, `round ${round}: nothing left to evaluate`)
				.toBe(0)
		}
		expect(reported)
			.toEqual([])
	}, HEAVY_TEST_TIMEOUT)

	it('delivers every stale link restored at once to a subscriber of the head, nesting no deeper', () => {
		const survey = createSurvey(LENGTH, stateFirst)
		const cold = deepestDuring(() => {
			survey.head.get()
		})
		const seen: unknown[] = []
		survey.head.subscribe(result => seen.push(numberOf(result)))
		survey.write(1)
		expect(seen.at(-1))
			.toBe(2 * LENGTH)
		seen.length = 0

		// `resetState()` writes every answer in one batch: the subscription re-reads a chain whose every link is stale.
		const deepest = deepestDuring(() => {
			survey.runtime.resetState()
		})

		expect(seen)
			.toEqual([LENGTH])
		expect(deepest)
			.toBeLessThanOrEqual(2 * cold)
		env.computeCalls = 0
		survey.head.get()
		expect(env.computeCalls)
			.toBe(0)
		expect(reported)
			.toEqual([])
	}, HEAVY_TEST_TIMEOUT)
})

describe('a long survey re-read after writing every answer', () => {
	it('reads the head of 20 000 questions on a reused Runtime, round after round', () => {
		const length = 20_000
		const survey = createSurvey(length, true)

		expect(survey.head.get())
			.toEqual({ ok: true, value: length })
		for (const value of [1, 2]) {
			survey.write(value)
			expect(survey.head.get())
				.toEqual({ ok: true, value: (value + 1) * length })
		}
		survey.runtime.resetState()
		survey.write(5)
		expect(survey.head.get())
			.toEqual({ ok: true, value: 6 * length })
	}, HEAVY_TEST_TIMEOUT)
})

describe('a host that re-reads a stale chain from an already deep stack', () => {
	it('gets the engine\'s stack overflow or the value, never an internal error, and reads it again from a shallow stack', () => {
		const survey = createSurvey(2_000, true)
		survey.head.get()
		survey.write(1)
		const outcomes = new Set<string>()
		const atDepth = (depth: number): string => {
			if (depth > 0)
				return atDepth(depth - 1)
			try {
				return numberOf(survey.head.get()) === 4_000 ? 'value' : 'other value'
			}
			catch (error) {
				return error instanceof RangeError ? 'overflow' : `other: ${String(error)}`
			}
		}
		let maxDepth = 0
		try {
			const probe = (depth: number): number => {
				maxDepth = depth
				return probe(depth + 1) + 1
			}
			probe(0)
		}
		catch {}
		for (let depth = maxDepth - 1; depth > 0; depth = Math.floor(depth * 0.9)) {
			try {
				outcomes.add(atDepth(depth))
			}
			catch (error) {
				outcomes.add(error instanceof RangeError ? 'overflow' : `other: ${String(error)}`)
			}
		}

		expect([...outcomes].filter(outcome => outcome.startsWith('other: ')))
			.toEqual([])
		expect(outcomes.has('overflow'))
			.toBe(true)
		survey.write(2)
		expect(survey.head.get())
			.toEqual({ ok: true, value: 6_000 })
	}, HEAVY_TEST_TIMEOUT)
})

describe('a subscriber whose re-read runs on an already deep stack', () => {
	it('is reported the engine\'s stack overflow, never an internal error, and is delivered the value from a shallow stack', () => {
		const length = 500
		const survey = createSurvey(length, true)
		const seen: number[] = []
		let unsubscribe = survey.head.subscribe(result => seen.push(numberOf(result)))
		const atDepth = (depth: number, step: () => void): void => {
			if (depth > 0)
				return atDepth(depth - 1, step)
			step()
		}
		let maxDepth = 0
		try {
			const probe = (depth: number): number => {
				maxDepth = depth
				return probe(depth + 1) + 1
			}
			probe(0)
		}
		catch {}
		const thrown: unknown[] = []
		for (let depth = maxDepth - 1; depth > 0; depth = Math.floor(depth * 0.9)) {
			// Writes made without the subscriber (one re-read for all of them), then subscribed again.
			unsubscribe()
			survey.write(1)
			unsubscribe = survey.head.subscribe(result => seen.push(numberOf(result)))
			try {
				// Every answer in one batch: the subscription re-reads a chain whose every link is stale.
				atDepth(depth, () => survey.runtime.resetState())
			}
			catch (error) {
				thrown.push(error)
			}
		}

		expect([...reported, ...thrown].filter(error => !(error instanceof RangeError)))
			.toEqual([])
		survey.write(100)
		expect(seen.at(-1))
			.toBe(101 * length)
	}, HEAVY_TEST_TIMEOUT)
})

describe('a Property replaced while a listener read it during its first evaluation', () => {
	it('does not keep its dependencies alive once nothing reads them', () => {
		// An inspection listener of q95's visible reads q94's visible while the cold read of the survey has q94's
		// first evaluation in progress: q94's visible is replaced by a fresh computed for that read. After every
		// subscription is gone and the survey is subscribed again, every Property evaluates again, as alien-signals
		// tears down a computed nothing reads.
		const length = 100
		const survey = createSurvey(length, true)
		const inspection = inspectRuntime(survey.runtime)
		const nodeId = (id: string) => inspection.blueprint.nodes.find(entry => entry.resolved && entry.node.id === id)!.nodeId
		let armed = true
		const published: number[] = []
		inspection.getWidget(nodeId('q95'))!.getProperty('visible')!.subscribe((snapshot) => {
			published.push(snapshot.status === 'completed' ? numberOf(snapshot.result) : -1)
			if (armed) {
				armed = false
				survey.question(94).properties.visible.get()
			}
		})
		const unsubscribes: Array<() => void> = []
		const subscribeAll = () => {
			for (const index of [0, 30, 60, 99])
				unsubscribes.push(survey.question(index).properties.value.subscribe(() => {}))
		}
		subscribeAll()
		survey.question(99).state.answer.set(2)
		const before = published.length
		for (const unsubscribe of unsubscribes.splice(0))
			unsubscribe()
		const evaluated = new Set<string>()
		env.onCompute = id => evaluated.add(id)
		subscribeAll()

		expect(evaluated.size)
			.toBe(2 * length)
		expect(published.slice(before))
			.toEqual([6])
	})
})
