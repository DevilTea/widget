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
import { shortAnswerConfigSchema } from '../schemas'
import { checkQuestion } from './check-question'
import { computeRequired, computeVisible, questionErrors, requiredReads, ruleReads, visibleReads } from './question-members'
import { languageOf, languageRead } from './reads'

export interface ShortAnswerInterfaces extends WidgetInterfaces {
	config: { raw: ShortAnswerRawConfig, resolved: ShortAnswerConfig }
	state: { answer: string | null }
	properties: {
		text: QuestionText
		visible: boolean
		required: boolean
		value: string | null
		errors: readonly AnswerError[]
	}
	methods: { clear: () => void }
}

export const ShortAnswerPlugin = createWidgetPlugin('ShortAnswer')
	.description('A free-text question. The respondent\'s text is State `answer`. Properties: `text` (label and help in the survey language), `visible`, `required`, `value` (the effective answer: the trimmed text, null while hidden or empty) and `errors` (empty while hidden). Method `clear()` empties the answer.')
	.interfaces<ShortAnswerInterfaces>()
	.config({
		description: 'Label and help text per language, required (true, false or a condition), visibleWhen, maxLength, and custom rules.',
		schema: shortAnswerConfigSchema,
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
				if (!visible.ok || !visible.value || !answer.ok || answer.value === null)
					return null
				const trimmed = answer.value.trim()
				return trimmed === '' ? null : trimmed
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
			compute: ({ deps, config }) => questionErrors(config, deps, (value, language) =>
				value !== null && config.maxLength !== null && Array.from(value).length > config.maxLength
					? [builtinError('max-length', language, { max: config.maxLength })]
					: []),
		}))
	.methods(methods => methods.clear({
		registerDeps: ({ dep }) => dep.self.state.set('answer'),
		validateArgs: (args): args is [] => args.length === 0,
		execute: ({ deps }) => {
			deps(null)
		},
	}))
	.done()
