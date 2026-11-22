/**
 * `ShortAnswer`: a free-text question. State `answer` stores the raw string. `value` is the effective
 * answer: the trimmed text, `null` while hidden or when the text is empty after trimming. `max-length`
 * counts characters of the trimmed text.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { ShortAnswerConfig, ShortAnswerRawConfig } from '../config'
import type { AnswerError, QuestionText } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkShortAnswerConfig, resolveShortAnswerConfig } from '../config'
import { builtinError, questionText } from '../domain'
import { checkQuestion } from './check-question'
import { computeRequired, computeVisible, questionErrors, requiredReads, ruleReads, visibleReads } from './question-members'
import { languageFrom, languageReads } from './reads'

/**
 * A free-text question. The respondent's text is State `answer`. Properties: `text` (label and help in the survey
 * language), `visible`, `required`, `value` (the effective answer: the trimmed text, null while hidden or empty) and
 * `errors` (empty while hidden). Method `clear()` empties the answer.
 */
export interface ShortAnswerInterfaces extends WidgetInterfaces {
	/** Label and help text per language, required (true, false or a condition), visibleWhen, maxLength, and custom rules. */
	config: { raw: ShortAnswerRawConfig, resolved: ShortAnswerConfig }
	state: {
		/** The respondent's text, as typed; `null` while unanswered. */
		answer: string | null
	}
	properties: {
		/** The label and help text in the survey language. */
		text: QuestionText
		/** `visibleWhen` evaluated against the other questions' effective answers; `true` without one. */
		visible: boolean
		/** Whether an answer is required (`required`, or its condition), whatever the visibility. */
		required: boolean
		/** The effective answer: the trimmed text; `null` while hidden or empty. */
		value: string | null
		/** The answer errors in the survey language: `required`, the built-in checks, then the custom rules. Empty while hidden. */
		errors: readonly AnswerError[]
	}
	methods: {
		/** Empties the answer. */
		clear: () => void
	}
}

export const ShortAnswerPlugin = createWidgetPlugin('ShortAnswer')
	.interfaces<ShortAnswerInterfaces>()
	.config({
		validate: (input, ctx): input is ShortAnswerRawConfig => {
			checkShortAnswerConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveShortAnswerConfig,
	})
	.structure(ctx => checkQuestion(ctx, ctx.config))
	.state(state => state.answer({
		validate: (input): input is string | null => input === null || typeof input === 'string',
		default: () => null,
	}))
	.properties(properties => properties
		.text({
			registerDeps: ({ dep, blueprint }) => languageReads(dep, blueprint),
			compute: ({ deps, config }) => questionText(config, languageFrom(deps)),
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
				if (!visible.ok || !visible.value || !answer.ok || answer.value === null)
					return null
				const trimmed = answer.value.trim()
				return trimmed === '' ? null : trimmed
			},
		})
		.errors({
			registerDeps: ({ dep, config, widget, blueprint }) => ({
				visible: dep.self.properties.get('visible'),
				required: dep.self.properties.get('required'),
				value: dep.self.properties.get('value'),
				...languageReads(dep, blueprint),
				rules: ruleReads(dep, config, widget.id),
			}),
			compute: ({ deps, config, widget }) => questionErrors(config, deps, (value, language) =>
				value !== null && config.maxLength !== null && Array.from(value).length > config.maxLength
					? [builtinError('max-length', language, { max: config.maxLength })]
					: [], { selfId: widget.id }),
		}))
	.methods(methods => methods.clear({
		registerDeps: ({ dep }) => dep.self.state.set('answer'),
		validateArgs: (args): args is [] => args.length === 0,
		execute: ({ deps }) => {
			deps(null)
		},
	}))
	.done()
