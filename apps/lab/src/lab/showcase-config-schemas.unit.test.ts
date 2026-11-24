/**
 * The config JSON Schemas the Lab hands to the Structure editor and the Catalog are generated from each plugin's `Interfaces`
 * (`widgetDocs()`, `ShowcaseEntry.configSchemas`), with every description taken from the plugins' builder docs. These tests hold the
 * generated schemas to the showcases' own code: the properties are exactly the keys the config checkers accept, a constraint
 * the checkers enforce is prose in the description (the schema states the shape only), and every config of each showcase's default
 * preset conforms. They live with the Lab's code because
 * a showcase test may not import the Lab (the registry, the virtual docs modules).
 */

import type { JsonSchema } from './config-schema'
import { describe, expect, it } from 'vitest'
import * as repair from '../showcases/document-repair/config'
import * as onboarding from '../showcases/onboarding/config'
import { ISO_DATE_PATTERN, OPTION_ID_PATTERN, TIME_PATTERN } from '../showcases/onboarding/domain'
import { getShowcase } from '../showcases/registry'
import * as packs from '../showcases/renderer-packs/config'
import * as survey from '../showcases/survey/config'
import { ANSWER_OPS, EQUALITY_OPS, MEMBERSHIP_OPS, ORDER_OPS, SUPPORTED_LANGUAGES } from '../showcases/survey/domain'
import * as trip from '../showcases/trip-budget/config'
import { CURRENCY_CODE_PATTERN, PERSON_ID_PATTERN, ROUND_STEPS } from '../showcases/trip-budget/domain'
import { resolveSchema } from './config-schema'

type Json = Readonly<Record<string, unknown>>

const GENERATED = ['survey', 'trip-budget', 'onboarding', 'document-repair', 'renderer-packs'] as const

function schemaOf(showcase: typeof GENERATED[number], type: string): JsonSchema {
	return getShowcase(showcase)!.configSchemas[type] as JsonSchema
}

/** `schema` with its `$ref` followed (against `root`) and a union with `null` read as its other branch. */
function resolved(root: JsonSchema, schema: unknown): Json {
	const target = resolveSchema(root, schema as JsonSchema)!
	const branches = target.anyOf
	if (Array.isArray(branches) && branches.length === 2 && branches.some(branch => (branch as Json).type === 'null'))
		return resolved(root, branches.find(branch => (branch as Json).type !== 'null'))
	return target
}

function propertiesOf(root: JsonSchema, schema: unknown = root): Record<string, Json> {
	return resolved(root, schema).properties as Record<string, Json>
}

