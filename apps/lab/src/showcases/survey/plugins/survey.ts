/**
 * `Survey`: the root of a survey. It holds the survey language (State `language`) and the submitted
 * snapshot (State `submitted`), aggregates every question's `visible`, `required`, `value` and `errors`
 * into `response` (the one object a backend reads), and exposes `canSubmit`, `changedSinceSubmit` and
 * the `submit()` Method.
 *
 * `submit()` is the showcase's one emitting Method: when no question has errors it writes `submitted`
 * and emits `submitted` once with the response; otherwise it fails with a Method diagnostic
 * (`reason: 'answer-errors'`, message in the survey language) and writes and emits nothing.
 *
 * The root reaches the questions only through `dep.widget(id)` (it cannot know their plugin types
 * statically), reading exactly the four fixed members; it never reads `errors` of a question into a
 * cycle, because conditions cannot name `errors`.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { SurveyConfig, SurveyRawConfig } from '../config'
import type { SurveyResponse, SurveyText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkSurveyConfig, resolveSurveyConfig } from '../config'
import { isAnswerErrors, isAnswerValue, isQuestionType, isSurveyResponse, sameAnswerValues, surveyText } from '../domain'
import { surveyConfigSchema } from '../schemas'
import { languageOf } from './reads'

export interface SurveyInterfaces extends WidgetInterfaces {
	config: { raw: SurveyRawConfig, resolved: SurveyConfig }
	slots: 'questions'
	state: { language: string, submitted: SurveyResponse | null }
	properties: {
		text: SurveyText
		response: SurveyResponse
		canSubmit: boolean
		changedSinceSubmit: boolean
	}
	methods: { submit: () => SurveyResponse }
	events: { submitted: [response: SurveyResponse] }
}

/** What a failed `submit()` returns: the failure is the diagnostic, the value is only context. */
const EMPTY_RESPONSE: SurveyResponse = { language: '', answers: {} }

function isBoolean(input: unknown): input is boolean {
	return typeof input === 'boolean'
}

export const SurveyPlugin = createWidgetPlugin('Survey')
	.description('The root of a survey. Holds the active language and the submitted snapshot, aggregates every question\'s visible/required/value/errors into `response`, reports `canSubmit` (no question has errors) and `changedSinceSubmit`, and `submit()` is blocked while any question has errors.')
	.interfaces<SurveyInterfaces>()
	.config({
		description: 'The survey title per language and the survey languages (the first is the default; en and zh-TW are supported).',
		schema: surveyConfigSchema,
		validate: (input, ctx): input is SurveyRawConfig => {
			checkSurveyConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveSurveyConfig,
	})
	.slots({
		questions: {
			description: 'The questions in display order: ShortAnswer, SingleChoice, MultipleChoice or Numeric.',
			validateStructure: ({ children, addDiagnostic }) => {
				children.forEach((child, index) => {
					if (child.resolved && !isQuestionType(child.type))
						addDiagnostic({ message: `"${child.type}" is not a question type.`, index, reason: 'not-a-question' })
				})
			},
		},
	})
	.structure(({ widget, blueprint, addDiagnostic }) => {
		if (blueprint.getParent(widget) !== null)
			addDiagnostic({ message: 'A Survey must be the root widget.', reason: 'survey-not-root' })
	})
	.state(state => state
		.language({
			validate: (input, ctx): input is string => typeof input === 'string' && ctx.config.languages.includes(input),
			default: ({ config }) => config.languages[0] ?? 'en',
		})
		.submitted({
			validate: (input): input is SurveyResponse | null => input === null || isSurveyResponse(input),
			default: () => null,
		}))
	.properties(properties => properties
		.text({
			registerDeps: ({ dep }) => dep.self.state.get('language'),
			compute: ({ deps, config }) => surveyText(config, languageOf(deps())),
		})
		.response({
			registerDeps: ({ widget, blueprint, dep }) => ({
				language: dep.self.state.get('language'),
				// A child that is not a question type is reported by the slot validator; reading it would
				// only add dependency diagnostics on top.
				questions: Object.fromEntries(blueprint.getChildrenAt(widget, 'questions')
					.flatMap(child => child.resolved && isQuestionType(child.type)
						? [[child.id, {
								visible: dep.widget(child.id)
									.properties
									.get('visible')
									.validate(isBoolean),
								required: dep.widget(child.id)
									.properties
									.get('required')
									.validate(isBoolean),
								value: dep.widget(child.id)
									.properties
									.get('value')
									.validate(isAnswerValue),
								errors: dep.widget(child.id)
									.properties
									.get('errors')
									.validate(isAnswerErrors),
							}] as const]
						: [])),
			}),
			compute: ({ deps }) => ({
				language: languageOf(deps.language()),
				answers: Object.fromEntries(Object.entries(deps.questions)
					.map(([id, read]) => {
						const visible = read.visible()
						const required = read.required()
						const value = read.value()
						const errors = read.errors()
						return [id, {
							visible: visible.ok && visible.value,
							required: required.ok && required.value,
							value: value.ok ? value.value : null,
							errors: errors.ok ? errors.value : [],
						}]
					})),
			}),
		})
		.canSubmit({
			registerDeps: ({ dep }) => dep.self.properties.get('response'),
			compute: ({ deps }) => {
				const response = deps()
				return response.ok && Object.values(response.value.answers)
					.every(answer => answer.errors.length === 0)
			},
		})
		.changedSinceSubmit({
			registerDeps: ({ dep }) => ({
				submitted: dep.self.state.get('submitted'),
				response: dep.self.properties.get('response'),
			}),
			compute: ({ deps }) => {
				const submitted = deps.submitted()
				const response = deps.response()
				return submitted.ok && submitted.value !== null && response.ok && !sameAnswerValues(submitted.value, response.value)
			},
		}))
	.methods(methods => methods.submit({
		validateArgs: (args): args is [] => args.length === 0,
		registerDeps: ({ dep }) => ({
			response: dep.self.properties.get('response'),
			canSubmit: dep.self.properties.get('canSubmit'),
			language: dep.self.state.get('language'),
			setSubmitted: dep.self.state.set('submitted'),
		}),
		emits: ['submitted'],
		execute: ({ deps, emit, config, addDiagnostic }) => {
			const response = deps.response()
			const canSubmit = deps.canSubmit()
			if (!response.ok || !canSubmit.ok)
				return EMPTY_RESPONSE // the dependency failure is already recorded: the Method fails
			if (!canSubmit.value) {
				addDiagnostic({ message: surveyText(config, languageOf(deps.language()))
					.blocked, reason: 'answer-errors' })
				return response.value
			}
			deps.setSubmitted(response.value)
			emit.submitted(response.value)
			return response.value
		},
	}))
	.events(events => events.submitted({ description: 'An answer set with no errors was submitted. Carries the response: visible, required, value and errors per question.' }))
	.done()
