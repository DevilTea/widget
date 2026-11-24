/**
 * `MultipleChoice`: pick several options. State `answer` stores the raw option values (any strings).
 * `options` evaluates each option's `visibleWhen` and `enabledWhen`; `value` is the effective answer:
 * the selected options that are currently visible and enabled, in option order and so without duplicates,
 * `null` while hidden or when none remains (`[]` is `null`, owner decision Q1/Q2). `errors` reports a raw
 * selection that holds an unknown, hidden or disabled option as `invalid-option` (and, when that leaves
 * nothing, not `required`), counts the *effective* selection against `minSelected` and `maxSelected` once
 * the question has an effective answer, and treats an empty entry as no selection.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { MultipleChoiceConfig, MultipleChoiceRawConfig } from '../config'
import type { AnswerError, OptionState, QuestionText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkMultipleChoiceConfig, resolveMultipleChoiceConfig } from '../config'
import { answerErrorDocs, multipleChoiceConfigDocs, multipleChoiceRawConfigDocs, optionStateDocs, questionTextDocs } from '../docs'
import { builtinError, questionText } from '../domain'
import { checkQuestion } from './check-question'
import { computeOptions, computeRequired, computeVisible, optionReads, questionErrors, requiredReads, ruleReads, selectionOf, visibleReads } from './question-members'
import { languageFrom, languageReads } from './reads'

export interface MultipleChoiceInterfaces extends WidgetInterfaces {
	config: { raw: MultipleChoiceRawConfig, resolved: MultipleChoiceConfig }
	state: {
		answer: readonly string[] | null
	}
	properties: {
		text: QuestionText
		visible: boolean
		required: boolean
		options: readonly OptionState[]
		value: readonly string[] | null
		errors: readonly AnswerError[]
	}
	methods: {
		clear: () => void
	}
}

export const MultipleChoicePlugin = createWidgetPlugin('MultipleChoice')
	.description('A pick-several question. The chosen option values are State `answer`. Properties: `text` (label, help and option labels in the survey language), `visible`, `required`, `options` (each option\'s visible and enabled flags), `value` (the effective answer: only the visible and enabled chosen options; null while hidden or when none remains) and `errors` (empty while hidden). Method `clear()` empties the answer.')
	.interfaces<MultipleChoiceInterfaces>()
	.config({
		description: 'Label and help text per language, options (value, label per language, visibleWhen, enabledWhen), minSelected, maxSelected, required (true, false or a condition), visibleWhen, and custom rules.',
		raw: multipleChoiceRawConfigDocs,
		resolved: multipleChoiceConfigDocs,
		validate: (input, ctx): input is MultipleChoiceRawConfig => {
			checkMultipleChoiceConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveMultipleChoiceConfig,
	})
	.structure(ctx => checkQuestion(ctx, ctx.config))
	.state(state => state.answer({
		description: 'The chosen option values; `null` while nothing is chosen.',
		validate: (input): input is readonly string[] | null => input === null || (Array.isArray(input) && input.every(item => typeof item === 'string')),
		default: () => null,
	}))
	.properties(properties => properties
		.text({
			description: 'The label, help text and option labels in the survey language.',
			ref: questionTextDocs,
			registerDeps: ({ dep, blueprint }) => languageReads(dep, blueprint),
			compute: ({ deps, config }) => questionText(config, languageFrom(deps)),
		})
		.visible({
			description: '`visibleWhen` evaluated against the other questions\' effective answers; `true` without one.',
			registerDeps: ({ dep, config }) => visibleReads(dep, config),
			compute: ({ deps, config }) => computeVisible(config, deps),
		})
		.required({
			description: 'Whether an answer is required (`required`, or its condition), whatever the visibility.',
			registerDeps: ({ dep, config }) => requiredReads(dep, config),
			compute: ({ deps, config }) => computeRequired(config, deps),
		})
		.options({
			description: 'Each option\'s value and its visible and enabled flags.',
			items: { ref: optionStateDocs },
			registerDeps: ({ dep, config }) => optionReads(dep, config.options),
			compute: ({ deps, config }) => computeOptions(config.options, deps),
		})
		.value({
			description: 'The effective answer: only the visible and enabled chosen options; `null` while hidden or when none remains.',
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
				// In option order, so the effective answer does not depend on the order of the ticks.
				const selected = new Set(answer.value)
				const kept = options.value.filter(option => option.visible && option.enabled && selected.has(option.value))
					.map(option => option.value)
				return kept.length === 0 ? null : kept
			},
		})
		.errors({
			description: 'The answer errors in the survey language: `required`, the built-in checks, then the custom rules. Empty while hidden.',
			items: { ref: answerErrorDocs },
			registerDeps: ({ dep, config, widget, blueprint }) => ({
				visible: dep.self.properties.get('visible'),
				required: dep.self.properties.get('required'),
				value: dep.self.properties.get('value'),
				answer: dep.self.state.get('answer'),
				...languageReads(dep, blueprint),
				rules: ruleReads(dep, config, widget.id),
			}),
			compute: ({ deps, config, widget }) => {
				const answer = deps.answer()
				const selection = answer.ok ? selectionOf(answer.value) : []
				return questionErrors(config, deps, (value, language) => {
					const kept = value ?? []
					const errors: AnswerError[] = []
					if (selection.some(item => !kept.includes(item)))
						errors.push(builtinError('invalid-option', language))
					if (value !== null) {
						if (config.minSelected !== null && value.length < config.minSelected)
							errors.push(builtinError('min-selected', language, { min: config.minSelected }))
						if (config.maxSelected !== null && value.length > config.maxSelected)
							errors.push(builtinError('max-selected', language, { max: config.maxSelected }))
					}
					return errors
				}, { selfId: widget.id, hasSelection: selection.length > 0 })
			},
		}))
	.methods(methods => methods.clear({
		description: 'Empties the answer.',
		registerDeps: ({ dep }) => dep.self.state.set('answer'),
		validateArgs: (args): args is [] => args.length === 0,
		execute: ({ deps }) => {
			deps(null)
		},
	}))
	.done()
