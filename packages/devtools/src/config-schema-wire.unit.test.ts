import type { WidgetConfigJsonSchema } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { isInspectorRequestResult } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'

interface ConfigWireInterfaces {
	config: {
		raw: { readonly variant?: 'primary' | 'secondary' }
		resolved: { readonly variant: 'primary' | 'secondary' }
	}
}

const schema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: {
		variant: {
			enum: ['primary', 'secondary'],
			default: 'primary',
		},
	},
	$defs: {
		nonEmptyString: {
			type: 'string',
			minLength: 1,
		},
	},
	additionalProperties: false,
} satisfies WidgetConfigJsonSchema

const ConfigPlugin = createWidgetPlugin('ConfigWireFixture')
	.description('Config wire fixture')
	.interfaces<ConfigWireInterfaces>()
	.config({
		description: 'Config wire authoring metadata',
		schema,
		validate: (input): input is ConfigWireInterfaces['config']['raw'] => typeof input === 'object' && input !== null,
		resolve: raw => ({ variant: raw?.variant ?? 'primary' }),
	})
	.done()

function createFixture() {
	const system = createWidgetSystem({ plugins: [ConfigPlugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'ConfigWireFixture' })
	if (blueprint.status !== 'valid')
		throw new Error('Expected config wire fixture to compile.')
	const runtime = blueprint.createRuntime()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-config-schema' })
	const client = createInspectorClient(pair.client)
	return { agent, client }
}

describe('serialized config schema metadata', () => {
	it('projects the complete Draft 2020-12 document directly without InspectableValue encoding', async () => {
		const { agent, client } = createFixture()
		try {
			const blueprint = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-config-schema' })
			const root = blueprint.nodes.find(node => node.widgetId === 'root')
			expect(root?.config)
				.toEqual({
					description: 'Config wire authoring metadata',
					schema,
				})
			expect(root?.config?.schema)
				.toHaveProperty('$schema', 'https://json-schema.org/draft/2020-12/schema')
			expect(root?.config?.schema)
				.toHaveProperty('$defs')
			expect(root?.config?.schema).not.toHaveProperty('entries')
			expect(root?.config?.schema).not.toHaveProperty('truncated')
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('wire validation checks JSON-safety, not JSON Schema semantic validity', () => {
		const semanticallyInvalidButJsonSafe = {
			runtimeId: 'runtime-config-schema',
			rootNodeId: 0,
			nodes: [{
				nodeId: 0,
				resolved: true,
				widgetId: 'root',
				widgetType: 'ConfigWireFixture',
				capabilities: { config: true, slots: false, state: false, properties: false, methods: false, events: false },
				config: {
					description: 'Malformed by schema semantics, still JSON-safe',
					schema: { type: 'definitely-not-a-real-type' },
				},
				sourceSlots: [],
				semanticSlots: [],
				state: [],
				properties: [],
				methods: [],
				events: [],
				diagnostics: [],
			}],
			invalidCycles: [],
		}

		expect(isInspectorRequestResult('blueprint.getSnapshot', semanticallyInvalidButJsonSafe))
			.toBe(true)

		const nonJsonSchemaPayload = structuredClone(semanticallyInvalidButJsonSafe) as any
		nonJsonSchemaPayload.nodes[0].config.schema = { bad: () => {} }
		expect(isInspectorRequestResult('blueprint.getSnapshot', nonJsonSchemaPayload))
			.toBe(false)
	})
})
