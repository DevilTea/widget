// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createWidgetPlugin, createWidgetSystem, createWidgetValueContract, undocumented } from '@deviltea/widget-core'
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
	.description(undocumented)
	.interfaces<WireInterfaces>()
	.state(state => state.count({
		description: undocumented,
		authorWritable: true,
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.properties(properties => properties
		.label({ description: undocumented, valueContract: contract, compute: () => 'x' })
		.doubled({
			description: undocumented,
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps }) => (deps.count().ok ? 2 : 0),
		}))
	.methods(methods => methods
		.bump({
			description: undocumented,
			registerDeps: ({ dep }) => ({ set: dep.self.state.set('count'), absent: dep.parent.optional().state.get('count') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => 1,
		})
		.ping({
			description: undocumented,
			validateArgs: (args): args is [] => args.length === 0,
			emits: ['pinged'],
			execute: ({ emit }) => emit.pinged(),
		}))
	.events({ pinged: undocumented })
	.done()

interface CycleInterfaces {
	properties: { p1: unknown, p2: unknown }
}

const CyclePlugin = createWidgetPlugin('WireCycle')
	.description(undocumented)
	.interfaces<CycleInterfaces>()
	.properties(properties => properties
		.p1({ description: undocumented, registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p2') }), compute: () => null })
		.p2({ description: undocumented, registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p1') }), compute: () => null }))
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
		const projected = projectBlueprintSnapshot('runtime-x', hostile, {})
		expect(JSON.stringify(projected)).not.toContain(LEAK)
	}

	it('carries authorWritable and valueContractId on every State and Property member', async () => {
		const runtime = createBlueprint()
			.createRuntime()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-x' })
		const client = createInspectorClient(pair.client)
		try {
			await client.handshake()
			const node = (await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })).nodes[0]!
			expect(node.state)
				.toEqual([{ type: 'state', name: 'count', authorWritable: true }])
			expect(Object.fromEntries(node.properties!.map(property => [property.name, property.valueContractId])))
				.toEqual({ label: 'example/label@1', doubled: null })
			for (const property of node.properties!) {
				expect(nodeKeys(property as unknown as Record<string, unknown>))
					.toEqual(['dependencies', 'name', 'type', 'valueContractId'])
			}
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('carries transitivelyEmits on every Method member', async () => {
		const runtime = createBlueprint()
			.createRuntime()
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-x' })
		const client = createInspectorClient(pair.client)
		try {
			await client.handshake()
			const node = (await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })).nodes[0]!
			expect(Object.fromEntries(node.methods!.map(method => [method.name, [method.transitivelyWrites, method.transitivelyEmits]])))
				.toEqual({ bump: [true, false], ping: [false, true] })
			for (const method of node.methods!) {
				expect(nodeKeys(method as unknown as Record<string, unknown>))
					.toEqual(['dependencies', 'name', 'transitivelyEmits', 'transitivelyWrites', 'type'])
			}
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('requires the member metadata that protocol 1.0 always carries', () => {
		const node = projectBlueprintSnapshot('runtime-x', inspectBlueprint(createBlueprint()), {}).nodes[0]!
		const without = (value: unknown, name: string): unknown => JSON.parse(JSON.stringify(value, (key, item: unknown) => key === name ? undefined : item))
		const withValue = (value: unknown, name: string, replacement: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item: unknown) => key === name ? replacement : item))

		expect(isBlueprintNode(node))
			.toBe(true)
		// `valueContractId` is `null` for an undeclared contract, so removing it is not the same as the null value.
		for (const name of ['transitivelyEmits', 'authorWritable']) {
			expect(isBlueprintNode(without(node, name)), name)
				.toBe(false)
		}
		expect(isBlueprintNode(without(node, 'valueContractId')))
			.toBe(false)
		expect(isBlueprintNode(withValue(node, 'transitivelyEmits', 'yes')))
			.toBe(false)
		expect(isBlueprintNode(withValue(node, 'authorWritable', 'yes')))
			.toBe(false)
		expect(isBlueprintNode(withValue(node, 'valueContractId', 7)))
			.toBe(false)
	})

	it('declares protocol 1.0 and reports it in the handshake', async () => {
		expect(INSPECTOR_PROTOCOL_VERSION)
			.toEqual({ major: 1, minor: 0 })
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime: createBlueprint()
			.createRuntime(), transport: pair.agent })
		const client = createInspectorClient(pair.client)
		try {
			expect((await client.handshake()).protocol)
				.toEqual({ major: 1, minor: 0 })
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
