/**
 * Conformance (differential): a Property read cold from the head of a deep dependency graph ends exactly as
 * an evaluation that never ran deep (DevilTea/widget Discussion #12,
 * https://github.com/DevilTea/widget/discussions/12#discussioncomment-19593596).
 *
 * Seeded, deterministic DAGs of Properties with random fan-out and depth both below and well above Core's
 * internal nesting limit; some Properties add diagnostics, some throw, some read their inputs only while a
 * State is odd (so a write makes a re-evaluation reach a cold, deep branch), some catch what their inputs
 * throw. Runtime A reads cold from the heads (directly and through subscriptions); Runtime B, built from the
 * same Blueprint, reads every Property in dependency order, so none of its reads is ever deep. Values, thrown
 * errors and diagnostics must be identical. The one exception is the diagnostics of a Property whose
 * `compute` currently throws: it keeps its previous snapshot, which depends on which evaluations ran before
 * and therefore differs between the two reading orders by construction (also without deep reads).
 */

import type { ExecutionResult, WidgetSystemRuntime } from '../index'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface NodeConfig {
	readonly index: number
	readonly inputs: readonly string[]
	/** Adds a diagnostic when the computed value modulo 7 equals it. */
	readonly diagnoseWhen: number | null
	/** Throws when the computed value modulo 11 equals it. */
	readonly throwWhen: number | null
	/** Reads its inputs only while its State `s` is odd. */
	readonly gate: boolean
	/** Catches what an input read throws and counts it as 1000. */
	readonly catchInputs: boolean
}

interface NodeInterfaces {
	config: { raw: NodeConfig, resolved: NodeConfig }
	state: { s: number }
	properties: { out: number }
}

const nodePlugin = createWidgetPlugin('node')
	.description('Test widget')
	.interfaces<NodeInterfaces>()
	.config({
		description: 'Node',
		validate: (input): input is NodeConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw!,
	})
	.state(state => state.s({ validate: (input): input is number => typeof input === 'number', default: () => 1 }))
	.properties(properties => properties.out({
		registerDeps: ({ dep, config }) => ({
			s: dep.self.state.get('s'),
			inputs: config.inputs.map(id => dep.widget(id)
				.optional()
				.properties
				.get('out')),
		}),
		compute: ({ deps, config, addDiagnostic }) => {
			const s = deps.s()
			const own = s.ok && typeof s.value === 'number' ? s.value : 0
			if (config.gate && own % 2 === 0)
				return own
			let sum = own
			for (const read of deps.inputs) {
				let input: ExecutionResult<unknown, unknown>
				if (config.catchInputs) {
					try {
						input = read()
					}
					catch {
						sum += 1000
						continue
					}
				}
				else {
					input = read()
				}
				sum += input.ok ? (typeof input.value === 'number' ? input.value : 0) : 500
			}
			sum %= 9973
			if (config.throwWhen !== null && sum % 11 === config.throwWhen)
				throw new Error(`node ${config.index} threw at ${sum}`)
			if (config.diagnoseWhen !== null && sum % 7 === config.diagnoseWhen)
				addDiagnostic({ message: `node ${config.index} at ${sum}` })
			return sum
		},
	}))
	.done()

const graphPlugin = createWidgetPlugin('graph')
	.description('Test widget')
	.interfaces<{ slots: 'nodes' }>()
	.slots({ nodes: { description: 'Nodes' } })
	.done()

const system = createWidgetSystem({ plugins: [nodePlugin, graphPlugin] })

