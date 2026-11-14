// @vitest-environment node
import type { InspectorBlueprintNode } from './protocol'
import { readFileSync } from 'node:fs'
import { createWidgetPlugin, createWidgetSystem, createWidgetValueContract } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { projectBlueprintSnapshot } from './projection'
import { INSPECTOR_PROTOCOL_VERSION } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'
import { isBlueprintNode } from './validation'

const LEAK = 'undeclared-core-field'

const contract = createWidgetValueContract<string>('example/label@1')

interface WireInterfaces {
	state: { count: number }
	properties: { label: string, doubled: number }
	methods: { bump: () => number, ping: () => void }
	events: { pinged: [] }
}

const WirePlugin = createWidgetPlugin('WireFixture')
	.description('Wire projection fixture')
	.interfaces<WireInterfaces>()
	.state(state => state.count({
		authorWritable: true,
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.properties(properties => properties
		.label({ valueContract: contract, compute: () => 'x' })
		.doubled({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps }) => (deps.count().ok ? 2 : 0),
		}))
	.methods(methods => methods
		.bump({
			registerDeps: ({ dep }) => ({ set: dep.self.state.set('count'), absent: dep.parent.optional().state.get('count') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => 1,
		})
		.ping({
			validateArgs: (args): args is [] => args.length === 0,
			emits: ['pinged'],
			execute: ({ emit }) => emit.pinged(),
		}))
	.events(events => events.pinged({ description: 'ping' }))
	.done()

interface CycleInterfaces {
	properties: { p1: unknown, p2: unknown }
}

const CyclePlugin = createWidgetPlugin('WireCycle')
	.description('Cyclic properties')
	.interfaces<CycleInterfaces>()
	.properties(properties => properties
		.p1({ registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p2') }), compute: () => null })
		.p2({ registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p1') }), compute: () => null }))
	.done()

const system = createWidgetSystem({ plugins: [WirePlugin, CyclePlugin] })

function createBlueprint() {
	const blueprint = system.createBlueprint({ id: 'w', type: 'WireFixture' })
	if (blueprint.status !== 'valid')
		throw new Error('fixture must compile')
	return blueprint
}

/** Deep-copies plain data, adding an undeclared field to every plain object (Core objects are frozen). */
function taint(value: unknown): unknown {
	if (Array.isArray(value))
		return value.map(taint)
	if (typeof value === 'object' && value !== null) {
		const copy: Record<string, unknown> = { [LEAK]: true }
		for (const [key, item] of Object.entries(value))
			copy[key] = taint(item)
		return copy
	}
	return value
}

function nodeKeys(node: Record<string, unknown>): string[] {
	return Object.keys(node)
		.sort()
}

describe('wire projection builds every DTO field by field', () => {
	it('never lets a field Core adds to its inspection objects reach the wire', () => {
		const cyclic = system.createBlueprint({ id: 'c', type: 'WireCycle' })
		expect(inspectBlueprint(cyclic).invalidCycles.length)
			.toBeGreaterThan(0)
		for (const real of [inspectBlueprint(createBlueprint()), inspectBlueprint(cyclic)]) {
			assertNoLeak(real)
		}
	})

	function assertNoLeak(real: ReturnType<typeof inspectBlueprint>): void {
		const hostile = {
			...real,
			nodes: real.nodes.map(node => !node.resolved
				? node
				: {
						...node,
						capabilities: taint(node.capabilities),
						semanticSlots: taint(node.semanticSlots),
						state: taint(node.state),
						properties: taint(node.properties),
						methods: taint(node.methods),
						events: taint(node.events),
						sourceSlots: taint(node.sourceSlots),
					}),
			invalidCycles: taint(real.invalidCycles),
			getNodeId: real.getNodeId,
		} as unknown as typeof real
		for (const minor of [1, 2, 3, INSPECTOR_PROTOCOL_VERSION.minor]) {
			const projected = projectBlueprintSnapshot('runtime-x', hostile, minor)
			expect(JSON.stringify(projected), `minor ${minor}`).not.toContain(LEAK)
		}
	}

	it('carries authorWritable and valueContractId only at protocol 0.4 and newer', async () => {
		const runtime = createBlueprint()
			.createRuntime()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-x' })
		const client = createInspectorClient(pair.client)
		const nodeAt = async (minor: number): Promise<InspectorBlueprintNode> => {
			await client.request('handshake', { protocol: { major: 0, minor } })
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })
			return snapshot.nodes[0]!
		}
		try {
			const previous = await nodeAt(3)
			expect(nodeKeys(previous.state![0] as unknown as Record<string, unknown>))
				.toEqual(['name', 'type'])
			for (const property of previous.properties!) {
				expect(nodeKeys(property as unknown as Record<string, unknown>))
					.toEqual(['dependencies', 'name', 'type'])
			}

			const current = await nodeAt(4)
			expect(current.state)
				.toEqual([{ type: 'state', name: 'count', authorWritable: true }])
			expect(Object.fromEntries(current.properties!.map(property => [property.name, property.valueContractId])))
				.toEqual({ label: 'example/label@1', doubled: null })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('carries transitivelyEmits on Method members only at protocol 0.4 and newer', async () => {
		const runtime = createBlueprint()
			.createRuntime()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-x' })
		const client = createInspectorClient(pair.client)
		const nodeAt = async (minor: number): Promise<InspectorBlueprintNode> => {
			await client.request('handshake', { protocol: { major: 0, minor } })
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })
			return snapshot.nodes[0]!
		}
		try {
			const previous = await nodeAt(3)
			for (const method of previous.methods!) {
				expect(nodeKeys(method as unknown as Record<string, unknown>))
					.toEqual(['dependencies', 'name', 'transitivelyWrites', 'type'])
			}

			const current = await nodeAt(4)
			expect(Object.fromEntries(current.methods!.map(method => [method.name, [method.transitivelyWrites, method.transitivelyEmits]])))
				.toEqual({ bump: [true, false], ping: [false, true] })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('accepts a Method member without transitivelyEmits below protocol 0.4 and requires a boolean from 0.4 on', () => {
		const node = projectBlueprintSnapshot('runtime-x', inspectBlueprint(createBlueprint()), 4).nodes[0]!
		const withoutEmits = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item: unknown) => key === 'transitivelyEmits' ? undefined : item))
		const withEmits = (value: unknown, emits: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item: unknown) => key === 'transitivelyEmits' ? emits : item))

		expect(isBlueprintNode(node, 4))
			.toBe(true)
		expect(isBlueprintNode(withoutEmits(node), 4))
			.toBe(false)
		expect(isBlueprintNode(withEmits(node, 'yes'), 4))
			.toBe(false)
		expect(isBlueprintNode(withoutEmits(node), 3))
			.toBe(true)
		expect(isBlueprintNode(node, 3))
			.toBe(true)
		expect(isBlueprintNode(withEmits(node, 'yes'), 3))
			.toBe(false)
	})

	it('declares the new minor and reports it in the handshake', async () => {
		expect(INSPECTOR_PROTOCOL_VERSION)
			.toEqual({ major: 0, minor: 4 })
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime: createBlueprint()
			.createRuntime(), transport: pair.agent })
		const client = createInspectorClient(pair.client)
		try {
			expect((await client.handshake()).protocol)
				.toEqual({ major: 0, minor: 4 })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})

describe('client-side modules do not depend on Core', () => {
	it.each(['protocol', 'client', 'validation', 'value', 'transport', 'channel', 'frame-bootstrap', 'anchor'])('%s.ts imports nothing from @deviltea/widget-core', (name) => {
		const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8')
		expect(source).not.toContain('@deviltea/widget-core')
	})
})
