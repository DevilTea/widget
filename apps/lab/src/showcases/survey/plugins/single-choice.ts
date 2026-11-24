/**
 * `SingleChoice`: pick one option. State `answer` stores the raw option value (any string). `options`
 * evaluates each option's `visibleWhen` and `enabledWhen`; `value` is the effective answer, `null`
 * while hidden or when the chosen option is unknown, hidden or disabled (owner decision Q2), and
 * `errors` reports such a raw answer as `invalid-option`.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SingleChoiceConfig, SingleChoiceRawConfig } from '../config'
import type { AnswerError, OptionState, QuestionText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkSingleChoiceConfig, resolveSingleChoiceConfig } from '../config'
import { answerErrorDocs, optionStateDocs, questionTextDocs, singleChoiceConfigDocs, singleChoiceRawConfigDocs } from '../docs'
import { builtinError, questionText } from '../domain'
import { checkQuestion } from './check-question'
import { availableOptionValues, computeOptions, computeRequired, computeVisible, optionReads, questionErrors, requiredReads, ruleReads, selectionOf, visibleReads } from './question-members'
import { languageFrom, languageReads } from './reads'

export interface SingleChoiceInterfaces extends WidgetInterfaces {
	config: { raw: SingleChoiceRawConfig, resolved: SingleChoiceConfig }
	state: {
		answer: string | null
	}
	properties: {
		text: QuestionText
		visible: boolean
		required: boolean
		options: readonly OptionState[]
		value: string | null
		errors: readonly AnswerError[]
	}
	methods: {
		clear: () => void
	}
}

export const SingleChoicePlugin = createWidgetPlugin('SingleChoice')
	.description('A pick-one question. The chosen option value is State `answer`. Properties: `text` (label, help and option labels in the survey language), `visible`, `required`, `options` (each option\'s visible and enabled flags), `value` (the effective answer: null while hidden or when the chosen option is unavailable) and `errors` (empty while hidden). Method `clear()` empties the answer.')
	.interfaces<SingleChoiceInterfaces>()
	.config({
		description: 'Label and help text per language, options (value, label per language, visibleWhen, enabledWhen), required (true, false or a condition), visibleWhen, and custom rules.',
		raw: singleChoiceRawConfigDocs,
		resolved: singleChoiceConfigDocs,
		validate: (input, ctx): input is SingleChoiceRawConfig => {
			checkSingleChoiceConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSingleChoiceConfig,
	})
	.structure(ctx => checkQuestion(ctx, ctx.config))
	.state(state => state.answer({
		description: 'The chosen option value; `null` while nothing is chosen.',
		validate: (input): input is string | null => input === null || typeof input === 'string',
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
			description: 'The effective answer: `null` while hidden or when the chosen option is unavailable.',
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
				return availableOptionValues(options.value)
					.has(answer.value)
					? answer.value
					: null
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
				const hasSelection = answer.ok && selectionOf(answer.value).length > 0
				return questionErrors(config, deps, (value, language) => hasSelection && value === null
					? [builtinError('invalid-option', language)]
					: [], { selfId: widget.id, hasSelection })
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
