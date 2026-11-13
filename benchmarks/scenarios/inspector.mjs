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
	// For a case-level dispose(): the client, the Agent (which also closes the transport pair) and the Runtime.
	const dispose = () => {
		client.dispose()
		agent.dispose()
		pair.client.close()
		runtime.dispose()
	}
	return { f, runtime, agent, client, dispose }
}

function wideObject(keys) {
	const value = {}
	for (let i = 0; i < keys; i++) {
		value[`key-${String(i)
			.padStart(7, '0')}`] = i
	}
	return value
}

/** Same keys as wideObject, created in descending order: the worst case of the encoder's smallest-key window. */
function wideObjectDescending(keys) {
	const value = {}
	for (let i = keys - 1; i >= 0; i--) {
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
				const { client, dispose } = await connect(n)
				const first = await client.request('blueprint.getSnapshot', { runtimeId: 'bench' })
				if (first.nodes.length !== n)
					throw new Error(`snapshot has ${first.nodes.length} nodes, expected ${n}`)
				return {
					async: true,
					dispose,
					run: () => client.request('blueprint.getSnapshot', { runtimeId: 'bench' }),
				}
			},
		}],
	},
	{
		id: 'inspector.widget',
		area: 'inspector',
		jitless: false,
		summary: 'One `runtime.getWidgetSnapshot` request for ONE widget of an N-widget standard tree, end to end over the in-memory transport. The Agent resolves the reference with a linear scan of the Blueprint nodes (stopping at the first match), so the variants show how that scan grows with N.',
		inside: 'client.request(...) until the response promise resolves: reference resolution in the Agent, projection of the one widget, JSON clone both ways, client validation',
		outside: 'compile, Runtime creation, Agent/Client setup, handshake and the Blueprint snapshot that supplies the references',
		variants: (() => {
			// References come from the Blueprint snapshot, as a real client obtains them. Returns the widget's
			// unit refs in snapshot order plus the snapshot's first and last node.
			const prepare = async (n) => {
				const { f, client, dispose } = await connect(n)
				const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'bench' })
				if (snapshot.nodes.length !== n)
					throw new Error(`snapshot has ${snapshot.nodes.length} nodes, expected ${n}`)
				const unitIds = new Set(f.unitIds())
				const entries = snapshot.nodes.map(node => ({ widgetId: node.widgetId, ref: { runtimeId: 'bench', nodeId: node.nodeId } }))
				const units = entries.filter(entry => unitIds.has(entry.widgetId))
				if (units.length !== unitIds.size)
					throw new Error(`found ${units.length} unit nodes, expected ${unitIds.size}`)
				return { client, dispose, entries, units }
			}
			// One request must succeed and answer for the expected widget, or the case would time an error path.
			const guard = async (client, entry) => {
				const response = await client.request('runtime.getWidgetSnapshot', { ref: entry.ref })
				if (response.widgetId !== entry.widgetId || response.ref.nodeId !== entry.ref.nodeId)
					throw new Error(`getWidgetSnapshot answered for ${response.widgetId}, expected ${entry.widgetId}`)
			}
			const fixed = (name, note, pick) => ({
				name,
				note,
				sizes: SIZES,
				async setup(n) {
					const { client, dispose, entries, units } = await prepare(n)
					const entry = pick(entries, units)
					await guard(client, entry)
					return {
						async: true,
						warmPass: true,
						dispose,
						run: () => client.request('runtime.getWidgetSnapshot', { ref: entry.ref }),
					}
				},
			})
			return [
				fixed('first-node', 'the first node in the snapshot (pre-order): the root, necessarily a `group` in a tree, so its response is smaller than a unit\'s; the scan matches at once', entries => entries[0]),
				fixed('first-unit', 'the first `unit` node in the snapshot: a unit response with a short scan (the first group-free leaf is a few nodes deep)', (entries, units) => units[0]),
				fixed('last-node', 'the last node in the snapshot (pre-order), a `unit`: a unit response, and the scan walks the whole node list', (entries, units) => {
					const last = entries[entries.length - 1]
					if (last !== units[units.length - 1])
						throw new Error('the last node of the snapshot is not a unit')
					return last
				}),
				{
					name: 'rotating',
					note: 'a different `unit` on every call, cycling through all units (a fixed stride, so every unit is visited once per cycle): the average scan length of a client that inspects many widgets',
					sizes: SIZES,
					async setup(n) {
						const { client, dispose, units } = await prepare(n)
						await guard(client, units[0])
						await guard(client, units[units.length - 1])
						// Visit the units with a stride coprime to their count: every unit is hit once per cycle, but the
						// consecutive calls of one batch land far apart, so each sample sees the same mix of scan lengths.
						const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
						let stride = Math.max(1, Math.round(units.length * 0.618))
						while (gcd(stride, units.length) !== 1)
							stride++
						let next = 0
						return {
							async: true,
							warmPass: true,
							dispose,
							run() {
								const entry = units[next]
								next = (next + stride) % units.length
								return client.request('runtime.getWidgetSnapshot', { ref: entry.ref })
							},
						}
					},
				},
			]
		})(),
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
					const { f, runtime, client, dispose } = await connect(Math.max(2000, k * 3))
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
						dispose,
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
					const { f, runtime, client, dispose } = await connect(100)
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
					// Guard against measuring a silent pipeline: a burst of B writes must deliver exactly B events.
					const before = received
					for (let i = 0; i < b; i++)
						state.set(next())
					if (received - before !== b)
						throw new Error(`expected ${b} events for a burst of ${b} writes, received ${received - before}`)
					return {
						dispose,
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
				note: 'reference: the same writes with the Agent present but nothing subscribed (B = 1000 writes of one State)',
				sizeLabel: 'B writes',
				perWidget: true,
				sizes: [1000],
				async setup(b) {
					const { f, runtime, dispose } = await connect(100)
					const state = runtime.getWidget(f.unitIds()[0]).state.s0
					const next = counter(10)
					return {
						dispose,
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
			// `proportional`: the encoder's work grows with M (it lists or walks every key or element); false where
			// the output is bounded by the limits regardless of M, so a per-unit figure would be meaningless.
			const make = (name, note, build, limits, proportional) => ({
				name,
				note,
				sizeLabel: 'value size M',
				perWidget: proportional,
				sizes: [100, 1000, 10000, 100000],
				async setup(m) {
					const { encodeInspectableValue } = await loadInspector('value')
					const value = build(m)
					return { run: () => encodeInspectableValue(value, limits) }
				},
			})
			return [
				make('object.default-limits', 'object with M keys, default limits (50 entries kept: the bounded smallest-keys window)', wideObject, undefined, true),
				make('array.default-limits', 'array of M numbers, default limits (output bounded: the first 50 entries)', m => Array.from({ length: m }, (_, i) => i), undefined, false),
				make('object.unlimited', 'object with M keys, every limit lifted: the encoder\'s own per-entry cost', wideObject, big, true),
				make('array.unlimited', 'array of M numbers, every limit lifted', m => Array.from({ length: m }, (_, i) => i), big, true),
				make('long-string', 'a single string of M characters, default limits (truncated at 500; output bounded)', m => 'x'.repeat(m), undefined, false),
				make('object.default-limits.desc', 'object with M keys created in DESCENDING key order, default limits (worst case of the bounded smallest-keys window; compare with object.default-limits, which is ascending)', wideObjectDescending, undefined, true),
				make('object.unlimited.desc', 'object with M keys created in DESCENDING key order, every limit lifted (compare with object.unlimited, which is ascending)', wideObjectDescending, big, true),
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
