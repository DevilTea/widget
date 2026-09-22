import type { WidgetConfigJsonSchema } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from './index'

interface ConfigInterfaces {
	config: {
		raw: { readonly mode?: 'a' | 'b' }
		resolved: { readonly mode: 'a' | 'b' }
	}
}

const schema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: {
		mode: { enum: ['a', 'b'] },
	},
	additionalProperties: false,
} satisfies WidgetConfigJsonSchema

function inspectPlugin(plugin: ReturnType<typeof createWidgetPlugin<any>> extends never ? never : any) {
	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: plugin.type })
	const inspection = inspectBlueprint(blueprint)
	const root = inspection.getNode(inspection.rootNodeId)
	if (root === null || !root.resolved)
		throw new Error('Expected resolved root.')
	return root
}

describe('blueprint inspection config schema metadata', () => {
	it('projects complete config schema metadata directly', () => {
		const plugin = createWidgetPlugin('inspection-config')
			.description('Inspection config')
			.interfaces<ConfigInterfaces>()
			.config({
				description: 'Inspection authoring config',
				schema,
				validate: (input): input is ConfigInterfaces['config']['raw'] => typeof input === 'object' && input !== null,
				resolve: raw => ({ mode: raw?.mode ?? 'a' }),
			})
			.done()

		const root = inspectPlugin(plugin)
		expect(root.config)
			.toEqual({
				description: 'Inspection authoring config',
				schema,
			})
		expect(root.config?.schema)
			.toBe(schema)
	})

	it('preserves the three config metadata states', () => {
		const noConfig = createWidgetPlugin('inspection-no-config')
			.description('No config')
			.interfaces<Record<never, never>>()
			.done()
		const withoutSchema = createWidgetPlugin('inspection-no-schema')
			.description('No schema')
			.interfaces<ConfigInterfaces>()
			.config({
				description: 'Config without schema',
				validate: (input): input is ConfigInterfaces['config']['raw'] => typeof input === 'object' && input !== null,
				resolve: raw => ({ mode: raw?.mode ?? 'a' }),
			})
			.done()

		expect(inspectPlugin(noConfig).config)
			.toBeNull()
		expect(inspectPlugin(withoutSchema).config)
			.toEqual({
				description: 'Config without schema',
				schema: null,
			})
	})
})
