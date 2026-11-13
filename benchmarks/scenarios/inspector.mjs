/**
 * Inspector scenarios (`@deviltea/widget-inspector`): the Agent and Client talk over the package's own
 * in-process transport, which JSON-clones every message, so "end to end" includes projection, serialization,
 * validation and parsing on both sides. The Agent is created without DOM support (no overlay or geometry).
 */

import { createFixture, PROFILES } from '../lib/gen.mjs'
import { loadInspector } from '../lib/load.mjs'
import { counter, SIZES, treeOf } from './common.mjs'

async function connect(n, profile = PROFILES.standard) {
	const { createInspectorAgent } = await loadInspector('agent')
	const { createInspectorClient } = await loadInspector('client')
	const { createInProcessInspectorTransportPair } = await loadInspector('transport')
	const f = createFixture(treeOf(profile), n)
	const blueprint = f.compileValid()
	const runtime = blueprint.createRuntime()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'bench' })
	const client = createInspectorClient(pair.client)
	await client.handshake()
	return { f, runtime, agent, client }
}

function wideObject(keys) {
	const value = {}
	for (let i = 0; i < keys; i++) {
		value[`key-${String(i)
			.padStart(7, '0')}`] = i
	}
	return value
}

function nested(depth, fanout) {
	if (depth === 0)
		return 'leaf'
	const value = {}
	for (let i = 0; i < fanout; i++)
		value[`k${i}`] = nested(depth - 1, fanout)
	return value
}

export const scenarios = [
	{
		id: 'inspector.snapshot',
		area: 'inspector',
		jitless: false,
		perWidget: true,
		summary: '`blueprint.getSnapshot` request for an N-widget standard tree, end to end over the in-memory transport.',
		inside: 'client.request(...) until the response promise resolves: Agent projection, JSON clone both ways, client validation',
		outside: 'compile, Runtime creation, Agent/Client setup and handshake',
		variants: [{
			name: 'standard',
			sizes: SIZES,
			async setup(n) {
				const { client } = await connect(n)
				const first = await client.request('blueprint.getSnapshot', { runtimeId: 'bench' })
				if (first.nodes.length !== n)
					throw new Error(`snapshot has ${first.nodes.length} nodes, expected ${n}`)
				return {
					async: true,
					run: () => client.request('blueprint.getSnapshot', { runtimeId: 'bench' }),
				}
			},
		}],
	},
	{
		id: 'inspector.subscribe',
		area: 'inspector',
		jitless: false,
		summary: 'Member-change fan-out to a subscribed Client: writes to subscribed State members while the Agent projects, serializes and delivers each change.',
		inside: 'the State writes (events are delivered synchronously inside each write)',
		outside: 'compile, Runtime creation, Agent/Client setup, subscribing',
		variants: [
			{
				name: 'one-write-per-subscription',
				note: 'K State members (s0 of K units) each subscribed; one run writes each of them once (K events); size = K',
				sizeLabel: 'K subscriptions',
				perWidget: true,
				sizes: [10, 100, 1000],
				async setup(k) {
					const { f, runtime, client } = await connect(Math.max(2000, k * 3))
					const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'bench' })
					const nodeByWidget = new Map(snapshot.nodes.map(node => [node.widgetId, node.nodeId]))
					const ids = f.unitIds()
						.slice(0, k)
					let received = 0
					client.on('runtime.memberChanged', () => {
						received++
					})
					for (const id of ids)
						await client.request('runtime.subscribeMember', { ref: { runtimeId: 'bench', nodeId: nodeByWidget.get(id) }, member: { type: 'state', name: 's0' } })
					const states = ids.map(id => runtime.getWidget(id).state.s0)
					const next = counter(10)
					// Guard against measuring a silent pipeline: one write per subscription must produce K events.
					const before = received
					const probe = next()
					for (const state of states)
						state.set(probe)
					if (received - before !== k)
						throw new Error(`expected ${k} events, received ${received - before}`)
					return {
						run() {
							const v = next()
							for (let i = 0; i < states.length; i++)
								states[i].set(v)
							return received
						},
					}
				},
			},
			{
				name: 'burst-one-member',
				note: 'one State member subscribed; one run is a burst of B writes (B events); size = B',
				sizeLabel: 'B writes',
				perWidget: true,
				sizes: [10, 100, 1000],
				async setup(b) {
					const { f, runtime, client } = await connect(100)
					const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'bench' })
					const id = f.unitIds()[0]
					const nodeId = snapshot.nodes.find(node => node.widgetId === id).nodeId
					let received = 0
					client.on('runtime.memberChanged', () => {
						received++
					})
					await client.request('runtime.subscribeMember', { ref: { runtimeId: 'bench', nodeId }, member: { type: 'state', name: 's0' } })
					const state = runtime.getWidget(id).state.s0
					const next = counter(10)
					const before = received
					state.set(next())
					if (received - before !== 1)
						throw new Error('burst fixture received no event')
					return {
						run() {
							for (let i = 0; i < b; i++)
								state.set(next())
							return received
						},
					}
				},
			},
			{
				name: 'no-subscription',
				note: 'reference: the same writes with the Agent present but nothing subscribed (K = 1000 writes of one State)',
				sizeLabel: 'B writes',
				perWidget: true,
				sizes: [1000],
				async setup(b) {
					const { f, runtime } = await connect(100)
					const state = runtime.getWidget(f.unitIds()[0]).state.s0
					const next = counter(10)
					return {
						run() {
							for (let i = 0; i < b; i++)
								state.set(next())
						},
					}
				},
			},
		],
	},
	{
		id: 'inspector.value',
		area: 'inspector',
		jitless: false,
		alloc: false,
		summary: 'encodeInspectableValue (the wire encoding of Runtime values and Event arguments) on large values.',
		inside: 'one encodeInspectableValue(value, limits) call',
		outside: 'building the value',
		variants: (() => {
			const big = { maxEntries: 1e9, maxNodes: 1e9, maxDepth: 4, maxStringLength: 1e9 }
			const make = (name, note, build, limits) => ({
				name,
				note,
				sizeLabel: 'value size M',
				perWidget: true,
				sizes: [100, 1000, 10000, 100000],
				async setup(m) {
					const { encodeInspectableValue } = await loadInspector('value')
					const value = build(m)
					return { run: () => encodeInspectableValue(value, limits) }
				},
			})
			return [
				make('object.default-limits', 'object with M keys, default limits (50 entries kept: the bounded smallest-keys window)', wideObject, undefined),
				make('array.default-limits', 'array of M numbers, default limits', m => Array.from({ length: m }, (_, i) => i), undefined),
				make('object.unlimited', 'object with M keys, every limit lifted: the encoder\'s own per-entry cost', wideObject, big),
				make('array.unlimited', 'array of M numbers, every limit lifted', m => Array.from({ length: m }, (_, i) => i), big),
				make('long-string', 'a single string of M characters, default limits (truncated at 500)', m => 'x'.repeat(m), undefined),
				{
					name: 'nested.default-limits',
					note: 'object tree of depth 6, fanout F (size column) = nodes available far beyond the budget; default limits',
					sizeLabel: 'fanout F',
					perWidget: false,
					sizes: [2, 4, 8],
					async setup(fanout) {
						const { encodeInspectableValue } = await loadInspector('value')
						const value = nested(6, fanout)
						return { run: () => encodeInspectableValue(value) }
					},
				},
			]
		})(),
	},
]
