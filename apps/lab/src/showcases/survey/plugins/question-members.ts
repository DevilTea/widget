/**
 * The member logic the four question plugins share, as plain functions: `visible`, `required`, the
 * option states of the choice questions, and the shape of `errors`. Each plugin still declares its own
 * members (the builder types them per plugin); this module only holds what would otherwise be copied.
 *
 * Semantics fixed here (owner decisions Q1-Q3):
 * - `visible` is `visibleWhen` evaluated against the other questions' effective answers (`true` when
 *   absent). A hidden question's own `value` is `null`, which every condition reads as unanswered.
 * - `required` reports the rule regardless of visibility (Q3).
 * - `errors` is `[]` while hidden; otherwise `required` (no effective answer), then the type-specific
 *   built-in errors, then the custom rule errors, all in the survey language.
 */

import type { ExecutionResult, RuntimePropertyDependencyDiagnostic } from '@deviltea/widget-core'
import type { QuestionConfigBase, ResolvedOption } from '../config'
import type { AnswerError, AnswerValue, Condition, OptionState } from '../domain'
import type { AnswerReaders, PropertyDeps } from './reads'
import { builtinError, conditionTargets, evaluateCondition, ruleErrors } from '../domain'
import { answerReads, languageOf, readerOf } from './reads'

// -------------------------------------------------------------------------------------------------
// visible and required
// -------------------------------------------------------------------------------------------------

export function visibleReads(dep: PropertyDeps, config: QuestionConfigBase) {
	return answerReads(dep, conditionTargets(config.visibleWhen))
}

export function computeVisible(config: QuestionConfigBase, deps: AnswerReaders): boolean {
	return config.visibleWhen === null || evaluateCondition(config.visibleWhen, readerOf(deps))
}

export function requiredReads(dep: PropertyDeps, config: QuestionConfigBase) {
	return answerReads(dep, typeof config.required === 'boolean' ? [] : conditionTargets(config.required))
}

export function computeRequired(config: QuestionConfigBase, deps: AnswerReaders): boolean {
	return typeof config.required === 'boolean' ? config.required : evaluateCondition(config.required, readerOf(deps))
}

// -------------------------------------------------------------------------------------------------
// Options (choice questions)
// -------------------------------------------------------------------------------------------------

function optionConditions(options: readonly ResolvedOption[]): (Condition | null)[] {
	return options.flatMap(option => [option.visibleWhen, option.enabledWhen])
}

export function optionReads(dep: PropertyDeps, options: readonly ResolvedOption[]) {
	return answerReads(dep, optionConditions(options)
		.flatMap(condition => [...conditionTargets(condition)]))
}

export function computeOptions(options: readonly ResolvedOption[], deps: AnswerReaders): readonly OptionState[] {
	const read = readerOf(deps)
	return options.map(option => ({
		value: option.value,
		visible: option.visibleWhen === null || evaluateCondition(option.visibleWhen, read),
		enabled: option.enabledWhen === null || evaluateCondition(option.enabledWhen, read),
	}))
}

/** The option values a respondent can currently hold: visible and enabled. */
export function availableOptionValues(options: readonly OptionState[]): ReadonlySet<string> {
	return new Set(options.filter(option => option.visible && option.enabled)
		.map(option => option.value))
}

// -------------------------------------------------------------------------------------------------
// errors
// -------------------------------------------------------------------------------------------------

/** The executed dependencies of an `errors` Property; a plugin adds its own (such as `answer`). */
export interface ErrorDeps<Value extends AnswerValue> {
	readonly visible: () => ExecutionResult<boolean, RuntimePropertyDependencyDiagnostic>
	readonly required: () => ExecutionResult<boolean, RuntimePropertyDependencyDiagnostic>
	readonly value: () => ExecutionResult<Value | null, RuntimePropertyDependencyDiagnostic>
	readonly language: () => ExecutionResult<string, RuntimePropertyDependencyDiagnostic>
	readonly rules: AnswerReaders
}

/** Every question id that a rule of `config` reads. */
export function ruleReads(dep: PropertyDeps, config: QuestionConfigBase) {
	return answerReads(dep, config.rules.flatMap(rule => [...conditionTargets(rule.when)]))
}

/**
 * Assembles `errors`: `[]` while hidden, else `required` (when there is no effective answer and the
 * question is required), the plugin's own `check` of the effective answer, then the custom rules.
 * `check` runs for a missing answer too (`null`), because a choice question reports `invalid-option`
 * for a raw answer that was dropped from `value`.
 */
export function questionErrors<Value extends AnswerValue>(
	config: QuestionConfigBase,
	deps: ErrorDeps<Value>,
	check: (value: Value | null, language: string) => readonly AnswerError[],
): AnswerError[] {
	const visible = deps.visible()
	if (!visible.ok || !visible.value)
		return []
	const language = languageOf(deps.language())
	const result = deps.value()
	const value = result.ok ? result.value : null
	const required = deps.required()
	return [
		...(value === null && required.ok && required.value ? [builtinError('required', language)] : []),
		...check(value, language),
		...ruleErrors(config.rules, readerOf(deps.rules), language),
	]
}
