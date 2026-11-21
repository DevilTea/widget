import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { isInspectorRequestResult } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'

interface MetadataWireInterfaces extends WidgetInterfaces {
	config: {
		raw: { readonly variant?: 'primary' | 'secondary' }
		resolved: { readonly variant: 'primary' | 'secondary' }
	}
	methods: { fire: () => void }
	events: { fired: [] }
}

const ConfiguredPlugin = createWidgetPlugin('MetadataWireConfigured')
	.interfaces<MetadataWireInterfaces>()
	.config({
		validate: (input): input is MetadataWireInterfaces['config']['raw'] => typeof input === 'object' && input !== null,
		resolve: raw => ({ variant: raw?.variant ?? 'primary' }),
	})
	.methods(methods => methods.fire({
		validateArgs: (args): args is [] => args.length === 0,
		emits: ['fired'],
		execute: ({ emit }) => emit.fired(),
	}))
	.events(['fired'])
	.done()

const PlainPlugin = createWidgetPlugin('MetadataWirePlain')
	.interfaces<WidgetInterfaces>()
	.done()

const system = createWidgetSystem({ plugins: [ConfiguredPlugin, PlainPlugin] })

function createFixture(blueprintSource: Parameters<typeof system.createBlueprint>[0], runtimeId: string) {
	const blueprint = system.createBlueprint(blueprintSource)
	if (blueprint.status !== 'valid')
		throw new Error('Expected the fixture to compile.')
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime: blueprint.createRuntime(), transport: pair.agent, runtimeId })
	const client = createInspectorClient(pair.client)
	return { agent, client }
}

describe('config and Event metadata that protocol 1.0 no longer carries', () => {
	it('keeps config as a capability and carries no config metadata, schema or description', async () => {
		const { agent, client } = createFixture({ id: 'configured', type: 'MetadataWireConfigured', config: {} }, 'runtime-metadata')
		try {
			await client.handshake()
			const blueprint = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-metadata' })
			const node = blueprint.nodes.find(candidate => candidate.widgetId === 'configured')
			expect(node?.capabilities)
				.toEqual({ config: true, slots: false, state: false, properties: false, methods: true, events: true })
			expect(node)
				.not
				.toHaveProperty('config')
			expect(node?.events)
				.toEqual([{ type: 'event', name: 'fired' }])
			// No description or schema anywhere in the serialized snapshot.
			const wire = JSON.stringify(blueprint)
			expect(wire).not.toContain('description')
			expect(wire).not.toContain('schema')
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('reports a widget without a config declaration as capabilities.config false', async () => {
		const { agent, client } = createFixture({ id: 'plain', type: 'MetadataWirePlain' }, 'runtime-plain')
		try {
			const blueprint = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-plain' })
			expect(blueprint.nodes[0]?.capabilities?.config)
				.toBe(false)
			expect(blueprint.nodes[0])
				.not
				.toHaveProperty('config')
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('validates a snapshot without config or Event descriptions and ignores a leftover one', () => {
		const snapshot = {
			runtimeId: 'runtime-metadata',
			rootNodeId: 0,
			nodes: [{
				nodeId: 0,
				resolved: true,
				widgetId: 'root',
				widgetType: 'MetadataWireConfigured',
				capabilities: { config: true, slots: false, state: false, properties: false, methods: false, events: true },
				sourceSlots: [],
				semanticSlots: [],
				state: [],
				properties: [],
				methods: [],
				events: [{ type: 'event', name: 'fired' }],
				diagnostics: [],
			}],
			invalidCycles: [],
		}
		expect(isInspectorRequestResult('blueprint.getSnapshot', snapshot))
			.toBe(true)

		// Unknown extra fields are ignored, as everywhere else on the wire: a peer's leftover `config` or
		// `description` neither fails validation nor is read.
		const leftover = structuredClone(snapshot) as unknown as { nodes: Record<string, unknown>[] }
		leftover.nodes[0]!.config = { description: 'old', schema: null }
		;(leftover.nodes[0]!.events as Record<string, unknown>[])[0]!.description = 'old'
		expect(isInspectorRequestResult('blueprint.getSnapshot', leftover))
			.toBe(true)

		const unnamed = structuredClone(snapshot) as unknown as { nodes: { events: Record<string, unknown>[] }[] }
		delete unnamed.nodes[0]!.events[0]!.name
		expect(isInspectorRequestResult('blueprint.getSnapshot', unnamed))
			.toBe(false)
	})
})
