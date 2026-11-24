import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { JsonSchema } from './config-schema'
import type { ReferenceDiagnosticFacts } from './reference-locations'
import { describe, expect, it } from 'vitest'
import { getShowcase } from '../showcases/registry'
import { fieldModelAt, LOCATED_DEPENDENCY_CODES, referenceConfigPaths, schemaWidgetRefs, stringValuePaths, WIDGET_REF_KEYWORD, widgetRefTypesAt, widgetRefTypesOf } from './reference-locations'

const SENTENCE = (types: string) => `Must be the id of a widget of type ${types} in the same document.`

/** A value typed `WidgetRef<Types>` as `widgetDocs()` writes it in the full profile: `x-widgetRef` beside the sentence. */
function ref(description: string, ...types: string[]): JsonSchema {
	return { type: 'string', [WIDGET_REF_KEYWORD]: types, description: `${description} ${SENTENCE(types.join(' | '))}`.trim() }
}

/**
 * A small config schema in the shape `widgetDocs()` generates: a `$ref` root with `$defs`, a condition union (`anyOf`), a
 * nullable reference, a list and a dictionary of references, and `x-widgetRef` on the values that name widgets. `note` carries
 * only the sentence, without the annotation: it is prose, not a mark.
 */
const schema: JsonSchema = {
	$ref: '#/$defs/Config',
	$defs: {
		Config: {
			type: 'object',
			properties: {
				label: { type: 'string', description: 'The label.' },
				inputType: { type: 'string', description: 'The input type, for example "email".' },
				note: { type: 'string', description: `Free text. ${SENTENCE('Numeric')}` },
				target: ref('The widget to copy from.', 'Numeric'),
				fallback: { anyOf: [ref('', 'Numeric', 'Rating'), { type: 'null' }], description: 'Another widget, or none.' },
				reviewers: { type: 'array', items: ref('', 'Form'), description: 'The Forms that review this one.' },
				owners: { type: 'object', additionalProperties: ref('', 'Person'), description: 'The owner of each section.' },
				visibleWhen: { $ref: '#/$defs/Condition' },
				rules: { type: 'array', items: { $ref: '#/$defs/Rule' } },
			},
			additionalProperties: false,
		},
		Rule: {
			type: 'object',
			properties: { when: { $ref: '#/$defs/Condition' }, message: { type: 'string' } },
			required: ['when', 'message'],
		},
		Condition: {
			anyOf: [
				{
					type: 'object',
					properties: {
						question: ref('The question it reads.', 'SingleChoice', 'Numeric'),
						op: { type: 'string' },
					},
					required: ['question', 'op'],
				},
				{
					type: 'object',
					properties: { all: { type: 'array', items: { $ref: '#/$defs/Condition' } } },
					required: ['all'],
				},
			],
		},
	},
}

function missing(widgetId: string, code = 'missing-dependency-target'): { code: string, dependency: BlueprintDependencyReference } {
	return {
		code,
		dependency: { target: { type: 'widget', widgetId, optional: false }, operation: { type: 'property-get', name: 'value' } },
	}
}

function locate(facts: ReferenceDiagnosticFacts, config: unknown, configSchema: JsonSchema | null = schema) {
	return referenceConfigPaths(facts, config, schemaWidgetRefs(configSchema, config))
}

