import type { BlueprintDependencyReference } from '@deviltea/widget-core'
import type { JsonSchema } from './config-schema'
import type { ReferenceDiagnosticFacts } from './reference-locations'
import { describe, expect, it } from 'vitest'
import { getShowcase } from '../showcases/registry'
import { LOCATED_DEPENDENCY_CODES, referenceConfigPaths, schemaWidgetRefs, stringValuePaths, widgetRefTypesOf } from './reference-locations'

const REF = (types: string) => `Must be the id of a widget of type ${types} in the same document.`

/**
 * A small config schema in the shape `widgetDocs()` generates: a `$ref` root with `$defs`, a condition union (`anyOf`) and the
 * `@widgetRef` sentence on the values that name widgets.
 */
const schema: JsonSchema = {
	$ref: '#/$defs/Config',
	$defs: {
		Config: {
			type: 'object',
			properties: {
				label: { type: 'string', description: 'The label.' },
				inputType: { type: 'string', description: 'The input type, for example "email".' },
				target: { type: 'string', description: `The widget to copy from. ${REF('Numeric')}` },
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
						question: { type: 'string', description: `The question it reads. ${REF('SingleChoice | Numeric')}` },
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

	it('does not match a value that equals the id in a field that is not a widget reference', () => {
		// `label` and `inputType` are plain strings: only the marked `question` is a location.
		const config = { label: 'email', inputType: 'email', visibleWhen: { question: 'email', op: 'answered' } }
		expect(locate(missing('email'), config))
			.toEqual([['visibleWhen', 'question']])
		// With only unmarked matches there is no location.
		expect(locate(missing('email'), { label: 'email', inputType: 'email' }))
			.toBeNull()
	})

	it('is null when the schema marks no widget reference (no @widgetRef tag), or there is no schema', () => {
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
		expect(referenceConfigPaths(missing('gusets'), config, schemaWidgetRefs(survey.configSchemas.MultipleChoice!, config)))
			.toEqual([['options', 0, 'visibleWhen', 'question'], ['rules', 0, 'when', 'all', 1, 'question']])
	})
})

describe('widgetRefTypesOf', () => {
	it('reads the type list of the sentence widgetDocs() writes for @widgetRef', () => {
		expect(widgetRefTypesOf('The id of the Person who paid at the start. Must be the id of a widget of type Person in the same document.'))
			.toEqual(['Person'])
		expect(widgetRefTypesOf('Must be the id of a widget of type SingleChoice | MultipleChoice in the same document.'))
			.toEqual(['SingleChoice', 'MultipleChoice'])
		// A line wrap inside the sentence still reads.
		expect(widgetRefTypesOf('Must be the id of a widget\nof type Numeric in the same document.'))
			.toEqual(['Numeric'])
		expect(widgetRefTypesOf('The input type, for example "email".'))
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
