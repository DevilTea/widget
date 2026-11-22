/**
 * Schema agreement. Part 1: the schemas' shape matches the exported key and operator lists. Part 2 (at the
 * end): every real preset config satisfies its schema, through a small test-only checker.
 */

import { describe, expect, it } from 'vitest'
import { CONFIG_JSON_SCHEMA_DIALECT } from '../../showcase-host'
import {
	MULTIPLE_CHOICE_CONFIG_KEYS,
	NUMERIC_CONFIG_KEYS,
	OPTION_KEYS,
	QUESTION_CONFIG_KEYS,
	RULE_KEYS,
	SHORT_ANSWER_CONFIG_KEYS,
	SINGLE_CHOICE_CONFIG_KEYS,
	SURVEY_CONFIG_KEYS,
} from './config'
import { ANSWER_OPS, EQUALITY_OPS, MEMBERSHIP_OPS, ORDER_OPS, SUPPORTED_LANGUAGES } from './domain'
import { defaultSurveyPreset, surveyPresets } from './presets'
import {
	multipleChoiceConfigSchema,
	numericConfigSchema,
	shortAnswerConfigSchema,
	singleChoiceConfigSchema,
	surveyConfigSchema,
} from './schemas'

interface Json { readonly [key: string]: unknown }

const schemas = [
	['ShortAnswer', shortAnswerConfigSchema, SHORT_ANSWER_CONFIG_KEYS],
	['SingleChoice', singleChoiceConfigSchema, SINGLE_CHOICE_CONFIG_KEYS],
	['MultipleChoice', multipleChoiceConfigSchema, MULTIPLE_CHOICE_CONFIG_KEYS],
	['Numeric', numericConfigSchema, NUMERIC_CONFIG_KEYS],
	['Survey', surveyConfigSchema, SURVEY_CONFIG_KEYS],
] as const

function defsOf(schema: Json): Json {
	return schema.$defs as Json
}

function conditionBranches(schema: Json): readonly Json[] {
	return (defsOf(schema).Condition as Json).oneOf as readonly Json[]
}

/** Every `$ref` string found anywhere under `value`. */
function refsIn(value: unknown, into: string[] = []): string[] {
	if (Array.isArray(value)) {
		value.forEach(item => refsIn(item, into))
	}
	else if (typeof value === 'object' && value !== null) {
		for (const [key, item] of Object.entries(value)) {
			if (key === '$ref' && typeof item === 'string')
				into.push(item)
			else
				refsIn(item, into)
		}
	}
	return into
}

describe('config schemas', () => {
	it.each(schemas)('%s: top-level properties equal the exported key list', (_type, schema, keys) => {
		expect(Object.keys(schema.properties)
			.sort())
			.toEqual([...keys].sort())
	})

	it.each(schemas)('%s: declares the 2020-12 dialect and rejects unknown keys', (_type, schema) => {
		expect(schema.$schema)
			.toBe(CONFIG_JSON_SCHEMA_DIALECT)
		expect(schema.type)
			.toBe('object')
		expect(schema.additionalProperties)
			.toBe(false)
	})

	it('requires label (and options for choices), title and languages (Survey)', () => {
		expect(shortAnswerConfigSchema.required)
			.toEqual(['label'])
		expect(numericConfigSchema.required)
			.toEqual(['label'])
		expect(singleChoiceConfigSchema.required)
			.toEqual(['label', 'options'])
		expect(multipleChoiceConfigSchema.required)
			.toEqual(['label', 'options'])
		expect(surveyConfigSchema.required)
			.toEqual(['title', 'languages'])
	})

	it('every property has a description for the reader', () => {
		for (const [type, schema] of schemas) {
			for (const [key, property] of Object.entries(schema.properties)) {
				expect((property as Json).description, `${type}.${key}`)
					.toEqual(expect.any(String))
				expect(((property as Json).description as string).length, `${type}.${key}`)
					.toBeGreaterThan(20)
			}
		}
	})

	it('qUESTION_CONFIG_KEYS are shared by every question schema', () => {
		for (const [type, schema] of schemas.filter(([type]) => type !== 'Survey')) {
			for (const key of QUESTION_CONFIG_KEYS) {
				expect(Object.keys(schema.properties), `${type} has ${key}`)
					.toContain(key)
			}
		}
	})
})

