/**
 * The config JSON Schemas and the Standard Schema guard, against a REAL system.
 *
 * The JSON Schemas are produced from the very schema objects that validate (`schemas.ts`), so these tests pin the
 * shape the Catalog and the Structure editor read, that Core publishes exactly that document, and that the guard
 * reports what the library says, verbatim, one diagnostic per issue.
 */

import { WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { describeField } from '../../lab/config-schema'
import {
	deliveryConfigJsonSchema,
	itemConfigJsonSchema,
	quoteConfigJsonSchema,
	rushSurchargeConfigJsonSchema,
	salesTaxConfigJsonSchema,
	volumeDiscountConfigJsonSchema,
} from './schemas'
import { guard, jsonSchemaOf } from './standard-schema'
import { quoteSystem } from './system'

const expectations = [
	{ type: 'Quote', schema: quoteConfigJsonSchema, properties: ['title', 'currency'], required: ['title', 'currency'] },
	{ type: 'Item', schema: itemConfigJsonSchema, properties: ['title', 'unitCents', 'papers', 'quantity', 'paper'], required: ['title', 'unitCents', 'papers'] },
	{ type: 'VolumeDiscount', schema: volumeDiscountConfigJsonSchema, properties: ['label', 'tiers'], required: ['label', 'tiers'] },
	{ type: 'RushSurcharge', schema: rushSurchargeConfigJsonSchema, properties: ['label', 'percent', 'enabled'], required: ['label', 'percent'] },
	{ type: 'Delivery', schema: deliveryConfigJsonSchema, properties: ['label', 'courierCents', 'freeOverCents', 'method'], required: ['label', 'courierCents'] },
	{ type: 'SalesTax', schema: salesTaxConfigJsonSchema, properties: ['label', 'percent'], required: ['label', 'percent'] },
] as const

describe('config JSON Schemas', () => {
	it.each(expectations)('$type: a closed Draft 2020-12 object naming exactly the keys of its config', ({ schema, properties, required }) => {
		expect(schema.$schema)
			.toBe(WIDGET_CONFIG_JSON_SCHEMA_DIALECT)
		expect(schema.type)
			.toBe('object')
		expect(schema.additionalProperties)
			.toBe(false)
		expect(Object.keys(schema.properties ?? {}))
			.toEqual(properties)
		expect(schema.required)
			.toEqual(required)
	})

	it('is what Core publishes in the catalog, for every plugin', () => {
		for (const { type, schema } of expectations) {
			const entry = quoteSystem.catalog.widgets.find(widget => widget.type === type)
			expect(entry?.config?.schema, type)
				.toEqual(schema)
		}
	})

	it('carries the validator\'s limits and the field descriptions the Structure editor shows as help', () => {
		const tiers = volumeDiscountConfigJsonSchema.properties!.tiers as Record<string, any>
		expect(tiers.type)
			.toBe('array')
		expect(tiers.minItems)
			.toBe(1)
		expect(tiers.items.properties.percent)
			.toMatchObject({ type: 'number', minimum: 0, maximum: 100 })
		expect(tiers.items.properties.minQuantity)
			.toMatchObject({ type: 'integer', minimum: 1 })
		expect(tiers.items.additionalProperties)
			.toBe(false)
		expect((tiers.items.properties.percent as { description?: string }).description)
			.toBe('The percentage taken off the subtotal.')
		expect(itemConfigJsonSchema.properties!.papers)
			.toMatchObject({ type: 'object', propertyNames: { pattern: '^[a-z][a-z0-9-]*$' }, additionalProperties: { type: 'object', additionalProperties: false } })
		expect(deliveryConfigJsonSchema.properties!.method)
			.toMatchObject({ enum: ['pickup', 'courier'] })
	})

	it('does not say that the first discount tier starts at 1: that gap is the buggy-rule defect', () => {
		const tiers = volumeDiscountConfigJsonSchema.properties!.tiers as Record<string, any>
		expect(tiers.items.properties.minQuantity.minimum)
			.toBe(1)
		expect(JSON.stringify(tiers))
			.not
			.toMatch(/first|const/)
	})

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

describe('guard() (Standard Schema -> Core predicate)', () => {
	function collector() {
		const diagnostics: unknown[] = []
		return { diagnostics, ctx: { addDiagnostic: (diagnostic: unknown) => void diagnostics.push(diagnostic), hasAnyDiagnostic: () => diagnostics.length > 0 } as never }
	}

	it('accepts a valid input and reports nothing', () => {
		const { ctx, diagnostics } = collector()
		expect(guard(v.number())(1, ctx))
			.toBe(true)
		expect(diagnostics)
			.toEqual([])
	})

	it('reports every issue with the library\'s own message and a Core path, and returns false', () => {
		const schema = v.strictObject({ a: v.number(), b: v.array(v.strictObject({ c: v.pipe(v.number(), v.maxValue(10)) })) })
		const { ctx, diagnostics } = collector()
		expect(guard(schema)({ a: 'x', b: [{ c: 11 }], extra: 1 }, ctx))
			.toBe(false)
		expect(diagnostics)
			.toEqual([
				{ message: 'Invalid type: Expected number but received "x"', path: ['a'], reason: 'standard-schema' },
				{ message: 'Invalid value: Expected <=10 but received 11', path: ['b', 0, 'c'], reason: 'standard-schema' },
				{ message: 'Invalid key: Expected never but received "extra"', path: ['extra'], reason: 'standard-schema' },
			])
	})

	it('reports an issue at the root without a path', () => {
		const { ctx, diagnostics } = collector()
		expect(guard(v.strictObject({}))('nope', ctx))
			.toBe(false)
		expect(diagnostics)
			.toEqual([{ message: 'Invalid type: Expected Object but received "nope"', reason: 'standard-schema' }])
	})

	it('throws instead of reading a Promise as success when a schema validates asynchronously', () => {
		const asynchronous = v.pipeAsync(v.string(), v.checkAsync(async () => true))
		expect(() => guard(asynchronous as never)('x', collector().ctx))
			.toThrow(TypeError)
	})

	it('refuses, at the type level, a schema whose output differs from its input (a transform)', () => {
		const transform = v.pipe(v.string(), v.transform(value => value.length))
		// @ts-expect-error -- Core keeps the validated input, so an input/output mismatch must not be accepted
		guard(transform)
		expect(true)
			.toBe(true)
	})

	it('jsonSchemaOf() throws for a library schema that exports no JSON Schema', () => {
		expect(() => jsonSchemaOf(v.string() as never))
			.toThrow(/does not export a JSON Schema/)
	})
})