describe('referenceConfigPaths', () => {
	it('locates a broken reference at the one config value that names it', () => {
		const config = { label: 'Guests', visibleWhen: { question: 'mdoe', op: 'answered' } }
		expect(locate(missing('mdoe'), config))
			.toEqual([['visibleWhen', 'question']])
	})

	it('returns every widget-reference value that names it, in document order', () => {
		const config = {
			target: 'mdoe',
			visibleWhen: { question: 'mdoe', op: 'answered' },
			rules: [{ when: { question: 'mode', op: 'answered' }, message: 'x' }, { when: { question: 'mdoe', op: 'answered' }, message: 'y' }],
		}
		expect(locate(missing('mdoe'), config))
			.toEqual([['target'], ['visibleWhen', 'question'], ['rules', 1, 'when', 'question']])
	})

	it('follows nested lists: rules -> when -> all -> question', () => {
		const config = {
			rules: [{
				when: { all: [{ question: 'sessions', op: 'answered' }, { all: [{ question: 'gusets', op: 'answered' }] }] },
				message: 'x',
			}],
		}
		expect(locate(missing('gusets'), config))
			.toEqual([['rules', 0, 'when', 'all', 1, 'all', 0, 'question']])
	})

	it('locates a reference held in a list of references, a dictionary of references, or a nullable reference', () => {
		// `x-widgetRef` sits on the item schema of `WidgetRef[]` and the value schema of `Record<string, WidgetRef>`.
		const config = { reviewers: ['legal', 'mdoe'], owners: { intro: 'ana', pricing: 'mdoe' }, fallback: 'mdoe' }
		expect(locate(missing('mdoe'), config))
			.toEqual([['reviewers', 1], ['owners', 'pricing'], ['fallback']])
		expect(widgetRefTypesAt(schema, config, ['owners', 'pricing']))
			.toEqual(['Person'])
		expect(widgetRefTypesAt(schema, config, ['fallback']))
			.toEqual(['Numeric', 'Rating'])
		// The list and the dictionary themselves are not references.
		expect(widgetRefTypesAt(schema, config, ['reviewers']))
			.toBeNull()
		expect(widgetRefTypesAt(schema, config, ['owners']))
			.toBeNull()
		// A missing member: located only where the target's type is outside the item's allowed types.
		expect(locate({ ...missing('mdoe', 'missing-dependency-member'), targetType: 'Rating' }, config))
			.toEqual([['reviewers', 1], ['owners', 'pricing']])
	})

	it('does not match a value that equals the id in a field that is not a widget reference', () => {
		// `label` and `inputType` are plain strings: only the marked `question` is a location.
		const config = { label: 'email', inputType: 'email', visibleWhen: { question: 'email', op: 'answered' } }
		expect(locate(missing('email'), config))
			.toEqual([['visibleWhen', 'question']])
		// With only unmarked matches there is no location.
		expect(locate(missing('email'), { label: 'email', inputType: 'email' }))
			.toBeNull()
	})

	it('reads the `x-widgetRef` annotation, never the sentence in a description', () => {
		// `note`'s description has the sentence but no annotation: not a reference.
		expect(locate(missing('mdoe'), { note: 'mdoe' }))
			.toBeNull()
		// The annotation alone is a mark.
		const bare: JsonSchema = { type: 'object', properties: { question: { type: 'string', [WIDGET_REF_KEYWORD]: ['Numeric'] } } }
		expect(locate(missing('mdoe'), { question: 'mdoe' }, bare))
			.toEqual([['question']])
	})

	it('is null when the schema marks no widget reference (no `WidgetRef` type), or there is no schema', () => {
		const untagged: JsonSchema = { type: 'object', properties: { question: { type: 'string', description: 'A question id.' } } }
		expect(locate(missing('mdoe'), { question: 'mdoe' }, untagged))
			.toBeNull()
		expect(locate(missing('mdoe'), { visibleWhen: { question: 'mdoe', op: 'answered' } }, null))
			.toBeNull()
	})

	it('is null when the id does not come from the config', () => {
		expect(locate(missing('mdoe'), { visibleWhen: { question: 'mode', op: 'answered' } }))
			.toBeNull()
		expect(locate(missing('mdoe'), undefined))
			.toBeNull()
	})

	it('is null for a self, root or parent target', () => {
		const config = { visibleWhen: { question: 'mdoe', op: 'answered' } }
		const operation = { type: 'state-get', key: 'language' } as const
		for (const target of [{ type: 'self' }, { type: 'root' }, { type: 'parent', optional: false }] as const) {
			expect(locate({ code: 'missing-dependency-target', dependency: { target, operation } }, config))
				.toBeNull()
			expect(locate({ code: 'missing-dependency-member', dependency: { target, operation }, targetType: 'Survey' }, config))
				.toBeNull()
		}
	})

	it('applies to missing-dependency-target, capability and member, and not to the others', () => {
		const config = { visibleWhen: { question: 'mdoe', op: 'answered' } }
		expect([...LOCATED_DEPENDENCY_CODES].sort())
			.toEqual(['missing-dependency-capability', 'missing-dependency-member', 'missing-dependency-target'])
		expect(locate(missing('mdoe'), config))
			.toEqual([['visibleWhen', 'question']])
		// ambiguous: no value can choose between widgets that share the id (they carry duplicate-widget-id).
		for (const code of ['ambiguous-dependency-target', 'unresolved-dependency-target', 'property-dependency-has-side-effects', 'invalid-widget-config']) {
			expect(locate({ ...missing('mdoe', code), targetType: 'Survey' }, config))
				.toBeNull()
		}
		// A diagnostic without a dependency.
		expect(locate({ code: 'missing-dependency-target' }, config))
			.toBeNull()
	})

	it('locates a missing capability or member only when the target\'s type is outside the reference\'s allowed types', () => {
		// `visibleWhen.question` allows SingleChoice | Numeric.
		const config = { visibleWhen: { question: 'open-day', op: 'answered' } }
		for (const code of ['missing-dependency-capability', 'missing-dependency-member']) {
			// A Survey is not an allowed type: the value names a widget the contract rules out.
			expect(locate({ ...missing('open-day', code), targetType: 'Survey' }, config))
				.toEqual([['visibleWhen', 'question']])
			// A Numeric is allowed: the value keeps the contract, the plugin reads what the type lacks; it stays at the widget.
			expect(locate({ ...missing('open-day', code), targetType: 'Numeric' }, config))
				.toBeNull()
			// Without the target's type, it cannot be decided: it stays at the widget.
			expect(locate(missing('open-day', code), config))
				.toBeNull()
		}
	})

	it('reads the generated survey schema: a rule condition nested in `all` is a widget reference', () => {
		const survey = getShowcase('survey')!
		const config = {
			label: { en: 'Sessions' },
			options: [{ value: 'kids', label: { en: 'Kids' }, visibleWhen: { question: 'gusets', op: 'greaterThan', value: 0 } }],
			rules: [{
				when: { all: [{ question: 'sessions', op: 'includes', value: 'laser' }, { question: 'gusets', op: 'greaterThan', value: 2 }] },
				message: { en: 'At most 2 guests.' },
			}],
		}
		const generated = survey.configSchemas.MultipleChoice!
		const expected = [['options', 0, 'visibleWhen', 'question'], ['rules', 0, 'when', 'all', 1, 'question']]
		expect(referenceConfigPaths(missing('gusets'), config, schemaWidgetRefs(generated, config)))
			.toEqual(expected)
		// The generated schema annotates the question with the types its `WidgetRef<…>` names (and still has the sentence): the
		// `greaterThan` branch, chosen by the value, reads a Numeric.
		expect(fieldModelAt(generated, config, expected[1]!)?.schema)
			.toMatchObject({ [WIDGET_REF_KEYWORD]: ['Numeric'], description: expect.stringContaining(SENTENCE('Numeric')) })
		// The annotation is what is read: without the sentences the locations are the same, without the annotations there are none.
		const withoutSentences = mapSchema(generated, (key, value) => key === 'description' && typeof value === 'string' ? value.replace(/Must be the id of a widget of type .+? in the same document\./g, '') : value)
		expect(JSON.stringify(withoutSentences))
			.not
			.toContain('Must be the id')
		expect(referenceConfigPaths(missing('gusets'), config, schemaWidgetRefs(withoutSentences, config)))
			.toEqual(expected)
		const withoutAnnotations = mapSchema(generated, (key, value) => key === WIDGET_REF_KEYWORD ? undefined : value)
		expect(referenceConfigPaths(missing('gusets'), config, schemaWidgetRefs(withoutAnnotations, config)))
			.toBeNull()
	})
})

