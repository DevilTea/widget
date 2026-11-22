import type { WidgetChild, WidgetInterfaces } from '@deviltea/widget-core'
import type { WidgetDocs } from './widget-docs'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import sandboxDocs from 'virtual:widget-docs/sandbox'
import { describe, expect, it } from 'vitest'
import { sandboxSystem } from '../sandbox/system'
import { catalogToJson, createAuthorCatalogViewModel } from './catalog'

interface PanelInterfaces extends WidgetInterfaces {
	config: { raw: { label?: string }, resolved: { label: string } }
	slots: { body: WidgetChild }
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
	.interfaces<PanelInterfaces>()
	.config({
		validate: (input): input is { label?: string } => typeof input === 'object' && input !== null,
		resolve: raw => ({ label: raw?.label ?? '' }),
	})
	.slots({ body: {} })
	.methods(methods => methods.close({
		validateArgs: (args): args is [] => args.length === 0,
		emits: ['closed'],
		execute: ({ emit }) => {
			emit.closed('done')
		},
	}))
	.events(['closed', 'opened'])
	.done()

const fixtureSystem = createWidgetSystem({ plugins: [PanelPlugin] as const })

/** The prose fields of a documented member, the way `widgetDocs()` emits them. */
function text(summary: string, remarks = '') {
	return { summary, remarks, tags: {}, example: [], deprecated: null, see: [], defaultValue: null }
}

/** What `widgetDocs()` would generate for the fixture, reduced to the fields the catalog reads. */
const fixtureDocs = {
	docsVersion: 2,
	system: 'fixtureSystem',
	types: {},
	plugins: {
		Panel: {
			...text('Fixture panel'),
			config: text('Panel config'),
			slots: { body: text('Panel body') },
			events: { closed: text('The panel was closed.', 'Carries the reason.'), opened: text('The panel was opened.') },
		},
	},
} as unknown as WidgetDocs

const fixtureSources = { docs: fixtureDocs, configSchemas: { Panel: schema } }

describe('author catalog view-model', () => {
	it('preserves Core system.catalog as its source and does not use the curated Implementation registry', () => {
		const viewModel = createAuthorCatalogViewModel(sandboxSystem)

		expect(viewModel.catalog)
			.toBe(sandboxSystem.catalog)
		expect(viewModel.widgets[0]?.entry)
			.toBe(sandboxSystem.catalog.widgets[0])
		expect(viewModel.widgets.map(widget => widget.entry.type))
			.toEqual(sandboxSystem.catalog.widgets.map(widget => widget.type))
	})

	it('reads the plugin, config and slot descriptions from the generated documentation (Core 0.3 carries none)', () => {
		const [panel] = createAuthorCatalogViewModel(fixtureSystem, fixtureSources).widgets
		expect(panel?.description)
			.toBe('Fixture panel')
		expect(panel?.configDescription)
			.toBe('Panel config')
		expect(panel?.slots)
			.toEqual([{ name: 'body', description: 'Panel body' }])
		const stack = createAuthorCatalogViewModel(sandboxSystem, { docs: sandboxDocs }).widgets.find(widget => widget.entry.type === 'Stack')
		expect(stack?.description)
			.toBe('Sandbox stack widget.')
		expect(stack?.configDescription)
			.toBeNull()
	})

	it('reads nothing, and never throws, without documentation', () => {
		const [panel] = createAuthorCatalogViewModel(fixtureSystem).widgets
		expect([panel?.description, panel?.configDescription])
			.toEqual(['', ''])
		expect(panel?.slots)
			.toEqual([{ name: 'body', description: '' }])
		expect(panel?.events)
			.toEqual([{ name: 'closed', description: '' }, { name: 'opened', description: '' }])
	})

	it('exposes pretty config schema text only when the showcase hands the Lab a schema for the plugin', () => {
		const [panel] = createAuthorCatalogViewModel(fixtureSystem, fixtureSources).widgets
		expect(panel?.configSchemaText)
			.toBe(JSON.stringify(schema, null, 2))
		expect(createAuthorCatalogViewModel(fixtureSystem).widgets[0]?.configSchemaText)
			.toBeNull()
		expect(createAuthorCatalogViewModel(sandboxSystem, { docs: sandboxDocs }).widgets.every(widget => widget.configSchemaText === null))
			.toBe(true)
	})
})

describe('declared Events', () => {
	it('reads each plugin\'s Events through inspectPlugin, in declaration order, with their documentation', () => {
		const [panel] = createAuthorCatalogViewModel(fixtureSystem, fixtureSources).widgets
		expect(panel?.capabilities.events)
			.toBe(true)
		expect(panel?.events)
			.toEqual([
				{ name: 'closed', description: 'The panel was closed.\n\nCarries the reason.' },
				{ name: 'opened', description: 'The panel was opened.' },
			])
	})

	it('has none for a plugin without the Events capability', () => {
		const widgets = createAuthorCatalogViewModel(sandboxSystem).widgets
		expect(widgets.every(widget => !widget.capabilities.events && widget.events.length === 0))
			.toBe(true)
	})

	it('adds them to the copied catalog JSON, as null without the capability', () => {
		const { catalog, widgets } = createAuthorCatalogViewModel(fixtureSystem, fixtureSources)
		expect(catalogToJson(catalog, widgets).widgets[0]?.events)
			.toEqual({ closed: 'The panel was closed.\n\nCarries the reason.', opened: 'The panel was opened.' })
	})

	it('refuses to guess when a catalog entry has no view-model widget', () => {
		expect(() => catalogToJson(fixtureSystem.catalog, []))
			.toThrow('The catalog entry "Panel" has no view-model widget')
	})
})

describe('catalogToJson', () => {
	it('keeps the schema and turns slot maps into plain objects', () => {
		const json = catalogToJson(fixtureSystem.catalog, createAuthorCatalogViewModel(fixtureSystem, fixtureSources).widgets)
		expect(json)
			.toEqual({
				widgets: [{
					type: 'Panel',
					description: 'Fixture panel',
					config: { description: 'Panel config', schema },
					slots: { body: 'Panel body' },
					events: { closed: 'The panel was closed.\n\nCarries the reason.', opened: 'The panel was opened.' },
				}],
			})
		expect(JSON.parse(JSON.stringify(json)))
			.toEqual(json)
	})

	it('uses null for missing config and slots', () => {
		const widgets = catalogToJson(sandboxSystem.catalog, createAuthorCatalogViewModel(sandboxSystem, { docs: sandboxDocs }).widgets).widgets
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
