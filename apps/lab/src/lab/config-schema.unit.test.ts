import type { JsonSchema } from './config-schema'
import { describe, expect, it } from 'vitest'
import { multipleChoiceConfigSchema, numericConfigSchema, shortAnswerConfigSchema, surveyConfigSchema } from '../showcases/survey/schemas'
import { canAddItem, canRemoveItem, canRemoveKey, defaultValueFor, describeField, looksLike, objectFieldKeys, parseNumberText, resolveSchema } from './config-schema'

const numeric = numericConfigSchema as unknown as JsonSchema
const multiple = multipleChoiceConfigSchema as unknown as JsonSchema
const shortAnswer = shortAnswerConfigSchema as unknown as JsonSchema
const survey = surveyConfigSchema as unknown as JsonSchema
const property = (root: JsonSchema, key: string): JsonSchema => (root.properties as Record<string, JsonSchema>)[key]!

describe('describeField', () => {
	it('reads scalar controls from the schema type; the numeric limits stay Core\'s to check', () => {
		expect(describeField(numeric, property(numeric, 'integer'), true).field)
			.toEqual({ kind: 'boolean' })
		expect(describeField(numeric, property(numeric, 'min'), 0).field)
			.toEqual({ kind: 'number' })
		expect(describeField(shortAnswer, property(shortAnswer, 'maxLength'), 20).field)
			.toEqual({ kind: 'number' })
	})

	it('reads an enum from the schema options and keeps the description', () => {
		const languages = describeField(survey, property(survey, 'languages'), ['en'])
		expect(languages.field)
			.toMatchObject({ kind: 'array', minItems: 1, known: true })
		if (languages.field.kind !== 'array')
			throw new Error('expected an array field')
		const item = describeField(survey, languages.field.items, 'en')
		expect(item.field)
			.toEqual({ kind: 'enum', options: ['en', 'zh-TW'] })
		expect(languages.description)
			.toMatch(/languages the survey is offered in/)
	})

	it('picks the branch of a oneOf that the value fits: a boolean or a condition for "required"', () => {
		const required = property(multiple, 'required')
		expect(describeField(multiple, required, true).field)
			.toEqual({ kind: 'boolean' })
		const condition = describeField(multiple, required, { question: 'mode', op: 'equals', value: 'onsite' })
		expect(condition.field.kind)
			.toBe('object')
		if (condition.field.kind !== 'object')
			throw new Error('expected an object field')
		expect(Object.keys(condition.field.properties))
			.toEqual(['question', 'op', 'value'])
		expect([...condition.field.required])
			.toEqual(['question', 'op', 'value'])
		expect(describeField(multiple, required, { all: [] }).field.kind)
			.toBe('object')
	})

	it('falls back to editing the JSON text when no branch of a union fits', () => {
		expect(describeField(multiple, property(multiple, 'required'), 'sometimes').field)
			.toEqual({ kind: 'json' })
		expect(describeField(multiple, property(multiple, 'required'), { nonsense: 1 }).field)
			.toEqual({ kind: 'json' })
	})

	it('types a value by what it is when there is no schema, and offers no add or remove for it', () => {
		expect(describeField(null, null, true).field)
			.toEqual({ kind: 'boolean' })
		expect(describeField(null, null, 'text').field)
			.toEqual({ kind: 'string', maxLength: null })
		// Without a schema a whole number may become a decimal, as it could before.
		expect(describeField(null, null, 3).field)
			.toEqual({ kind: 'number' })
		const object = describeField(null, null, { a: 1 }).field
		const array = describeField(null, null, [1]).field
		if (object.kind !== 'object' || array.kind !== 'array')
			throw new Error('expected an object and an array')
		expect(canRemoveKey(object, 'a'))
			.toBe(false)
		expect(canAddItem(array, 1))
			.toBe(false)
		expect(canRemoveItem(array, 1))
			.toBe(false)
		expect(describeField(null, null, null).field)
			.toEqual({ kind: 'json' })
	})

	it('allows adding and removing only where the schema says so', () => {
		const config = describeField(numeric, numeric, { label: { en: 'x' }, min: 0 })
		if (config.field.kind !== 'object')
			throw new Error('expected an object field')
		expect(config.field.known)
			.toBe(true)
		expect(canRemoveKey(config.field, 'label'))
			.toBe(false)
		expect(canRemoveKey(config.field, 'min'))
			.toBe(true)
		expect(objectFieldKeys(config.field, { label: { en: 'x' }, min: 0 }))
			.toEqual({ present: ['label', 'min'], addable: ['help', 'required', 'visibleWhen', 'rules', 'max', 'integer'] })

		const languages = describeField(survey, property(survey, 'languages'), ['en'])
		if (languages.field.kind !== 'array')
			throw new Error('expected an array field')
		expect(canRemoveItem(languages.field, 1))
			.toBe(false)
		expect(canRemoveItem(languages.field, 2))
			.toBe(true)
		expect(canAddItem(languages.field, 2))
			.toBe(true)
	})

	it('reads the free keys of an object the schema leaves open (translations)', () => {
		const text = describeField(survey, property(survey, 'title'), { en: 'x' })
		if (text.field.kind !== 'object')
			throw new Error('expected an object field')
		expect(text.field.additional)
			.toMatchObject({ type: 'string' })
		expect(objectFieldKeys(text.field, { 'en': 'x', 'zh-TW': 'y' }))
			.toEqual({ present: ['en', 'zh-TW'], addable: [] })
	})
})

