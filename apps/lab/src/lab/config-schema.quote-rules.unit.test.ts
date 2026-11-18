/**
 * What the Structure editor makes of the quote plugins' config JSON Schemas (`describeField`, the reader behind its
 * controls): the schemas come from the showcase's own Valibot schema objects through Standard JSON Schema, so this pins
 * that a list of tiers, a number box, a switch, a choice list and free map keys are what the editor offers for them.
 * It lives with the Lab's code, not in the showcase, because a showcase test may not import the Lab.
 */

import { describe, expect, it } from 'vitest'
import { deliveryConfigJsonSchema, itemConfigJsonSchema, rushSurchargeConfigJsonSchema, volumeDiscountConfigJsonSchema } from '../showcases/quote-rules/schemas'
import { describeField } from './config-schema'

describe('the Structure editor over the quote plugins\' config JSON Schemas', () => {
	it('gives the Structure editor real controls: a list of tiers with Add and Remove, a switch, a choice list and number boxes', () => {
		const volume = { label: { en: 'Volume' }, tiers: [{ minQuantity: 1, percent: 0 }] }
		const root = describeField(volumeDiscountConfigJsonSchema, volumeDiscountConfigJsonSchema, volume)
		expect(root.field.kind)
			.toBe('object')
		const properties = (root.field as { properties: Record<string, Record<string, unknown>> }).properties
		const tiers = describeField(volumeDiscountConfigJsonSchema, properties.tiers!, volume.tiers)
		expect(tiers.field)
			.toMatchObject({ kind: 'array', known: true, minItems: 1 })
		const tier = describeField(volumeDiscountConfigJsonSchema, (tiers.field as { items: Record<string, unknown> }).items, volume.tiers[0])
		const tierProperties = (tier.field as { properties: Record<string, Record<string, unknown>> }).properties
		const percent = describeField(volumeDiscountConfigJsonSchema, tierProperties.percent!, 0)
		expect(percent.field.kind)
			.toBe('number')
		expect(percent.description)
			.toBe('The percentage taken off the subtotal.')

		const rush = { label: { en: 'Rush' }, percent: 25 }
		const rushProperties = (describeField(rushSurchargeConfigJsonSchema, rushSurchargeConfigJsonSchema, rush).field as { properties: Record<string, Record<string, unknown>> }).properties
		expect(describeField(rushSurchargeConfigJsonSchema, rushProperties.enabled!, true).field.kind)
			.toBe('boolean')

		const delivery = { label: { en: 'Delivery' }, courierCents: 900 }
		const deliveryProperties = (describeField(deliveryConfigJsonSchema, deliveryConfigJsonSchema, delivery).field as { properties: Record<string, Record<string, unknown>> }).properties
		expect(describeField(deliveryConfigJsonSchema, deliveryProperties.method!, 'pickup').field)
			.toEqual({ kind: 'enum', options: ['pickup', 'courier'] })

		const item = { title: { en: 'A' }, unitCents: 1, papers: { a: { label: { en: 'A' }, extraCents: 0 } } }
		const itemProperties = (describeField(itemConfigJsonSchema, itemConfigJsonSchema, item).field as { properties: Record<string, Record<string, unknown>> }).properties
		expect(describeField(itemConfigJsonSchema, itemProperties.papers!, item.papers).field)
			.toMatchObject({ kind: 'object', known: true })
	})
})
