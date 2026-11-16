/**
 * The structure validator the four question plugins share (`.structure(ctx => checkQuestion(ctx, ctx.config))`).
 *
 * Only a structure validator receives the Blueprint, so every rule that looks at another widget lives
 * here; each is an `invalid-widget-structure` diagnostic at the question with a machine-readable
 * `reason` (structure diagnostics carry no config `path`, so the path is in the message):
 * - `question-outside-survey`: a question must sit in a `Survey`;
 * - `question-id-format`: ids match `^[a-z][a-z0-9-]*$`, so they are safe keys of the response;
 * - `missing-translation`: every text covers every language of the survey;
 * - `condition-type-mismatch`: a condition's operator (and equality value) fits the target's question type;
 * - `condition-unknown-option`: an option value named by a condition exists in the target.
 *
 * What is deliberately left to Core: a missing, ambiguous, unresolved or non-question target is a
 * dependency diagnostic (`missing-dependency-target`, `ambiguous-dependency-target`,
 * `missing-dependency-member`), and a circular condition is a `property-evaluation-cycle`.
 *
 * A widget whose config failed validation compiles through `resolve(null)` with `recovered: true` and an
 * empty `label`. Two consequences (plan P-5):
 * - the widget's own translation checks are skipped (the empty config would report every text as
 *   missing on top of the config diagnostic);
 * - as a *target*, a recovered question is still type-checked (its `type` is real), but its options are
 *   not (the fallback has none, so every option value would look unknown).
 */

import type { BlueprintCompileView } from '@deviltea/widget-core'
import type { QuestionConfig } from '../config'
import { isRecovered, questionConditionLeaves, questionTexts, surveyLanguagesOf } from '../config'
import { formatConfigPath, isPlainObject, isQuestionType, leafTypeMismatch } from '../domain'

type NodeView = Parameters<BlueprintCompileView['getParent']>[0]

export interface QuestionStructureContext {
	readonly widget: NodeView
	readonly blueprint: BlueprintCompileView
	readonly addDiagnostic: (diagnostic: { readonly message: string, readonly reason?: string }) => void
}

/** Questions ids are object keys in `response`, so keep them boring. */
export const QUESTION_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** The option values of a resolved choice question, or `null` when the node has none to read. */
function optionValuesOf(node: object): readonly string[] | null {
	const config = (node as { readonly config?: unknown }).config
	if (!isPlainObject(config) || !Array.isArray(config.options))
		return null
	return config.options.flatMap(option => isPlainObject(option) && typeof option.value === 'string' ? [option.value] : [])
}

export function checkQuestion({ widget, blueprint, addDiagnostic }: QuestionStructureContext, config: QuestionConfig): void {
	const parent = blueprint.getParent(widget)
	if (parent === null || (parent.resolved && parent.type !== 'Survey'))
		addDiagnostic({ message: 'A question must be placed in a Survey.', reason: 'question-outside-survey' })

	const id = widget.id ?? ''
	if (!QUESTION_ID_PATTERN.test(id))
		addDiagnostic({ message: `Question id "${id}" must start with a lowercase letter and use only a-z, 0-9 and "-".`, reason: 'question-id-format' })

	const languages = surveyLanguagesOf(blueprint.root)
	if (languages !== null && !isRecovered(widget)) {
		for (const { path, text } of questionTexts(config)) {
			for (const language of languages) {
				if (!Object.hasOwn(text, language) || typeof text[language] !== 'string')
					addDiagnostic({ message: `${formatConfigPath(path)} has no "${language}" text.`, reason: 'missing-translation' })
			}
		}
	}

	for (const { path, leaf } of questionConditionLeaves(config)) {
		const target = blueprint.getWidget(leaf.question)
		if (target === null || !target.resolved || !isQuestionType(target.type))
			continue
		const mismatch = leafTypeMismatch(leaf, target.type)
		if (mismatch !== null) {
			addDiagnostic({ message: `${formatConfigPath(path)}: ${mismatch}`, reason: 'condition-type-mismatch' })
			continue
		}
		// Past the type check, a string `value` on a choice question names one of its options.
		if (!('value' in leaf) || typeof leaf.value !== 'string' || isRecovered(target) || (target.type !== 'SingleChoice' && target.type !== 'MultipleChoice'))
			continue
		const options = optionValuesOf(target)
		if (options !== null && !options.includes(leaf.value))
			addDiagnostic({ message: `${formatConfigPath(path)}: "${leaf.question}" has no option "${leaf.value}".`, reason: 'condition-unknown-option' })
	}
}
