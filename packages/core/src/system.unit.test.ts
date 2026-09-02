import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from './index'

describe('widgetSystem catalog', () => {
	it('projects intrinsic plugin, config, and slot descriptions in registration order', () => {
		interface CardInterfaces {
			config: {
				raw: { readonly label?: string }
				resolved: { readonly label: string }
			}
			slots: 'content'
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
