/**
 * `MultipleChoice`: pick several options. State `answer` stores the raw option values (any strings).
 * `options` evaluates each option's `visibleWhen` and `enabledWhen`; `value` is the effective answer:
 * the selected options that are currently visible and enabled, without duplicates, `null` while hidden
 * or when none remains (`[]` is `null`, owner decision Q1/Q2). `errors` reports a raw selection that
 * holds an unknown, hidden or disabled option as `invalid-option`, and counts the *effective* selection
 * against `minSelected` and `maxSelected` once the question has an effective answer.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { MultipleChoiceConfig, MultipleChoiceRawConfig } from '../config'
import type { AnswerError, OptionState, QuestionText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkMultipleChoiceConfig, resolveMultipleChoiceConfig } from '../config'
import { builtinError, questionText } from '../domain'
import { multipleChoiceConfigSchema } from '../schemas'
import { checkQuestion } from './check-question'
import { availableOptionValues, computeOptions, computeRequired, computeVisible, optionReads, questionErrors, requiredReads, ruleReads, visibleReads } from './question-members'
import { languageOf, languageRead } from './reads'

export interface MultipleChoiceInterfaces extends WidgetInterfaces {
	config: { raw: MultipleChoiceRawConfig, resolved: MultipleChoiceConfig }
	state: { answer: readonly string[] | null }
	properties: {
		text: QuestionText
		visible: boolean
		required: boolean
		options: readonly OptionState[]
		value: readonly string[] | null
		errors: readonly AnswerError[]
	}
	methods: { clear: () => void }
}

export const MultipleChoicePlugin = createWidgetPlugin('MultipleChoice')
	.description('A pick-several question. The chosen option values are State `answer`. Properties: `text` (label, help and option labels in the survey language), `visible`, `required`, `options` (each option\'s visible and enabled flags), `value` (the effective answer: only the visible and enabled chosen options; null while hidden or when none remains) and `errors` (empty while hidden). Method `clear()` empties the answer.')
	.interfaces<MultipleChoiceInterfaces>()
	.config({
		description: 'Label and help text per language, options (value, label per language, visibleWhen, enabledWhen), minSelected, maxSelected, required (true, false or a condition), visibleWhen, and custom rules.',
		schema: multipleChoiceConfigSchema,
		validate: (input, ctx): input is MultipleChoiceRawConfig => {
			checkMultipleChoiceConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveMultipleChoiceConfig,
	})
	.structure(ctx => checkQuestion(ctx, ctx.config))
	.state(state => state.answer({
		validate: (input): input is readonly string[] | null => input === null || (Array.isArray(input) && input.every(item => typeof item === 'string')),
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
		.options({
			registerDeps: ({ dep, config }) => optionReads(dep, config.options),
			compute: ({ deps, config }) => computeOptions(config.options, deps),
		})
		.value({
			registerDeps: ({ dep }) => ({
				answer: dep.self.state.get('answer'),
				visible: dep.self.properties.get('visible'),
				options: dep.self.properties.get('options'),
			}),
			compute: ({ deps }) => {
				const visible = deps.visible()
				const answer = deps.answer()
				const options = deps.options()
				if (!visible.ok || !visible.value || !answer.ok || answer.value === null || !options.ok)
					return null
				const available = availableOptionValues(options.value)
				const kept = [...new Set(answer.value)].filter(value => available.has(value))
				return kept.length === 0 ? null : kept
			},
		})
		.errors({
			registerDeps: ({ dep, config }) => ({
				visible: dep.self.properties.get('visible'),
				required: dep.self.properties.get('required'),
				value: dep.self.properties.get('value'),
				answer: dep.self.state.get('answer'),
				language: languageRead(dep),
				rules: ruleReads(dep, config),
			}),
			compute: ({ deps, config }) => questionErrors(config, deps, (value, language) => {
				const answer = deps.answer()
				const kept = value ?? []
				const errors: AnswerError[] = []
				if (answer.ok && answer.value !== null && answer.value.some(item => !kept.includes(item)))
					errors.push(builtinError('invalid-option', language))
				if (value !== null) {
					if (config.minSelected !== null && value.length < config.minSelected)
						errors.push(builtinError('min-selected', language, { min: config.minSelected }))
					if (config.maxSelected !== null && value.length > config.maxSelected)
						errors.push(builtinError('max-selected', language, { max: config.maxSelected }))
				}
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