describe('the generated config schemas declare exactly the keys the config checkers accept', () => {
	const cases: readonly (readonly [typeof GENERATED[number], string, readonly string[]])[] = [
		['survey', 'Survey', survey.SURVEY_CONFIG_KEYS],
		['survey', 'SingleChoice', survey.SINGLE_CHOICE_CONFIG_KEYS],
		['survey', 'MultipleChoice', survey.MULTIPLE_CHOICE_CONFIG_KEYS],
		['survey', 'Numeric', survey.NUMERIC_CONFIG_KEYS],
		['survey', 'ShortAnswer', survey.SHORT_ANSWER_CONFIG_KEYS],
		['trip-budget', 'Trip', trip.TRIP_CONFIG_KEYS],
		['trip-budget', 'Currency', trip.CURRENCY_CONFIG_KEYS],
		['trip-budget', 'Person', trip.PERSON_CONFIG_KEYS],
		['trip-budget', 'Expense', trip.EXPENSE_CONFIG_KEYS],
		['onboarding', 'Onboarding', onboarding.ONBOARDING_CONFIG_KEYS],
		['onboarding', 'AccountStep', onboarding.ACCOUNT_CONFIG_KEYS],
		['onboarding', 'InterestsStep', onboarding.INTERESTS_CONFIG_KEYS],
		['onboarding', 'SafetyStep', onboarding.SAFETY_CONFIG_KEYS],
		['onboarding', 'InductionStep', onboarding.INDUCTION_CONFIG_KEYS],
		['document-repair', 'RepairDesk', repair.REPAIR_DESK_CONFIG_KEYS],
		['document-repair', 'SavedDraft', repair.SAVED_DRAFT_CONFIG_KEYS],
		['renderer-packs', 'SettingsPage', packs.SETTINGS_PAGE_CONFIG_KEYS],
		['renderer-packs', 'Appearance', packs.APPEARANCE_CONFIG_KEYS],
		['renderer-packs', 'Notifier', packs.NOTIFIER_CONFIG_KEYS],
		['renderer-packs', 'Section', packs.SECTION_CONFIG_KEYS],
		['renderer-packs', 'TextField', packs.TEXT_FIELD_CONFIG_KEYS],
		['renderer-packs', 'Toggle', packs.TOGGLE_CONFIG_KEYS],
		['renderer-packs', 'Choice', packs.CHOICE_CONFIG_KEYS],
		['renderer-packs', 'DangerAction', packs.DANGER_ACTION_CONFIG_KEYS],
	]

	it('covers every plugin with a config', () => {
		for (const id of GENERATED) {
			expect(cases.filter(([showcase]) => showcase === id)
				.map(([, type]) => type)
				.sort(), id)
				.toEqual(Object.keys(getShowcase(id)!.configSchemas)
					.sort())
		}
	})

	it.each(cases)('%s %s', (showcase, type, keys) => {
		const schema = schemaOf(showcase, type)
		expect(Object.keys(propertiesOf(schema))
			.sort())
			.toEqual([...keys].sort())
		expect(resolved(schema, schema).additionalProperties)
			.toBe(false)
	})

	it('and so do the nested objects', () => {
		const multiple = schemaOf('survey', 'MultipleChoice')
		const multipleProperties = propertiesOf(multiple)
		expect(Object.keys(propertiesOf(multiple, multipleProperties.options!.items)))
			.toEqual([...survey.OPTION_KEYS])
		expect(Object.keys(propertiesOf(multiple, (multipleProperties.rules!.items))))
			.toEqual([...survey.RULE_KEYS])
		const split = (propertiesOf(schemaOf('trip-budget', 'Expense')).split!.anyOf) as Json[]
		expect(split.map(branch => Object.keys(propertiesOf(schemaOf('trip-budget', 'Expense'), branch))))
			.toEqual([[...trip.EQUAL_SPLIT_KEYS], [...trip.PERCENT_SPLIT_KEYS]])
		expect(Object.keys(propertiesOf(schemaOf('onboarding', 'AccountStep'), propertiesOf(schemaOf('onboarding', 'AccountStep')).prefill)))
			.toEqual([...onboarding.ACCOUNT_PREFILL_KEYS])
		const interests = schemaOf('onboarding', 'InterestsStep')
		expect(Object.keys(propertiesOf(interests, propertiesOf(interests).options!.items)))
			.toEqual([...onboarding.INTEREST_OPTION_KEYS])
		const safety = schemaOf('onboarding', 'SafetyStep')
		expect(Object.keys(propertiesOf(safety, propertiesOf(safety).rules!.items)))
			.toEqual([...onboarding.SAFETY_RULE_KEYS])
	})

	it('lists the Survey condition operators of the domain, group by group, then the all, any and not combinators (the union is flattened)', () => {
		const numeric = schemaOf('survey', 'Numeric')
		const condition = resolved(numeric, { $ref: '#/$defs/type_Condition' }).anyOf as Json[]
		expect(condition.slice(0, 4)
			.map(leaf => propertiesOf(numeric, leaf).op!.enum))
			.toEqual([[...ANSWER_OPS], [...EQUALITY_OPS], [...ORDER_OPS], [...MEMBERSHIP_OPS]])
		expect(condition.slice(4)
			.map(branch => Object.keys(propertiesOf(numeric, branch))))
			.toEqual([['all'], ['any'], ['not']])
	})
})