describe('shared $defs', () => {
	it('question schemas share I18nText, Condition and Rule; choices add Option; Survey only I18nText', () => {
		expect(Object.keys(defsOf(shortAnswerConfigSchema)))
			.toEqual(['I18nText', 'Condition', 'Rule'])
		expect(Object.keys(defsOf(numericConfigSchema)))
			.toEqual(['I18nText', 'Condition', 'Rule'])
		expect(Object.keys(defsOf(singleChoiceConfigSchema)))
			.toEqual(['I18nText', 'Condition', 'Rule', 'Option'])
		expect(Object.keys(defsOf(multipleChoiceConfigSchema)))
			.toEqual(['I18nText', 'Condition', 'Rule', 'Option'])
		expect(Object.keys(defsOf(surveyConfigSchema)))
			.toEqual(['I18nText'])
	})

	it('the shared definitions are the same objects in every schema', () => {
		expect(defsOf(shortAnswerConfigSchema).Condition)
			.toBe(defsOf(multipleChoiceConfigSchema).Condition)
		expect(defsOf(numericConfigSchema).I18nText)
			.toBe(defsOf(surveyConfigSchema).I18nText)
	})

	it.each(schemas)('%s: every $ref resolves inside its own $defs', (_type, schema) => {
		const defs = defsOf(schema)
		const refs = refsIn(schema)
		expect(refs.length)
			.toBeGreaterThan(0)
		for (const ref of refs) {
			expect(ref.startsWith('#/$defs/'), ref)
				.toBe(true)
			expect(Object.keys(defs), ref)
				.toContain(ref.slice('#/$defs/'.length))
		}
	})
})

describe('condition definition', () => {
	const branches = conditionBranches(numericConfigSchema)
	const opEnum = (branch: Json) => ((branch.properties as Json).op as Json | undefined)?.enum

	it('has seven branches: four leaf operator groups, then all, any and not', () => {
		expect(branches)
			.toHaveLength(7)
		expect(branches.slice(4)
			.map(branch => (branch.required as string[])[0]))
			.toEqual(['all', 'any', 'not'])
	})

	it('the leaf operator enums equal the TS operator lists, group by group', () => {
		expect(branches.slice(0, 4)
			.map(opEnum))
			.toEqual([[...ANSWER_OPS], [...EQUALITY_OPS], [...ORDER_OPS], [...MEMBERSHIP_OPS]])
	})

	it('the operator enums together cover every operator once', () => {
		const all = branches.slice(0, 4)
			.flatMap(branch => opEnum(branch) as string[])
		expect(all.sort())
			.toEqual([...ANSWER_OPS, ...EQUALITY_OPS, ...ORDER_OPS, ...MEMBERSHIP_OPS].sort())
	})

	it('leaf branches take the value type their operators compare with', () => {
		const valueOf = (branch: Json) => (branch.properties as Json).value
		expect(valueOf(branches[0]!))
			.toBeUndefined()
		expect(branches[0]!.required)
			.toEqual(['question', 'op'])
		expect(valueOf(branches[1]!))
			.toEqual({ type: ['string', 'number'] })
		expect(valueOf(branches[2]!))
			.toEqual({ type: 'number' })
		expect(valueOf(branches[3]!))
			.toEqual({ type: 'string' })
		for (const branch of branches.slice(1, 4)) {
			expect(branch.required)
				.toEqual(['question', 'op', 'value'])
		}
	})

	it('every branch rejects unknown keys', () => {
		for (const branch of branches) {
			expect(branch.additionalProperties)
				.toBe(false)
		}
	})

	it('all and any need at least one condition', () => {
		const [all, any] = branches.slice(4)
		expect(((all!.properties as Json).all as Json).minItems)
			.toBe(1)
		expect(((any!.properties as Json).any as Json).minItems)
			.toBe(1)
	})

	it('combinators recurse through $ref Condition', () => {
		const [all, any, not] = branches.slice(4)
		expect(((all!.properties as Json).all as Json).items)
			.toEqual({ $ref: '#/$defs/Condition' })
		expect(((any!.properties as Json).any as Json).items)
			.toEqual({ $ref: '#/$defs/Condition' })
		expect((not!.properties as Json).not)
			.toEqual({ $ref: '#/$defs/Condition' })
	})

	it('explains hidden questions in the description', () => {
		expect((defsOf(numericConfigSchema).Condition as Json).description)
			.toContain('A hidden question has no value')
		expect((numericConfigSchema.properties.visibleWhen as Json).description)
			.toContain('A hidden question has no value')
	})
})