/** mulberry32: a small seeded PRNG, so every graph is reproducible from its seed. */
function createRandom(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6D2B79F5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * Bounds how many wrapped diagnostics a node can accumulate: every failing input is wrapped 1:1, so the
 * count at a node is the number of paths from the diagnostic sources below it.
 */
const MAX_POTENTIAL_DIAGNOSTICS = 32

interface Graph {
	readonly configs: readonly NodeConfig[]
	readonly heads: readonly number[]
	/** The longest dependency path a first read follows: a closed gate ends a path. */
	readonly coldDepth: number
}

function generateGraph(seed: number, size: number): Graph {
	const random = createRandom(seed)
	const configs: NodeConfig[] = []
	const potential: number[] = []
	const depthOf: number[] = []
	const hasDependent: boolean[] = []
	for (let index = 0; index < size; index++) {
		const inputs: number[] = []
		// Mostly the previous node, so chains get long; sometimes a fresh start or extra inputs.
		if (index > 0 && random() < (size >= 1000 ? 0.9997 : size >= 250 ? 0.96 : 0.88))
			inputs.push(index - 1)
		const extra = random() < 0.25 && index > 1 ? 1 + Math.floor(random() * 3) : 0
		for (let count = 0; count < extra; count++) {
			const candidate = Math.floor(random() * (index - 1))
			if (!inputs.includes(candidate))
				inputs.push(candidate)
		}
		let nodePotential = 0
		const kept: number[] = []
		for (const input of inputs) {
			if (nodePotential + potential[input]! > MAX_POTENTIAL_DIAGNOSTICS)
				continue
			nodePotential += potential[input]!
			kept.push(input)
		}
		const diagnoseWhen = random() < 0.08 && nodePotential < MAX_POTENTIAL_DIAGNOSTICS ? Math.floor(random() * 7) : null
		if (diagnoseWhen !== null)
			nodePotential++
		potential.push(nodePotential)
		// Gates are rare in the largest graphs, so their first reads follow paths far longer than V8 can nest.
		const gate = random() < (size >= 1000 ? 0.0002 : 0.12)
		depthOf.push(gate ? 1 : 1 + kept.reduce((max, input) => Math.max(max, depthOf[input]!), 0))
		for (const input of kept)
			hasDependent[input] = true
		configs.push({
			index,
			inputs: kept.map(input => `n${input}`),
			diagnoseWhen,
			// Rare in the largest graphs: a throw anywhere on a long chain would dominate every failure above it.
			throwWhen: random() < (size >= 1000 ? 0.002 : 0.04) ? Math.floor(random() * 11) : null,
			gate,
			catchInputs: random() < 0.1,
		})
	}
	// Highest index first: the first reads of Runtime A start at the top of the longest chains.
	const heads = configs.map((_, index) => index)
		.filter(index => !hasDependent[index])
		.reverse()
	return { configs, heads, coldDepth: Math.max(...depthOf) }
}

type Outcome = { readonly value: unknown } | { readonly threw: string }

type GraphRuntime = WidgetSystemRuntime<readonly [typeof nodePlugin, typeof graphPlugin]>

interface DiagnosticRecord {
	readonly location: { readonly widgetId?: string }
	readonly cause?: DiagnosticRecord
}

/**
 * Each diagnostic with its own fields, and its `cause` as the place of that diagnostic in its dependency's
 * current snapshot. A cause chain is as long as the failing dependency chain, so comparing this one-level
 * description node by node compares every chain completely, without a deep (recursive) equality over it.
 */
function describeDiagnostics(runtime: GraphRuntime, diagnostics: readonly unknown[]): unknown[] {
	return (diagnostics as readonly DiagnosticRecord[]).map((diagnostic) => {
		const cause = diagnostic.cause
		if (cause === undefined)
			return diagnostic
		const owner = Number(cause.location.widgetId!.slice(1))
		return { ...diagnostic, cause: { owner, index: nodeOf(runtime, owner).properties.out.getDiagnostics()
			.indexOf(cause as never) } }
	})
}

function outcomeOf(runtime: GraphRuntime, read: () => ExecutionResult<unknown, unknown>): Outcome {
	try {
		const result = read()
		return { value: result.ok ? result.value : { diagnostics: describeDiagnostics(runtime, result.failure.diagnostics) } }
	}
	catch (error) {
		return { threw: error instanceof Error ? error.message : String(error) }
	}
}

function nodeOf(runtime: GraphRuntime, index: number) {
	const widget = runtime.getWidget(`n${index}`)
	if (widget?.type !== 'node')
		throw new Error('expected a node widget')
	return widget
}

const reported: unknown[] = []
function onUncaughtException(error: unknown): void {
	reported.push(error)
}

beforeEach(() => {
	reported.length = 0
	process.on('uncaughtException', onUncaughtException)
})

afterEach(async () => {
	await new Promise<void>(resolve => setTimeout(resolve, 0))
	process.off('uncaughtException', onUncaughtException)
	// Only compute exceptions re-read by subscriptions are reported, and only Errors thrown by the nodes.
	for (const error of reported) {
		expect(error)
			.toBeInstanceOf(Error)
		expect((error as Error).message)
			.toMatch(/^node \d+ threw at \d+$/)
	}
})

const SIZES = [12, 30, 80, 250, 6000]

/** The longest cause chain any head of any seed ended with, walked iteratively (see the last test). */
let longestCauseChain = 0

function causeChainLength(diagnostic: DiagnosticRecord | undefined): number {
	let length = 0
	for (let current = diagnostic; current !== undefined; current = current.cause)
		length++
	return length
}
const SEEDS = Array.from({ length: 15 }, (_, index) => index + 1)

describe('deep dependency graphs read cold from their heads', () => {
	it('cover depths both below and far above the internal nesting limit', () => {
		const depths = SEEDS.map(seed => generateGraph(seed, SIZES[seed % SIZES.length]!).coldDepth)

		expect(Math.min(...depths))
			.toBeLessThan(16)
		// V8 nests around a thousand cold evaluations of this shape.
		expect(Math.max(...depths))
			.toBeGreaterThan(3_000)
	})

	it.each(SEEDS)('end exactly as a dependency-ordered evaluation (seed %i)', (seed) => {
		const size = SIZES[seed % SIZES.length]!
		const graph = generateGraph(seed, size)
		const random = createRandom(seed * 7919)
		const blueprint = system.createBlueprint({
			id: 'graph',
			type: 'graph',
			slots: { nodes: graph.configs.map(config => ({ id: `n${config.index}`, type: 'node', config })) },
		})
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')
		const a = blueprint.createRuntime()
		const b = blueprint.createRuntime()

		// Close every gate first, so the gated inputs stay cold until a write opens them.
		const write = (index: number, value: number) => {
			nodeOf(a, index).state.s.set(value)
			nodeOf(b, index).state.s.set(value)
		}
		for (const config of graph.configs) {
			if (config.gate)
				write(config.index, 2)
		}

		// Each subscriber records every value delivered to it, and every diagnostics listener how often it was
		// notified, so the two Runtimes can be compared sequence by sequence.
		const delivered = { a: new Map<number, unknown[]>(), b: new Map<number, unknown[]>() }
		const notified = { a: new Map<string, number>(), b: new Map<string, number>() }
		const observe = (runtime: GraphRuntime, side: 'a' | 'b', head: number) => {
			delivered[side].set(head, [])
			nodeOf(runtime, head).properties.out.subscribe((result) => {
				delivered[side].get(head)!.push(outcomeOf(runtime, () => result))
			})
			const count = (key: string) => () => notified[side].set(key, (notified[side].get(key) ?? 0) + 1)
			nodeOf(runtime, head).properties.out.subscribeDiagnostics(count(`property n${head}`))
			nodeOf(runtime, head)
				.subscribeDiagnostics(count(`widget n${head}`))
		}
		// A: a cold subscription to a third of the heads, then cold direct reads of every head.
		const subscribed = graph.heads.filter(() => random() < 0.33)
		for (const head of subscribed)
			observe(a, 'a', head)
		const readHeadsOfA = () => new Map(graph.heads.map(head => [head, outcomeOf(a, () => nodeOf(a, head).properties.out.get())]))
		const readAllOfB = () => graph.configs.map(config => outcomeOf(b, () => nodeOf(b, config.index).properties.out.get()))

		const compareHeads = () => {
			const ofA = readHeadsOfA()
			const ofB = readAllOfB()
			for (const head of graph.heads) {
				expect(ofA.get(head), `head n${head}`)
					.toEqual(ofB[head])
				if ('value' in ofB[head]!) {
					expect(describeDiagnostics(a, nodeOf(a, head).properties.out.getDiagnostics()), `diagnostics of head n${head}`)
						.toEqual(describeDiagnostics(b, nodeOf(b, head).properties.out.getDiagnostics()))
				}
			}
			return ofB
		}

		compareHeads()
		// B: the same subscriptions, made once everything was read in dependency order.
		for (const head of subscribed)
			observe(b, 'b', head)
		// Reading everything again, with no write, notifies nobody in either Runtime.
		for (const side of ['a', 'b'] as const) {
			for (const head of subscribed)
				delivered[side].get(head)!.length = 0
			notified[side].clear()
		}
		readAllOfB()
		for (let index = size - 1; index >= 0; index--)
			outcomeOf(a, () => nodeOf(a, index).properties.out.get())
		for (const head of subscribed) {
			expect(delivered.a.get(head), `delivered to head n${head} with no write`)
				.toEqual([])
		}
		expect(notified.a)
			.toEqual(new Map())
		expect(notified.b)
			.toEqual(new Map())

		for (let round = 0; round < 3; round++) {
			for (const config of graph.configs) {
				// About 20 writes a round at most: each one re-evaluates the subscribed heads eagerly.
				if (random() < (config.gate ? 0.5 : Math.min(0.08, 20 / size)))
					write(config.index, 1 + Math.floor(random() * 20))
			}
			compareHeads()
			for (const head of subscribed) {
				expect(delivered.a.get(head), `values delivered to head n${head}`)
					.toEqual(delivered.b.get(head))
			}
			expect(notified.a)
				.toEqual(notified.b)
		}

		// Finally every Property of A, in reverse order, against B.
		const ofB = readAllOfB()
		const throwing = new Set<string>()
		for (let index = size - 1; index >= 0; index--) {
			expect(outcomeOf(a, () => nodeOf(a, index).properties.out.get()), `n${index}`)
				.toEqual(ofB[index])
			if ('threw' in ofB[index]!) {
				throwing.add(`n${index}`)
				continue
			}
			expect(describeDiagnostics(a, nodeOf(a, index).properties.out.getDiagnostics()), `diagnostics of n${index}`)
				.toEqual(describeDiagnostics(b, nodeOf(b, index).properties.out.getDiagnostics()))
		}
		const settled = (runtime: GraphRuntime) => describeDiagnostics(runtime, runtime.getDiagnostics()
			.filter(diagnostic => !throwing.has((diagnostic as { location: { widgetId: string } }).location.widgetId)))
		expect(settled(a))
			.toEqual(settled(b))
		for (const head of graph.heads) {
			for (const diagnostic of nodeOf(a, head).properties.out.getDiagnostics())
				longestCauseChain = Math.max(longestCauseChain, causeChainLength(diagnostic as DiagnosticRecord))
		}
	})

	// Runs after every seed above: the failing chains compared there include ones far longer than V8 nests.
	it('include failing chains far longer than the engine could nest', () => {
		expect(longestCauseChain)
			.toBeGreaterThan(1_000)
	})
})
