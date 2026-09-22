import type { WidgetConfigJsonSchema } from './index'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
	createWidgetPlugin,
	createWidgetSystem,
	WIDGET_CONFIG_JSON_SCHEMA_DIALECT,
} from './index'

interface ConfigInterfaces {
	config: {
		raw: { readonly label?: string, readonly count?: number }
		resolved: { readonly label: string, readonly count: number }
	}
}

const schema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: {
		label: { type: 'string', default: 'Label' },
		count: { type: 'number', minimum: 0 },
	},
	additionalProperties: false,
} satisfies WidgetConfigJsonSchema

function defineConfigPlugin(type: string, schemaMetadata?: WidgetConfigJsonSchema) {
	return createWidgetPlugin(type)
		.description('Config fixture')
		.interfaces<ConfigInterfaces>()
		.config({
			description: 'Fixture config',
			...(schemaMetadata === undefined ? {} : { schema: schemaMetadata }),
			validate: (input): input is ConfigInterfaces['config']['raw'] => typeof input === 'object' && input !== null,
			resolve: raw => ({
				label: raw?.label ?? 'Label',
				count: raw?.count ?? 0,
			}),
		})
		.done()
}

describe('draft 2020-12 config schema metadata', () => {
	it('exports the fixed dialect and accepts standard Draft 2020-12 schema documents, including boolean schemas', () => {
		expect(WIDGET_CONFIG_JSON_SCHEMA_DIALECT)
			.toBe('https://json-schema.org/draft/2020-12/schema')
		expectTypeOf(schema)
			.toMatchTypeOf<WidgetConfigJsonSchema>()

		const allowAll: WidgetConfigJsonSchema = true
		const denyAll: WidgetConfigJsonSchema = false
		expect(allowAll)
			.toBe(true)
		expect(denyAll)
			.toBe(false)

		const assertReadonly = (readonlyView: WidgetConfigJsonSchema): void => {
			if (typeof readonlyView === 'boolean')
				return
			// @ts-expect-error schema metadata is exposed as deeply readonly
			readonlyView.properties = {}
			const label = readonlyView.properties?.label
			if (label !== undefined && typeof label !== 'boolean') {
				// @ts-expect-error nested schema metadata is also readonly
				label.type = 'number'
			}
		}
		expectTypeOf(assertReadonly)
			.toBeFunction()
	})

	it('uses the Draft 2020-12 TypeScript keyword shapes', () => {
		const validNumberSchema: WidgetConfigJsonSchema = {
			type: 'number',
			exclusiveMaximum: 10,
		}
		expect(validNumberSchema)
			.toEqual({ type: 'number', exclusiveMaximum: 10 })

		const invalidDraftShape: WidgetConfigJsonSchema = {
			type: 'number',
			// @ts-expect-error Draft 2020-12 exclusiveMaximum is numeric, not the old boolean form
			exclusiveMaximum: true,
		}
		expect(invalidDraftShape)
			.toBeDefined()
	})

	it('preserves the schema document as passive metadata without executing or transforming it', () => {
		const plugin = defineConfigPlugin('with-schema', schema)
		expect(plugin.config)
			.toEqual({
				description: 'Fixture config',
				schema,
			})
		expect(plugin.config?.schema)
			.toBe(schema)
		expect(Object.isFrozen(plugin.config))
			.toBe(true)
		expect(schema.properties.label.default)
			.toBe('Label')
	})

	it('distinguishes no config capability, config without schema, and config with schema', () => {
		const noConfig = createWidgetPlugin('no-config')
			.description('No config')
			.interfaces<Record<never, never>>()
			.done()
		const withoutSchema = defineConfigPlugin('without-schema')
		const withSchema = defineConfigPlugin('with-schema', schema)
		const system = createWidgetSystem({ plugins: [noConfig, withoutSchema, withSchema] })

		expect(noConfig.config)
			.toBeNull()
		expect(withoutSchema.config)
			.toEqual({
				description: 'Fixture config',
				schema: null,
			})
		expect(withSchema.config?.schema)
			.toBe(schema)

		expect(system.catalog.widgets.map(entry => entry.config))
			.toEqual([
				null,
				{ description: 'Fixture config', schema: null },
				{ description: 'Fixture config', schema },
			])
	})

	it('does not runtime meta-validate a schema supplied under the plugin author contract', () => {
		const malformedByContract = {
			type: 'definitely-not-a-json-schema-type',
		} as unknown as WidgetConfigJsonSchema

		expect(() => defineConfigPlugin('author-responsibility', malformedByContract))
			.not.toThrow()

		const plugin = defineConfigPlugin('author-responsibility-2', malformedByContract)
		expect(plugin.config?.schema)
			.toBe(malformedByContract)
	})
})
