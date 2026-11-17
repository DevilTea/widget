import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { sandboxSystem } from '../sandbox/system'
import { catalogToJson, createAuthorCatalogViewModel } from './catalog'

interface PanelInterfaces extends WidgetInterfaces {
	config: { raw: { label?: string }, resolved: { label: string } }
	slots: 'body'
	methods: { close: () => void }
	events: { closed: [reason: string], opened: [] }
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
	.methods(methods => methods.close({
		validateArgs: (args): args is [] => args.length === 0,
		emits: ['closed'],
		execute: ({ emit }) => {
			emit.closed('done')
		},
	}))
	.events(events => events
		.closed({ description: 'The panel was closed. Carries the reason.' })
		.opened({ description: 'The panel was opened.' }))
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

describe('declared Events', () => {
	it('reads each plugin\'s Events with their descriptions through inspectPlugin, in declaration order', () => {
		const [panel] = createAuthorCatalogViewModel(fixtureSystem).widgets
		expect(panel?.capabilities.events)
			.toBe(true)
		expect(panel?.events)
			.toEqual([
				{ name: 'closed', description: 'The panel was closed. Carries the reason.' },
				{ name: 'opened', description: 'The panel was opened.' },
			])
	})

	it('has none for a plugin without the Events capability', () => {
		const widgets = createAuthorCatalogViewModel(sandboxSystem).widgets
		expect(widgets.every(widget => !widget.capabilities.events && widget.events.length === 0))
			.toBe(true)
	})

	it('adds them to the copied catalog JSON, as null without the capability', () => {
		const { catalog, widgets } = createAuthorCatalogViewModel(fixtureSystem)
		expect(catalogToJson(catalog, widgets).widgets[0]?.events)
			.toEqual({ closed: 'The panel was closed. Carries the reason.', opened: 'The panel was opened.' })
		// Without the view-model's widgets there is nothing to read Events from.
		expect(catalogToJson(catalog).widgets[0]?.events)
			.toBeNull()
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
					events: null,
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