describe('defaultValueFor', () => {
	it('starts new values from the schema: required keys, minimums, first enum option, defaults', () => {
		expect(defaultValueFor(numeric, property(numeric, 'integer')))
			.toBe(false)
		expect(defaultValueFor(shortAnswer, property(shortAnswer, 'maxLength')))
			.toBe(1)
		const option = (property(multiple, 'options').items) as JsonSchema
		expect(defaultValueFor(multiple, option))
			.toEqual({ value: '', label: {} })
		expect(defaultValueFor(multiple, property(multiple, 'required')))
			.toBe(false)
		expect(defaultValueFor(survey, property(survey, 'languages')))
			.toEqual(['en'])
		expect(defaultValueFor(null, null))
			.toBeNull()
	})
})

describe('helpers', () => {
	it('resolves $ref and lets the sibling description win', () => {
		const resolved = resolveSchema(numeric, property(numeric, 'label'))
		expect(resolved)
			.toMatchObject({ type: 'object', description: expect.stringContaining('question text') })
		expect(resolveSchema(numeric, { $ref: '#/$defs/Missing' }))
			.toBeNull()
	})

	it('matches a value against a schema shallowly', () => {
		const condition = { $ref: '#/$defs/Condition' }
		expect(looksLike(multiple, condition, { question: 'a', op: 'answered' }))
			.toBe(true)
		expect(looksLike(multiple, condition, { question: 'a', op: 'bogus' }))
			.toBe(false)
		expect(looksLike(multiple, condition, { not: { question: 'a', op: 'answered' } }))
			.toBe(true)
	})

	it('parses number text in decimal notation only, and leaves the schema limits to Core', () => {
		for (const [text, expected] of [['3', 3], [' 12 ', 12], ['2.5', 2.5], ['-0.5', -0.5], ['.5', 0.5], ['1e3', 1000], ['0', 0], ['6', 6]] as const) {
			expect(parseNumberText(text))
				.toBe(expected)
		}
		for (const text of ['', '   ', 'abc', '0x10', '0b1', 'Infinity', 'NaN', '1,5', '1e999', '--1']) {
			expect(parseNumberText(text), JSON.stringify(text))
				.toBeNull()
		}
	})

	it('follows a local JSON Pointer $ref, decoding ~1, ~0 and percent escapes', () => {
		const root: JsonSchema = {
			$defs: { 'a/b': { type: 'string' }, 'c~d': { type: 'number' }, 'e f': { type: 'boolean' }, 'nested': { properties: { x: { type: 'integer' } } } },
		}
		expect(resolveSchema(root, { $ref: '#/$defs/a~1b' }))
			.toEqual({ type: 'string' })
		expect(resolveSchema(root, { $ref: '#/$defs/c~0d' }))
			.toEqual({ type: 'number' })
		expect(resolveSchema(root, { $ref: '#/$defs/e%20f' }))
			.toEqual({ type: 'boolean' })
		expect(resolveSchema(root, { $ref: '#/$defs/nested/properties/x' }))
			.toEqual({ type: 'integer' })
		expect(resolveSchema(root, { $ref: '#/$defs/a/b' }))
			.toBeNull()
		expect(resolveSchema(root, { $ref: '#/$defs/%E0%A4%A' }))
			.toBeNull()
		expect(resolveSchema(root, { $ref: 'https://example.com/schema' }))
			.toBeNull()
	})

	it('marks a value read as one branch of a union, so the editor can say other forms exist', () => {
		const required = describeField(multiple, property(multiple, 'required'), true)
		expect(required.viaUnion)
			.toBe(true)
		expect(describeField(multiple, property(multiple, 'minSelected'), 1).viaUnion)
			.toBeUndefined()
	})
})