describe('the generated config schemas require what the checkers require, close every object and describe every property', () => {
	const required: Record<typeof GENERATED[number], Record<string, readonly string[]>> = {
		'survey': { Survey: ['title', 'languages'], SingleChoice: ['label', 'options'], MultipleChoice: ['label', 'options'], Numeric: ['label'], ShortAnswer: ['label'] },
		'trip-budget': { Trip: ['title'], Currency: ['base', 'rates'], Person: ['name'], Expense: ['title', 'amount', 'currency', 'paidBy', 'split'] },
		'onboarding': { Onboarding: ['title'], AccountStep: ['title'], InterestsStep: ['title', 'options'], SafetyStep: ['title', 'rules'], InductionStep: ['title', 'days', 'times'] },
		'document-repair': { RepairDesk: ['appVersion'], SavedDraft: ['title', 'savedWith', 'source'] },
		'renderer-packs': { SettingsPage: ['title'], Appearance: [], Notifier: [], Section: ['title'], TextField: ['label', 'maxLength', 'appearance'], Toggle: ['label', 'appearance'], Choice: ['label', 'appearance', 'options'], DangerAction: ['label', 'confirmText', 'message', 'notifier', 'appearance'] },
	}

	it.each(GENERATED)('%s: each config requires exactly the keys its checker requires', (id) => {
		expect(Object.keys(required[id]))
			.toEqual(Object.keys(getShowcase(id)!.configSchemas))
		for (const [type, keys] of Object.entries(required[id])) {
			const schema = schemaOf(id, type)
			expect([...(resolved(schema, schema).required as string[])].sort(), `${id} ${type}`)
				.toEqual([...keys].sort())
		}
	})

	it('each union branch and nested object requires what its checker requires', () => {
		const numeric = schemaOf('survey', 'Numeric')
		const condition = resolved(numeric, { $ref: '#/$defs/type_Condition' }).anyOf as Json[]
		expect(condition.map(branch => resolved(numeric, branch).required))
			.toEqual([['question', 'op'], ['question', 'op', 'value'], ['question', 'op', 'value'], ['question', 'op', 'value'], ['all'], ['any'], ['not']])
		const multiple = schemaOf('survey', 'MultipleChoice')
		expect([resolved(multiple, propertiesOf(multiple).options!.items).required, resolved(multiple, propertiesOf(multiple).rules!.items).required])
			.toEqual([['value', 'label'], ['when', 'message']])
		const expense = schemaOf('trip-budget', 'Expense')
		expect((propertiesOf(expense).split!.anyOf as Json[]).map(branch => resolved(expense, branch).required))
			.toEqual([['mode', 'among'], ['mode', 'percents']])
		const interests = schemaOf('onboarding', 'InterestsStep')
		const safety = schemaOf('onboarding', 'SafetyStep')
		const account = schemaOf('onboarding', 'AccountStep')
		expect([resolved(interests, propertiesOf(interests).options!.items).required, resolved(safety, propertiesOf(safety).rules!.items).required, resolved(account, propertiesOf(account).prefill).required])
			.toEqual([['id', 'label'], ['id', 'text'], []])
		const choice = schemaOf('renderer-packs', 'Choice')
		expect(resolved(choice, propertiesOf(choice).options!.items).required)
			.toEqual(['value', 'label'])
	})

	/** Every object schema with named properties in `schema` (its `$defs` included), with where it is. */
	function objectsOf(schema: Json): [string, Json][] {
		const found: [string, Json][] = []
		const visit = (node: unknown, path: string): void => {
			if (Array.isArray(node)) {
				node.forEach((item, index) => visit(item, `${path}/${index}`))
				return
			}
			if (typeof node !== 'object' || node === null)
				return
			const object = node as Json
			if (object.properties !== undefined)
				found.push([path, object])
			for (const [key, value] of Object.entries(object))
				visit(value, `${path}/${key}`)
		}
		visit(schema, '#')
		return found
	}

	it.each(GENERATED)('%s: every object with named properties rejects other keys, except the text per language', (id) => {
		for (const [type, schema] of Object.entries(getShowcase(id)!.configSchemas)) {
			expect(objectsOf(schema).length, `${id} ${type}`)
				.toBeGreaterThan(0)
			for (const [path, object] of objectsOf(schema)) {
				// The text per language declares its required `en` and takes any other language as a string (described by its `values` docs).
				const expected = path.endsWith('/type_I18nText') ? { type: 'string', description: expect.any(String) } : false
				expect(object.additionalProperties, `${id} ${type} ${path}`)
					.toEqual(expected)
			}
		}
	})

	it.each(GENERATED)('%s: every property has a description', (id) => {
		for (const [type, schema] of Object.entries(getShowcase(id)!.configSchemas)) {
			for (const [path, object] of objectsOf(schema)) {
				for (const [name, property] of Object.entries(object.properties as Record<string, Json>)) {
					expect(typeof property.description === 'string' && property.description !== '', `${id} ${type} ${path}/properties/${name}`)
						.toBe(true)
				}
			}
		}
	})
})

