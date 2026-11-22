/**
 * The config JSON Schemas and the Standard Schema guard, against a REAL system.
 *
 * The JSON Schemas are produced from the very schema objects that validate (`schemas.ts`), so these tests pin the
 * shape the Catalog and the Structure editor read, that the showcase hands exactly that document to the Lab, and that the guard
 * reports what the library says, verbatim, one diagnostic per issue.
 */

import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { CONFIG_JSON_SCHEMA_DIALECT } from '../../showcase-host'
import {
	deliveryConfigJsonSchema,
	itemConfigJsonSchema,
	quoteConfigJsonSchema,
	quoteConfigSchemas,
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
			.toBe(CONFIG_JSON_SCHEMA_DIALECT)
		expect(schema.type)
			.toBe('object')
		expect(schema.additionalProperties)
			.toBe(false)
		expect(Object.keys(schema.properties ?? {}))
			.toEqual(properties)
		expect(schema.required)
			.toEqual(required)
	})

	it('is what the showcase hands to the Lab, for every plugin of the system (Core 0.3 publishes no config schema)', () => {
		expect(quoteSystem.catalog.widgets.map(widget => widget.type))
			.toEqual(expectations.map(({ type }) => type))
		for (const { type, schema } of expectations) {
			expect(quoteConfigSchemas[type], type)
				.toBe(schema)
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
