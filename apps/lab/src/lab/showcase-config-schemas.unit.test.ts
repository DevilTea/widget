/**
 * The config JSON Schemas the Lab hands to the Structure editor and the Catalog are generated from each plugin's `Interfaces`
 * (`widgetDocs()`, `ShowcaseEntry.configSchemas`). These tests hold the generated schemas to the showcases' own code: the
 * properties are exactly the keys the config checkers accept, the constraints the checkers enforce and the JSDoc tags carry
 * are there as keywords, and every config of each showcase's default preset conforms. They live with the Lab's code because
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
				// The text per language declares its required `en` and takes any other language as a string.
				const expected = path.endsWith('/type_I18nText') ? { type: 'string' } : false
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

describe('the generated config schemas carry the constraints of the JSDoc tags', () => {
	it('survey: the languages, the texts per language, whole numbers, non-empty condition lists', () => {
		const surveySchema = schemaOf('survey', 'Survey')
		const properties = propertiesOf(surveySchema)
		expect(properties.languages)
			.toMatchObject({ type: 'array', minItems: 1, uniqueItems: true })
		expect(resolved(surveySchema, properties.languages!.items))
			.toMatchObject({ enum: [...SUPPORTED_LANGUAGES] })
		expect(resolved(surveySchema, properties.title))
			.toMatchObject({ type: 'object', minProperties: 1, additionalProperties: { type: 'string', minLength: 1 } })
		const multiple = propertiesOf(schemaOf('survey', 'MultipleChoice'))
		expect([multiple.minSelected, multiple.maxSelected])
			.toMatchObject([{ type: 'integer', minimum: 0 }, { type: 'integer', minimum: 1 }])
		expect(propertiesOf(schemaOf('survey', 'ShortAnswer')).maxLength)
			.toMatchObject({ type: 'integer', minimum: 1 })
		const numeric = schemaOf('survey', 'Numeric')
		const condition = resolved(numeric, { $ref: '#/$defs/type_Condition' }).anyOf as Json[]
		expect(propertiesOf(numeric, condition[4]).all)
			.toMatchObject({ type: 'array', minItems: 1 })
		expect(propertiesOf(numeric, condition[0]).question)
			.toMatchObject({ type: 'string', minLength: 1 })
	})

	it('trip-budget: currency codes and person ids by pattern, rates above 0, percentages from 0 to 100, unique sharers, the rounding steps', () => {
		const currency = propertiesOf(schemaOf('trip-budget', 'Currency'))
		expect(currency.base)
			.toMatchObject({ type: 'string', pattern: CURRENCY_CODE_PATTERN.source })
		expect(currency.rates)
			.toMatchObject({ type: 'object', propertyNames: { pattern: CURRENCY_CODE_PATTERN.source }, additionalProperties: { type: 'number', exclusiveMinimum: 0 } })
		expect(resolved(schemaOf('trip-budget', 'Currency'), currency.roundTransfersTo))
			.toMatchObject({ enum: [...ROUND_STEPS] })
		const expense = schemaOf('trip-budget', 'Expense')
		const properties = propertiesOf(expense)
		expect([properties.currency, properties.paidBy])
			.toMatchObject([{ pattern: CURRENCY_CODE_PATTERN.source }, { pattern: PERSON_ID_PATTERN.source }])
		const [equal, percent] = (properties.split!.anyOf as Json[]).map(branch => propertiesOf(expense, branch))
		expect(equal!.among)
			.toMatchObject({ type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: PERSON_ID_PATTERN.source } })
		expect(percent!.percents)
			.toMatchObject({ propertyNames: { pattern: PERSON_ID_PATTERN.source }, additionalProperties: { type: 'number', minimum: 0, maximum: 100 } })
		expect(resolved(expense, properties.title))
			.toMatchObject({ type: 'object', required: ['en'], additionalProperties: { type: 'string' } })
	})

	it('onboarding: ids, days and times by pattern, unique picks, non-empty lists, whole numbers', () => {
		const induction = propertiesOf(schemaOf('onboarding', 'InductionStep'))
		expect(induction.days)
			.toMatchObject({ type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: ISO_DATE_PATTERN.source } })
		expect(induction.times)
			.toMatchObject({ type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: TIME_PATTERN.source } })
		const interests = schemaOf('onboarding', 'InterestsStep')
		const properties = propertiesOf(interests)
		expect(properties.options)
			.toMatchObject({ type: 'array', minItems: 1 })
		expect(propertiesOf(interests, properties.options!.items).id)
			.toMatchObject({ type: 'string', pattern: OPTION_ID_PATTERN.source })
		expect(properties.preselected)
			.toMatchObject({ uniqueItems: true, items: { pattern: OPTION_ID_PATTERN.source } })
		expect(properties.minimum)
			.toMatchObject({ type: 'integer', minimum: 0 })
		expect(propertiesOf(schemaOf('onboarding', 'Onboarding')).startStep)
			.toMatchObject({ type: 'integer', minimum: 0 })
	})

	it('renderer-packs: whole-number limits', () => {
		expect(propertiesOf(schemaOf('renderer-packs', 'Notifier')).limit)
			.toMatchObject({ type: 'integer', minimum: 1, maximum: 10 })
		expect(propertiesOf(schemaOf('renderer-packs', 'TextField')).maxLength)
			.toMatchObject({ type: 'integer', minimum: 1 })
	})
})

// -------------------------------------------------------------------------------------------------
// Real configs against the generated schemas, through a small checker for exactly the keywords the generator emits. It is
// test-only (the Lab has no JSON Schema validator) and returns the failing keyword with its instance path.
// -------------------------------------------------------------------------------------------------

const KEYWORDS = new Set(['$schema', '$defs', '$ref', 'title', 'description', 'default', 'examples', 'format', 'type', 'required', 'properties', 'items', 'additionalProperties', 'propertyNames', 'enum', 'const', 'anyOf', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum'])

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
		['an empty text per language', numeric, { label: {} }, '/label minProperties'],
		['an empty translation', numeric, { label: { en: '' } }, '/label/en minLength'],
		['a wrong type', numeric, { ...base, min: '1' }, '/min type'],
		['a maxLength that is not a whole number', schemaOf('survey', 'ShortAnswer'), { ...base, maxLength: 1.5 }, '/maxLength type'],
		['a maxLength below the minimum', schemaOf('survey', 'ShortAnswer'), { ...base, maxLength: 0 }, '/maxLength minimum'],
		['an operator no branch has', numeric, { ...base, visibleWhen: { question: 'a', op: 'near', value: 1 } }, '/visibleWhen anyOf'],
		['a leaf with the wrong value type', numeric, { ...base, visibleWhen: { question: 'a', op: 'greaterThan', value: '1' } }, '/visibleWhen anyOf'],
		['a nested empty all', numeric, { ...base, visibleWhen: { not: { all: [] } } }, '/visibleWhen anyOf'],
		['required that is neither boolean nor condition', numeric, { ...base, required: 'yes' }, '/required anyOf'],
		['a repeated language', schemaOf('survey', 'Survey'), { title: { en: 'T' }, languages: ['en', 'en'] }, '/languages uniqueItems'],
		['an unsupported language', schemaOf('survey', 'Survey'), { title: { en: 'T' }, languages: ['fr'] }, '/languages/0 enum'],
		['no languages', schemaOf('survey', 'Survey'), { title: { en: 'T' }, languages: [] }, '/languages minItems'],
	]
	it.each(cases)('%s', (_name, schema, config, expected) => {
		expect(conforms(schema, config))
			.toContain(expected)
	})

	it('accepts a number or a string for equals, and a nested condition', () => {
		expect(conforms(numeric, { ...base, visibleWhen: { all: [{ question: 'a', op: 'equals', value: 1 }, { not: { question: 'b', op: 'notEquals', value: 'x' } }] } }))
			.toEqual([])
	})

	it('survey-ai-draft: the mode config fails on minItems, and the other configs with a schema still conform', () => {
		const draft = getShowcase('survey')!.presets.find(preset => preset.id === 'survey-ai-draft')!
		const widgets = widgetsOf(JSON.parse(draft.sourceText) as PresetWidget)
		const mode = widgets.find(widget => widget.id === 'mode')!
		expect(conforms(schemaOf('survey', mode.type), mode.config))
			.toEqual(['/options minItems'])
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
