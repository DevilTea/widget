import { describe, expect, it } from 'vitest'
import {
	INSPECT_ANCHOR_ID_ATTRIBUTE,
	INSPECT_ANCHOR_TYPE_ATTRIBUTE,
	inspectAnchorAttributes,
} from './anchor'

describe('inspect anchor contract', () => {
	it('names the two identity attributes', () => {
		expect(INSPECT_ANCHOR_ID_ATTRIBUTE)
			.toBe('data-widget-id')
		expect(INSPECT_ANCHOR_TYPE_ATTRIBUTE)
			.toBe('data-widget-type')
	})

	it('projects widgetId and widgetType onto exactly the two attributes and nothing else', () => {
		expect(inspectAnchorAttributes({ widgetId: 'counter-1', widgetType: 'Counter' }))
			.toStrictEqual({ 'data-widget-id': 'counter-1', 'data-widget-type': 'Counter' })
	})

	it('carries no Runtime or root identity', () => {
		const attributes = inspectAnchorAttributes({ widgetId: 'a', widgetType: 'B' })
		expect(Object.keys(attributes)
			.sort())
			.toStrictEqual(['data-widget-id', 'data-widget-type'])
	})

	it('returns a fresh record per call so renderers cannot share mutable state', () => {
		const identity = { widgetId: 'a', widgetType: 'B' }
		expect(inspectAnchorAttributes(identity)).not.toBe(inspectAnchorAttributes(identity))
	})
})