describe('the generated config schemas state the shape only: a constraint is prose in the description', () => {
	// Discussion #12, "Descriptions live in the plugin builder" (0.4): the schema has the shape only; a constraint is stated
	// in the description and enforced by the plugin's `validate`.
	const CONSTRAINT_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'propertyNames', 'pattern', 'format', 'default', 'examples']

	it.each(GENERATED)('%s: no constraint keyword, and no `integer` type', (id) => {
		const keywords = new Set<string>()
		const types = new Set<unknown>()
		const visit = (node: unknown): void => {
			if (typeof node !== 'object' || node === null)
				return
			for (const [key, value] of Object.entries(node)) {
				keywords.add(key)
				if (key === 'type')
					types.add(value)
				// The keys of `properties` and `$defs` are names, not keywords.
				if ((key === 'properties' || key === '$defs') && typeof value === 'object' && value !== null) {
					Object.values(value)
						.forEach(visit)
				}
				else {
					visit(value)
				}
			}
		}
		Object.values(getShowcase(id)!.configSchemas)
			.forEach(visit)
		expect(CONSTRAINT_KEYWORDS.filter(keyword => keywords.has(keyword)))
			.toEqual([])
		expect(types.has('integer'))
			.toBe(false)
	})

	it('survey: the languages, the texts per language, whole numbers and non-empty condition lists are prose', () => {
		const surveySchema = schemaOf('survey', 'Survey')
		const properties = propertiesOf(surveySchema)
		expect(properties.languages)
			.toMatchObject({ type: 'array', description: expect.stringContaining('each once (at least one)') })
		expect(resolved(surveySchema, properties.languages!.items))
			.toMatchObject({ enum: [...SUPPORTED_LANGUAGES] })
		expect(resolved(surveySchema, { $ref: '#/$defs/type_I18nText' }))
			.toMatchObject({ type: 'object', additionalProperties: { type: 'string' }, description: expect.stringContaining('at least one entry, each text at least one character') })
		const multiple = propertiesOf(schemaOf('survey', 'MultipleChoice'))
		expect([multiple.minSelected, multiple.maxSelected])
			.toMatchObject([{ type: 'number', description: expect.stringContaining('a whole number of at least 0') }, { type: 'number', description: expect.stringContaining('a whole number of at least 1') }])
		const numeric = schemaOf('survey', 'Numeric')
		const condition = resolved(numeric, { $ref: '#/$defs/type_Condition' }).anyOf as Json[]
		expect(propertiesOf(numeric, condition[4]).all)
			.toMatchObject({ type: 'array', description: expect.stringContaining('At least one.') })
	})

	it('trip-budget and onboarding: patterns, ranges and unique lists are prose', () => {
		const currency = propertiesOf(schemaOf('trip-budget', 'Currency'))
		expect(currency.base!.description)
			.toContain(CURRENCY_CODE_PATTERN.source)
		expect(resolved(schemaOf('trip-budget', 'Currency'), currency.roundTransfersTo))
			.toMatchObject({ enum: [...ROUND_STEPS] })
		const expense = schemaOf('trip-budget', 'Expense')
		const [equal, percent] = (propertiesOf(expense).split!.anyOf as Json[]).map(branch => propertiesOf(expense, branch))
		expect(equal!.among!.description)
			.toContain(`At least one, each once, each a person id (\`${PERSON_ID_PATTERN.source}\`)`)
		expect(percent!.percents!.description)
			.toContain('each percentage is from 0 to 100')
		const induction = propertiesOf(schemaOf('onboarding', 'InductionStep'))
		expect([induction.days!.description, induction.times!.description])
			.toEqual([expect.stringContaining(ISO_DATE_PATTERN.source), expect.stringContaining(TIME_PATTERN.source)])
		const interests = schemaOf('onboarding', 'InterestsStep')
		expect(propertiesOf(interests, propertiesOf(interests).options!.items).id!.description)
			.toContain(OPTION_ID_PATTERN.source)
	})

	it('marks a widget reference with the types it names (`x-widgetRef`) beside the sentence', () => {
		const expense = propertiesOf(schemaOf('trip-budget', 'Expense'))
		expect(expense.paidBy)
			.toMatchObject({ 'type': 'string', 'x-widgetRef': ['Person'], 'description': expect.stringContaining('Must be the id of a widget of type Person in the same document.') })
		expect(propertiesOf(schemaOf('renderer-packs', 'TextField')).appearance)
			.toMatchObject({ 'x-widgetRef': ['Appearance'] })
		const numeric = schemaOf('survey', 'Numeric')
		const condition = resolved(numeric, { $ref: '#/$defs/type_Condition' }).anyOf as Json[]
		expect(condition.slice(0, 4)
			.map(leaf => propertiesOf(numeric, leaf).question!['x-widgetRef']))
			.toEqual([['SingleChoice', 'MultipleChoice', 'Numeric', 'ShortAnswer'], ['SingleChoice', 'MultipleChoice', 'Numeric', 'ShortAnswer'], ['Numeric'], ['MultipleChoice']])
	})
})

