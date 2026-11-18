/**
 * The quote presets compile (or fail to) exactly as they claim, against the REAL system.
 */

import { describe, expect, it } from 'vitest'
import { defaultQuotePreset, quotePresets } from './presets'
import { quoteSystem } from './system'
import { createQuoteRuntime, presetText, valueOf, widgetOfType } from './test-support'

function widgetsOf(source: any): any[] {
	return [source, ...Object.values<any[]>(source.slots ?? {})
		.flatMap(children => children.flatMap(widgetsOf))]
}

describe('quotePresets', () => {
	it('lists the default first, then the invalid-config and buggy-rule examples', () => {
		expect(quotePresets.map(preset => preset.id))
			.toEqual(['quote-default', 'quote-invalid', 'quote-buggy-rule'])
		expect(defaultQuotePreset.id)
			.toBe('quote-default')
		expect(new Set(quotePresets.map(preset => preset.label)).size)
			.toBe(3)
	})

	it('is plain JSON that uses only Core\'s recognised widget keys and unique ids', () => {
		for (const preset of quotePresets) {
			const widgets = widgetsOf(JSON.parse(preset.sourceText))
			for (const widget of widgets) {
				expect(Object.keys(widget)
					.every(key => ['id', 'type', 'config', 'slots'].includes(key)), `${preset.id} ${widget.id}`)
					.toBe(true)
			}
			const ids = widgets.map(widget => widget.id)
			expect(new Set(ids).size, preset.id)
				.toBe(ids.length)
		}
	})

	it('quote-default is valid and uses every plugin type', () => {
		const blueprint = quoteSystem.createBlueprint(JSON.parse(presetText('quote-default')))
		expect(blueprint.status)
			.toBe('valid')
		expect(new Set(widgetsOf(JSON.parse(presetText('quote-default')))
			.map(widget => widget.type)))
			.toEqual(new Set(['Quote', 'Item', 'VolumeDiscount', 'RushSurcharge', 'Delivery', 'SalesTax']))
	})

	it('quote-invalid has six located config diagnostics in five widgets, all from the schema library', () => {
		const blueprint = quoteSystem.createBlueprint(JSON.parse(presetText('quote-invalid')))
		expect(blueprint.status)
			.toBe('invalid')
		const found = blueprint.diagnostics.map((diagnostic) => {
			const location = diagnostic.location
			return {
				code: diagnostic.code,
				widget: location.type === 'source' ? null : location.node.id,
				path: 'path' in diagnostic ? diagnostic.path : undefined,
				reason: (diagnostic as { reason?: string }).reason,
			}
		})
		expect(found)
			.toEqual([
				{ code: 'invalid-widget-config', widget: 'flyers', path: ['unitCents'], reason: 'standard-schema' },
				{ code: 'invalid-widget-config', widget: 'cards', path: ['quantity'], reason: 'standard-schema' },
				{ code: 'invalid-widget-config', widget: 'cards', path: ['finish'], reason: 'standard-schema' },
				{ code: 'invalid-widget-config', widget: 'volume', path: ['tiers', 1, 'percent'], reason: 'standard-schema' },
				{ code: 'invalid-widget-config', widget: 'rush', path: ['label', 'en'], reason: 'standard-schema' },
				{ code: 'invalid-widget-config', widget: 'quote', path: ['currency'], reason: 'standard-schema' },
			])
		expect(new Set(found.map(entry => entry.widget)).size)
			.toBe(5)
	})

	it('quote-buggy-rule is a VALID document whose volume tiers start at 100, below which the rule throws', () => {
		const document = JSON.parse(presetText('quote-buggy-rule'))
		expect(quoteSystem.createBlueprint(document).status)
			.toBe('valid')
		const volume = widgetsOf(document)
			.find(widget => widget.id === 'volume')
		expect(volume.config.tiers[0].minQuantity)
			.toBe(100)
		// No widget named `rush`: the tour reads that to tell this preset from the default.
		expect(widgetsOf(document)
			.some(widget => widget.id === 'rush'))
			.toBe(false)
		const { runtime } = createQuoteRuntime(presetText('quote-buggy-rule'))
		expect(widgetOfType(runtime, 'flyers', 'Item').state.quantity.get())
			.toBe(120)
		expect(valueOf(widgetOfType(runtime, 'quote', 'Quote').properties.quote.get()).adjustments[0])
			.toMatchObject({ id: 'volume', percent: 5 })
	})
})
