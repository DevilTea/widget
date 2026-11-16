/**
 * `Numeric`: a number question. The respondent's number is State `answer` (any finite number is
 * stored); `visible`, `required`, `value` (the effective answer, `null` while hidden) and `errors`
 * (`[]` while hidden; `required`, `integer`, `min`, `max` and custom rules otherwise) are the fixed
 * members a host reads. A number that breaks `integer`, `min` or `max` is stored and reported, never
 * rejected, so a backend that writes it still gets an error to read instead of a lost write.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { NumericConfig, NumericRawConfig } from '../config'
import type { AnswerError, QuestionText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkNumericConfig, resolveNumericConfig } from '../config'
import { builtinError, questionText } from '../domain'
import { numericConfigSchema } from '../schemas'
import { checkQuestion } from './check-question'
import { computeRequired, computeVisible, questionErrors, requiredReads, ruleReads, visibleReads } from './question-members'
import { languageOf, languageRead } from './reads'

export interface NumericInterfaces extends WidgetInterfaces {
	config: { raw: NumericRawConfig, resolved: NumericConfig }
	state: { answer: number | null }
	properties: {
		text: QuestionText
		visible: boolean
		required: boolean
		value: number | null
		errors: readonly AnswerError[]
	}
	methods: { clear: () => void }
}

export const NumericPlugin = createWidgetPlugin('Numeric')
	.description('A numeric question. The respondent\'s number is State `answer`. Properties: `text` (label and help in the survey language), `visible`, `required`, `value` (the effective answer: null while hidden) and `errors` (empty while hidden). Method `clear()` empties the answer.')
	.interfaces<NumericInterfaces>()
	.config({
		description: 'Label and help text per language, required (true, false or a condition), visibleWhen, min, max, integer, and custom rules.',
		schema: numericConfigSchema,
		validate: (input, ctx): input is NumericRawConfig => {
			checkNumericConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveNumericConfig,
	})
	.structure(ctx => checkQuestion(ctx, ctx.config))
	.state(state => state.answer({
		validate: (input): input is number | null => input === null || (typeof input === 'number' && Number.isFinite(input)),
		default: () => null,
	}))
	.properties(properties => properties
		.text({
			registerDeps: ({ dep }) => languageRead(dep),
			compute: ({ deps, config }) => questionText(config, languageOf(deps())),
		})
		.visible({
			registerDeps: ({ dep, config }) => visibleReads(dep, config),
			compute: ({ deps, config }) => computeVisible(config, deps),
		})
		.required({
			registerDeps: ({ dep, config }) => requiredReads(dep, config),
			compute: ({ deps, config }) => computeRequired(config, deps),
		})
		.value({
			registerDeps: ({ dep }) => ({
				answer: dep.self.state.get('answer'),
				visible: dep.self.properties.get('visible'),
			}),
			compute: ({ deps }) => {
				const visible = deps.visible()
				const answer = deps.answer()
				return visible.ok && visible.value && answer.ok ? answer.value : null
			},
		})
		.errors({
			registerDeps: ({ dep, config }) => ({
				visible: dep.self.properties.get('visible'),
				required: dep.self.properties.get('required'),
				value: dep.self.properties.get('value'),
				language: languageRead(dep),
				rules: ruleReads(dep, config),
			}),
			compute: ({ deps, config }) => questionErrors(config, deps, (value, language) => {
				if (value === null)
					return []
				const errors: AnswerError[] = []
				if (config.integer && !Number.isInteger(value))
					errors.push(builtinError('integer', language))
				if (config.min !== null && value < config.min)
					errors.push(builtinError('min', language, { min: config.min }))
				if (config.max !== null && value > config.max)
					errors.push(builtinError('max', language, { max: config.max }))
				return errors
			}),
		}))
	.methods(methods => methods.clear({
		registerDeps: ({ dep }) => dep.self.state.set('answer'),
		validateArgs: (args): args is [] => args.length === 0,
		execute: ({ deps }) => {
			deps(null)
		},
	}))
	.done()