// -------------------------------------------------------------------------------------------------
// Real configs against the generated schemas, through a small checker for exactly the keywords the generator emits. It is
// test-only (the Lab has no JSON Schema validator) and returns the failing keyword with its instance path.
// -------------------------------------------------------------------------------------------------

const KEYWORDS = new Set(['x-widgetRef', '$schema', '$defs', '$ref', 'title', 'description', 'default', 'examples', 'format', 'type', 'required', 'properties', 'items', 'additionalProperties', 'propertyNames', 'enum', 'const', 'anyOf', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum'])

function jsonTypeOf(value: unknown): string {
	if (value === null)
		return 'null'
	if (Array.isArray(value))
		return 'array'
	return typeof value
}

/** Failures of `value` against `schema`, as `<instance path> <keyword>`; empty means it conforms. */
function check(root: Json, schema: Json, value: unknown, path = ''): string[] {
	const unknownKeywords = Object.keys(schema)
		.filter(keyword => !KEYWORDS.has(keyword))
	if (unknownKeywords.length > 0)
		throw new Error(`The test checker does not support: ${unknownKeywords.join(', ')}`)
	const at = path === '' ? '/' : path
	if (typeof schema.$ref === 'string')
		return check(root, (root.$defs as Json)[schema.$ref.slice('#/$defs/'.length)] as Json, value, path)
	if (typeof schema.type === 'string' && !(schema.type === 'integer' ? Number.isInteger(value) : jsonTypeOf(value) === schema.type))
		return [`${at} type`]
	const failures: string[] = []
	if (Array.isArray(schema.anyOf) && !schema.anyOf.some(branch => check(root, branch as Json, value, path).length === 0))
		failures.push(`${at} anyOf`)
	if ('const' in schema && schema.const !== value)
		failures.push(`${at} const`)
	if (Array.isArray(schema.enum) && !schema.enum.includes(value))
		failures.push(`${at} enum`)
	if (typeof value === 'string') {
		if (typeof schema.minLength === 'number' && value.length < schema.minLength)
			failures.push(`${at} minLength`)
		if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u')
			.test(value)) {
			failures.push(`${at} pattern`)
		}
	}
	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum)
			failures.push(`${at} minimum`)
		if (typeof schema.maximum === 'number' && value > schema.maximum)
			failures.push(`${at} maximum`)
		if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
			failures.push(`${at} exclusiveMinimum`)
	}
	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems)
			failures.push(`${at} minItems`)
		if (schema.uniqueItems === true && new Set(value.map(item => JSON.stringify(item))).size !== value.length)
			failures.push(`${at} uniqueItems`)
		if (schema.items !== undefined)
			value.forEach((item, index) => failures.push(...check(root, schema.items as Json, item, `${path}/${index}`)))
	}
	if (jsonTypeOf(value) === 'object') {
		const record = value as Json
		const properties = (schema.properties ?? {}) as Record<string, Json>
		if (typeof schema.minProperties === 'number' && Object.keys(record).length < schema.minProperties)
			failures.push(`${at} minProperties`)
		for (const key of (schema.required ?? []) as string[]) {
			if (!Object.hasOwn(record, key))
				failures.push(`${path}/${key} required`)
		}
		for (const [key, item] of Object.entries(record)) {
			if (schema.propertyNames !== undefined)
				failures.push(...check(root, schema.propertyNames as Json, key, `${path}/${key} (name)`))
			if (Object.hasOwn(properties, key))
				failures.push(...check(root, properties[key]!, item, `${path}/${key}`))
			else if (schema.additionalProperties === false)
				failures.push(`${path}/${key} additionalProperties`)
			else if (typeof schema.additionalProperties === 'object')
				failures.push(...check(root, schema.additionalProperties as Json, item, `${path}/${key}`))
		}
	}
	return failures
}