describe('rule and Option definitions', () => {
	it('rule properties equal RULE_KEYS and require both', () => {
		const rule = defsOf(singleChoiceConfigSchema).Rule as Json
		expect(Object.keys(rule.properties as Json)
			.sort())
			.toEqual([...RULE_KEYS].sort())
		expect(rule.required)
			.toEqual(['when', 'message'])
		expect(rule.additionalProperties)
			.toBe(false)
	})

	it('option properties equal OPTION_KEYS and require value and label', () => {
		const option = defsOf(singleChoiceConfigSchema).Option as Json
		expect(Object.keys(option.properties as Json)
			.sort())
			.toEqual([...OPTION_KEYS].sort())
		expect(option.required)
			.toEqual(['value', 'label'])
		expect(option.additionalProperties)
			.toBe(false)
	})

	it('i18nText needs at least one non-empty string entry and says every survey language must be present', () => {
		const text = defsOf(numericConfigSchema).I18nText as Json
		expect(text.minProperties)
			.toBe(1)
		expect(text.additionalProperties)
			.toEqual({ type: 'string', minLength: 1 })
		expect(text.description)
			.toContain('every language')
	})
})

describe('survey schema', () => {
	it('limits languages to the supported ones, unique and non-empty', () => {
		expect(surveyConfigSchema.properties.languages)
			.toMatchObject({ type: 'array', minItems: 1, uniqueItems: true, items: { enum: [...SUPPORTED_LANGUAGES] } })
	})
})

// -------------------------------------------------------------------------------------------------
// Part 2: real configs against the schemas, through a small checker for exactly the keywords the
// schemas use. It is test-only (no JSON Schema validator is a dependency) and returns the failing
// keyword with its instance path, so a test can say which keyword rejected a config.
// -------------------------------------------------------------------------------------------------

const KEYWORDS = new Set(['$schema', '$defs', '$ref', 'description', 'type', 'required', 'properties', 'additionalProperties', 'enum', 'minItems', 'minProperties', 'minLength', 'minimum', 'uniqueItems', 'items', 'oneOf'])

function jsonTypeOf(value: unknown): string {
	if (value === null)
		return 'null'
	if (Array.isArray(value))
		return 'array'
	return typeof value
}

function matchesType(type: string, value: unknown): boolean {
	return type === 'integer' ? Number.isInteger(value) : jsonTypeOf(value) === type
}

/** Failures of `value` against `schema`, as `<instance path> <keyword>`; empty means it conforms. */
function check(schema: Json, value: unknown, root: Json, path = ''): string[] {
	const unknownKeywords = Object.keys(schema)
		.filter(keyword => !KEYWORDS.has(keyword))
	if (unknownKeywords.length > 0)
		throw new Error(`The test checker does not support: ${unknownKeywords.join(', ')}`)
	if (typeof schema.$ref === 'string')
		return check((root.$defs as Json)[schema.$ref.slice('#/$defs/'.length)] as Json, value, root, path)
	const failures: string[] = []
	const fail = (keyword: string) => failures.push(`${path || '/'} ${keyword}`)
	if (schema.type !== undefined && !([] as string[]).concat(schema.type as string | string[])
		.some(type => matchesType(type, value))) {
		return [`${path || '/'} type`]
	}
	if (schema.enum !== undefined && !(schema.enum as unknown[]).includes(value))
		fail('enum')
	if (typeof value === 'string' && typeof schema.minLength === 'number' && value.length < schema.minLength)
		fail('minLength')
	if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum)
		fail('minimum')
	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems)
			fail('minItems')
		if (schema.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length)
			fail('uniqueItems')
		if (schema.items !== undefined)
			value.forEach((item, index) => failures.push(...check(schema.items as Json, item, root, `${path}/${index}`)))
	}
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		const record = value as Json
		const properties = (schema.properties ?? {}) as Record<string, Json>
		if (typeof schema.minProperties === 'number' && Object.keys(record).length < schema.minProperties)
			fail('minProperties')
		for (const key of (schema.required ?? []) as string[]) {
			if (!Object.hasOwn(record, key))
				failures.push(`${path}/${key} required`)
		}
		for (const [key, item] of Object.entries(record)) {
			if (Object.hasOwn(properties, key))
				failures.push(...check(properties[key]!, item, root, `${path}/${key}`))
			else if (schema.additionalProperties === false)
				failures.push(`${path}/${key} additionalProperties`)
			else if (typeof schema.additionalProperties === 'object')
				failures.push(...check(schema.additionalProperties as Json, item, root, `${path}/${key}`))
		}
	}
	if (Array.isArray(schema.oneOf)) {
		const matching = (schema.oneOf as Json[]).filter(branch => check(branch, value, root, path).length === 0)
		if (matching.length !== 1)
			fail(`oneOf (${matching.length} branches match)`)
	}
	return failures
}