/** A deep copy of `schema` with each keyword's value replaced by `replace(key, value)`; `undefined` drops the keyword. */
function mapSchema(schema: JsonSchema, replace: (key: string, value: unknown) => unknown): JsonSchema {
	return JSON.parse(JSON.stringify(schema, (key, value: unknown) => key === '' ? value : replace(key, value))) as JsonSchema
}

describe('widgetRefTypesOf', () => {
	it('reads the plugin types of the `x-widgetRef` annotation, in written order', () => {
		expect(widgetRefTypesOf({ type: 'string', [WIDGET_REF_KEYWORD]: ['Person'] }))
			.toEqual(['Person'])
		expect(widgetRefTypesOf({ type: 'string', [WIDGET_REF_KEYWORD]: ['SingleChoice', 'MultipleChoice'] }))
			.toEqual(['SingleChoice', 'MultipleChoice'])
	})

	it('is null without the annotation, for a malformed one, and for no schema', () => {
		expect(widgetRefTypesOf({ type: 'string', description: SENTENCE('Person') }))
			.toBeNull()
		for (const malformed of [[], 'Person', ['Person', 1], null]) {
			expect(widgetRefTypesOf({ type: 'string', [WIDGET_REF_KEYWORD]: malformed }))
				.toBeNull()
		}
		expect(widgetRefTypesOf(null))
			.toBeNull()
	})
})

describe('stringValuePaths', () => {
	it('lists every string leaf equal to the needle, under a prefix', () => {
		expect(stringValuePaths({ a: 'x', b: ['y', 'x', { c: 'x' }], d: 1 }, 'x', ['config']))
			.toEqual([['config', 'a'], ['config', 'b', 1], ['config', 'b', 2, 'c']])
		expect(stringValuePaths('x', 'x'))
			.toEqual([[]])
	})
})
