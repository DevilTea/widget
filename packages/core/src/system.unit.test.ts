import { describe, expect, it, vi } from 'vitest'
import * as core from './index'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemConfigurationError } from './index'

function plain(type: string) {
	return createWidgetPlugin(type)
		.description(type)
		.interfaces<Record<never, never>>()
		.done()
}

function capture(run: () => unknown): unknown {
	try {
		run()
	}
	catch (error) {
		return error
	}
	return undefined
}

/** A separately evaluated copy of the module: its brand Symbols differ from this instance's. */
async function loadForeignCore(): Promise<typeof core> {
	vi.resetModules()
	return await import('./index')
}

describe('createWidgetSystem plugin registration errors', () => {
	it('is exported from the package root with its code union', () => {
		expect(typeof core.WidgetSystemConfigurationError)
			.toBe('function')
	})

	it('rejects a plugin completed by another module instance with foreign-plugin', async () => {
		const foreign = await loadForeignCore()
		const foreignPlugin = foreign.createWidgetPlugin('alien')
			.description('Alien')
			.interfaces<Record<never, never>>()
			.done()

		const error = capture(() => createWidgetSystem({ plugins: [plain('ok'), foreignPlugin] as never }))

		expect(error)
			.toBeInstanceOf(WidgetSystemConfigurationError)
		expect(error)
			.toMatchObject({ code: 'foreign-plugin', pluginIndex: 1, pluginType: 'alien' })
	})

	it('rejects null and structural look-alike entries with foreign-plugin', () => {
		const nullError = capture(() => createWidgetSystem({ plugins: [null] as never }))
		expect(nullError)
			.toBeInstanceOf(WidgetSystemConfigurationError)
		expect(nullError)
			.toMatchObject({ code: 'foreign-plugin', pluginIndex: 0, pluginType: null })

		const lookAlike = { type: 'X', description: 'X', capabilities: {}, config: null, descriptions: { config: null, slots: null } }
		const lookAlikeError = capture(() => createWidgetSystem({ plugins: [plain('ok'), lookAlike] as never }))
		expect(lookAlikeError)
			.toBeInstanceOf(WidgetSystemConfigurationError)
		expect(lookAlikeError)
			.toMatchObject({ code: 'foreign-plugin', pluginIndex: 1, pluginType: 'X' })
	})

	it('still throws foreign-plugin when the foreign entry has a throwing type getter', () => {
		const hostile = Object.defineProperty({}, 'type', {
			get() {
				throw new Error('boom')
			},
		})

		const error = capture(() => createWidgetSystem({ plugins: [hostile] as never }))

		expect(error)
			.toBeInstanceOf(WidgetSystemConfigurationError)
		expect(error)
			.toMatchObject({ code: 'foreign-plugin', pluginIndex: 0, pluginType: null, firstPluginIndex: null })
	})

	it('lets a foreign plugin at index 0 win over a later valid duplicate', () => {
		const error = capture(() => createWidgetSystem({ plugins: [{ type: 'd' }, plain('d'), plain('d')] as never }))

		expect(error)
			.toMatchObject({ code: 'foreign-plugin', pluginIndex: 0, pluginType: 'd' })
	})

	it('reports duplicate-plugin-type with both indexes', () => {
		const error = capture(() => createWidgetSystem({ plugins: [plain('a'), plain('dup'), plain('b'), plain('dup')] }))

		expect(error)
			.toBeInstanceOf(WidgetSystemConfigurationError)
		expect(error)
			.toMatchObject({ code: 'duplicate-plugin-type', pluginIndex: 3, pluginType: 'dup', firstPluginIndex: 1 })
	})

	it('throws for the first offending index, and provenance precedes the duplicate check', () => {
		const dupThenForeign = capture(() => createWidgetSystem({ plugins: [plain('d'), plain('d'), null] as never }))
		expect(dupThenForeign)
			.toMatchObject({ code: 'duplicate-plugin-type', pluginIndex: 1 })

		const foreignThenDup = capture(() => createWidgetSystem({ plugins: [plain('d'), { type: 'd' }, plain('d')] as never }))
		expect(foreignThenDup)
			.toMatchObject({ code: 'foreign-plugin', pluginIndex: 1, pluginType: 'd' })
	})
})

describe('widgetSystem catalog', () => {
	it('rejects plugins with duplicate types', () => {
		const first = createWidgetPlugin('duplicate')
			.description('First')
			.interfaces<Record<never, never>>()
			.done()
		const second = createWidgetPlugin('duplicate')
			.description('Second')
			.interfaces<Record<never, never>>()
			.done()

		expect(capture(() => createWidgetSystem({ plugins: [first, second] })))
			.toBeInstanceOf(WidgetSystemConfigurationError)
	})

	it('projects intrinsic plugin, config, and slot descriptions in registration order', () => {
		interface CardInterfaces {
			config: {
				raw: { readonly label?: string }
				resolved: { readonly label: string }
			}
			slots: 'content'
			events: {
				press: []
				change: [value: string]
			}
		}

		const card = createWidgetPlugin('card')
			.description('Card widget')
			.interfaces<CardInterfaces>()
			.config({
				description: 'Card configuration',
				validate: (input): input is { readonly label?: string } => typeof input === 'object' && input !== null,
				resolve: raw => ({ label: raw?.label ?? 'Card' }),
			})
			.slots({ content: { description: 'Card content' } })
			.events(events => events
				.press({ description: 'Card pressed' })
				.change({ description: 'Card value changed' }))
			.done()
		const label = createWidgetPlugin('label')
			.description('Label widget')
			.interfaces<Record<never, never>>()
			.done()
		const system = createWidgetSystem({ plugins: [card, label] })

		expect(system.catalog.widgets.map(widget => widget.type))
			.toEqual(['card', 'label'])
		expect(system.catalog.widgets[0])
			.toMatchObject({
				type: 'card',
				description: 'Card widget',
				descriptions: { config: 'Card configuration' },
			})
		expect(system.catalog.widgets[0]?.descriptions.slots?.get('content'))
			.toBe('Card content')
		expect(system.catalog.widgets[0]!.descriptions)
			.not.toHaveProperty('events')
		expect(system.catalog.widgets[1])
			.toMatchObject({
				type: 'label',
				description: 'Label widget',
				descriptions: { config: null, slots: null },
			})
		expect(Object.isFrozen(system.catalog))
			.toBe(true)
		expect(Object.isFrozen(system.catalog.widgets))
			.toBe(true)
	})
})