const conforms = (schema: Json, value: unknown) => check(schema, value, schema)

const schemaOfType: Record<string, Json> = {
	Survey: surveyConfigSchema,
	ShortAnswer: shortAnswerConfigSchema,
	SingleChoice: singleChoiceConfigSchema,
	MultipleChoice: multipleChoiceConfigSchema,
	Numeric: numericConfigSchema,
}

interface PresetWidget { readonly id: string, readonly type: string, readonly config?: unknown, readonly slots?: { readonly questions?: readonly PresetWidget[] } }

function presetWidgets(sourceText: string): PresetWidget[] {
	const root = JSON.parse(sourceText) as PresetWidget
	return [root, ...(root.slots?.questions ?? [])]
}

describe('schema agreement with the presets', () => {
	it('every config of survey-default satisfies its plugin\'s schema', () => {
		const widgets = presetWidgets(defaultSurveyPreset.sourceText)
		expect(widgets.map(widget => widget.type))
			.toEqual(['Survey', 'SingleChoice', 'Numeric', 'MultipleChoice', 'ShortAnswer'])
		for (const widget of widgets) {
			expect(conforms(schemaOfType[widget.type]!, widget.config), widget.id)
				.toEqual([])
		}
	})

	it('survey-ai-draft: the mode config fails on minItems, and the other known types still conform', () => {
		const widgets = presetWidgets(surveyPresets.find(preset => preset.id === 'survey-ai-draft')!.sourceText)
		const mode = widgets.find(widget => widget.id === 'mode')!
		expect(conforms(schemaOfType[mode.type]!, mode.config))
			.toEqual(['/options minItems'])
		// `phone` has a type mismatch the schema cannot see (shape only), and `rating` has no schema.
		expect(conforms(schemaOfType.ShortAnswer!, widgets.find(widget => widget.id === 'phone')!.config))
			.toEqual([])
	})

	describe('the checker rejects what the schema forbids', () => {
		const base = { label: { en: 'Q' } }
		const cases: readonly (readonly [string, Json, unknown, string])[] = [
			['an unknown key', numericConfigSchema, { ...base, visibleIf: { question: 'a', op: 'answered' } }, '/visibleIf additionalProperties'],
			['a missing label', numericConfigSchema, {}, '/label required'],
			['an empty i18n text', numericConfigSchema, { label: {} }, '/label minProperties'],
			['an empty translation', numericConfigSchema, { label: { en: '' } }, '/label/en minLength'],
			['a wrong type', numericConfigSchema, { ...base, min: '1' }, '/min type'],
			['a non-integer maxLength', shortAnswerConfigSchema, { ...base, maxLength: 1.5 }, '/maxLength type'],
			['a maxLength below the minimum', shortAnswerConfigSchema, { ...base, maxLength: 0 }, '/maxLength minimum'],
			['an operator no branch has', numericConfigSchema, { ...base, visibleWhen: { question: 'a', op: 'near', value: 1 } }, '/visibleWhen oneOf (0 branches match)'],
			['a leaf with the wrong value type', numericConfigSchema, { ...base, visibleWhen: { question: 'a', op: 'greaterThan', value: '1' } }, '/visibleWhen oneOf (0 branches match)'],
			['a nested empty all', numericConfigSchema, { ...base, visibleWhen: { not: { all: [] } } }, '/visibleWhen oneOf (0 branches match)'],
			['required that is neither boolean nor condition', numericConfigSchema, { ...base, required: 'yes' }, '/required oneOf (0 branches match)'],
			['a duplicated language', surveyConfigSchema, { title: { en: 'T' }, languages: ['en', 'en'] }, '/languages uniqueItems'],
			['an unsupported language', surveyConfigSchema, { title: { en: 'T' }, languages: ['fr'] }, '/languages/0 enum'],
			['no languages', surveyConfigSchema, { title: { en: 'T' }, languages: [] }, '/languages minItems'],
		]
		it.each(cases)('%s', (_name, schema, config, expected) => {
			expect(conforms(schema, config))
				.toContain(expected)
		})

		it('accepts a number or a string for equals, and a nested condition', () => {
			expect(conforms(numericConfigSchema, { ...base, visibleWhen: { all: [{ question: 'a', op: 'equals', value: 1 }, { not: { question: 'b', op: 'notEquals', value: 'x' } }] } }))
				.toEqual([])
		})
	})
})
