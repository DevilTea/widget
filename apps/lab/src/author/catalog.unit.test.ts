import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { sandboxSystem } from '../sandbox/system'
import { catalogToJson, createAuthorCatalogViewModel } from './catalog'

interface PanelInterfaces extends WidgetInterfaces {
	config: { raw: { label?: string }, resolved: { label: string } }
	slots: 'body'
}

const schema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	properties: { label: { type: 'string' } },
	additionalProperties: false,
} as const

const PanelPlugin = createWidgetPlugin('Panel')
	.description('Fixture panel')
	.interfaces<PanelInterfaces>()
	.config({
		description: 'Panel config',
		schema,
		validate: (input): input is { label?: string } => typeof input === 'object' && input !== null,
		resolve: raw => ({ label: raw?.label ?? '' }),
	})
	.slots({ body: { description: 'Panel body' } })
	.done()

const fixtureSystem = createWidgetSystem({ plugins: [PanelPlugin] as const })

describe('author catalog view-model', () => {
	it('preserves Core system.catalog as its source and does not use the curated Implementation registry', () => {
		const viewModel = createAuthorCatalogViewModel(sandboxSystem)

		expect(viewModel.catalog)
			.toBe(sandboxSystem.catalog)
		expect(viewModel.widgets[0]?.entry)
			.toBe(sandboxSystem.catalog.widgets[0])
		expect(viewModel.widgets.map(widget => widget.entry.type))
			.toEqual(sandboxSystem.catalog.widgets.map(widget => widget.type))
		expect(viewModel.widgets[0]?.entry.description)
			.toBe(sandboxSystem.catalog.widgets[0]?.description)
	})

	it('exposes pretty config schema text only when the plugin publishes a schema', () => {
		const [panel] = createAuthorCatalogViewModel(fixtureSystem).widgets
		expect(panel?.configSchemaText)
			.toBe(JSON.stringify(schema, null, 2))
		expect(createAuthorCatalogViewModel(sandboxSystem).widgets.every(widget => widget.configSchemaText === null))
			.toBe(true)
	})
})

describe('catalogToJson', () => {
	it('keeps the schema and turns slot maps into plain objects', () => {
		const json = catalogToJson(fixtureSystem.catalog)
		expect(json)
			.toEqual({
				widgets: [{
					type: 'Panel',
					description: 'Fixture panel',
					config: { description: 'Panel config', schema },
					slots: { body: 'Panel body' },
				}],
			})
		expect(JSON.parse(JSON.stringify(json)))
			.toEqual(json)
	})

	it('uses null for missing config and slots', () => {
		const widgets = catalogToJson(sandboxSystem.catalog).widgets
		const stack = widgets.find(widget => widget.type === 'Stack')
		expect(stack?.config)
			.toBeNull()
		expect(stack?.slots)
			.toEqual({ items: expect.any(String) })
		const counter = widgets.find(widget => widget.type === 'Counter')
		expect(counter?.slots)
			.toBeNull()
	})
})