const conforms = (schema: Json, value: unknown): string[] => check(schema, schema, value)

interface PresetWidget { readonly id: string, readonly type: string, readonly config?: unknown, readonly slots?: Readonly<Record<string, readonly PresetWidget[]>> }

function widgetsOf(widget: PresetWidget): PresetWidget[] {
	return [widget, ...Object.values(widget.slots ?? {})
		.flat()
		.flatMap(widgetsOf)]
}

describe('every config of each showcase\'s default preset conforms to its generated schema', () => {
	it.each(GENERATED)('%s', (id) => {
		const showcase = getShowcase(id)!
		const widgets = widgetsOf(JSON.parse(showcase.defaultPreset.sourceText) as PresetWidget)
			.filter(widget => Object.hasOwn(showcase.configSchemas, widget.type))
		expect(widgets.length)
			.toBeGreaterThan(1)
		for (const widget of widgets) {
			expect(conforms(showcase.configSchemas[widget.type]!, widget.config ?? null), `${id} ${widget.id}`)
				.toEqual([])
		}
	})
})

describe('the survey schemas reject what the config checkers reject', () => {
	const numeric = schemaOf('survey', 'Numeric')
	const base = { label: { en: 'Q' } }
	const cases: readonly (readonly [string, Json, unknown, string])[] = [
		['an unknown key', numeric, { ...base, visibleIf: { question: 'a', op: 'answered' } }, '/visibleIf additionalProperties'],
		['a missing label', numeric, {}, '/label required'],
		['a wrong type', numeric, { ...base, min: '1' }, '/min type'],
		['an operator no branch has', numeric, { ...base, visibleWhen: { question: 'a', op: 'near', value: 1 } }, '/visibleWhen anyOf'],
		['a leaf with the wrong value type', numeric, { ...base, visibleWhen: { question: 'a', op: 'greaterThan', value: '1' } }, '/visibleWhen anyOf'],
		['required that is neither boolean nor condition', numeric, { ...base, required: 'yes' }, '/required anyOf'],
		['an unsupported language', schemaOf('survey', 'Survey'), { title: { en: 'T' }, languages: ['fr'] }, '/languages/0 enum'],
	]
	it.each(cases)('%s', (_name, schema, config, expected) => {
		expect(conforms(schema, config))
			.toContain(expected)
	})

	// A constraint is prose in the description (0.4: the schema states the shape only): the schema accepts these, and the
	// config checker, which `validate` runs, rejects them.
	const constraintCases: readonly (readonly [string, Json, survey.ConfigChecker, unknown])[] = [
		['an empty text per language', numeric, survey.checkNumericConfig, { label: {} }],
		['an empty translation', numeric, survey.checkNumericConfig, { label: { en: '' } }],
		['a maxLength that is not a whole number', schemaOf('survey', 'ShortAnswer'), survey.checkShortAnswerConfig, { ...base, maxLength: 1.5 }],
		['a maxLength below the minimum', schemaOf('survey', 'ShortAnswer'), survey.checkShortAnswerConfig, { ...base, maxLength: 0 }],
		['a nested empty all', numeric, survey.checkNumericConfig, { ...base, visibleWhen: { not: { all: [] } } }],
		['a repeated language', schemaOf('survey', 'Survey'), survey.checkSurveyConfig, { title: { en: 'T' }, languages: ['en', 'en'] }],
		['no languages', schemaOf('survey', 'Survey'), survey.checkSurveyConfig, { title: { en: 'T' }, languages: [] }],
	]
	it.each(constraintCases)('%s: the schema accepts it, the checker rejects it', (_name, schema, checker, config) => {
		expect(conforms(schema, config))
			.toEqual([])
		const reported: unknown[] = []
		checker(config, diagnostic => reported.push(diagnostic))
		expect(reported.length)
			.toBeGreaterThan(0)
	})

	it('accepts a number or a string for equals, and a nested condition', () => {
		expect(conforms(numeric, { ...base, visibleWhen: { all: [{ question: 'a', op: 'equals', value: 1 }, { not: { question: 'b', op: 'notEquals', value: 'x' } }] } }))
			.toEqual([])
	})

	it('survey-ai-draft: the mode config fits the shape but fails its checker (no options), and the other configs with a schema conform', () => {
		const draft = getShowcase('survey')!.presets.find(preset => preset.id === 'survey-ai-draft')!
		const widgets = widgetsOf(JSON.parse(draft.sourceText) as PresetWidget)
		const mode = widgets.find(widget => widget.id === 'mode')!
		expect(conforms(schemaOf('survey', mode.type), mode.config))
			.toEqual([])
		const reported: { readonly path?: readonly (string | number)[] }[] = []
		;(mode.type === 'SingleChoice' ? survey.checkSingleChoiceConfig : survey.checkMultipleChoiceConfig)(mode.config, diagnostic => reported.push(diagnostic))
		expect(reported.map(diagnostic => diagnostic.path))
			.toContainEqual(['options'])
		// `phone` has a type mismatch the schema cannot see (shape only), and a type the survey does not register has no schema.
		const others = widgets.filter(widget => widget.id !== 'mode' && Object.hasOwn(getShowcase('survey')!.configSchemas, widget.type))
		expect(others.map(widget => widget.id))
			.toContain('phone')
		for (const widget of others) {
			expect(conforms(schemaOf('survey', widget.type), widget.config ?? null), widget.id)
				.toEqual([])
		}
	})
})
