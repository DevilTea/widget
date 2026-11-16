/**
 * Dependency helpers shared by the survey plugins.
 *
 * A condition names another question by id. `answerReads` lowers the ids of a condition into declared
 * dependencies on those questions' `value` Property (the *effective* answer, `null` while hidden), keyed
 * by question id so the id travels to `compute`, where `readerOf` turns the executed dependencies back
 * into a `(questionId) => AnswerValue` function for `evaluateCondition`. Because these are
 * Property-to-Property edges, two questions conditioned on each other are a `property-evaluation-cycle`
 * when the Blueprint is compiled.
 */

import type { BlueprintCompileView, DependencyBuilder, ExecutionResult, PropertyGetDepExpression, RuntimePropertyDependencyDiagnostic, WidgetInterfaces } from '@deviltea/widget-core'
import type { AnswerValue } from '../domain'
import { isAnswerValue } from '../domain'

export type ValueRead = PropertyGetDepExpression<AnswerValue, false>

/** The part of the dependency builder these helpers use; every plugin's builder satisfies it. */
export type PropertyDeps = Pick<DependencyBuilder<WidgetInterfaces, 'property'>, 'widget' | 'root'>

/** The executed form of `answerReads`: one callable per question id. */
export interface AnswerReaders {
	readonly [questionId: string]: () => ExecutionResult<AnswerValue, RuntimePropertyDependencyDiagnostic>
}

/**
 * One `value` dependency per question id. `Object.fromEntries` (not `obj[id] = ...`) keeps an id such as
 * `__proto__` an own key. A container leaf must be a dependency expression, so the id is the key.
 */
export function answerReads(dep: PropertyDeps, ids: Iterable<string>): { readonly [questionId: string]: ValueRead } {
	return Object.fromEntries([...ids].map(id => [id, dep.widget(id)
		.properties
		.get('value')
		.validate(isAnswerValue)]))
}

/**
 * Reads the effective answer of a question named by a condition. A question whose read failed counts as
 * unanswered: the failure is already recorded as the Property's own dependency diagnostic.
 */
export function readerOf(deps: AnswerReaders): (questionId: string) => AnswerValue {
	return (questionId) => {
		const result = Object.hasOwn(deps, questionId) ? deps[questionId]!() : null
		return result?.ok === true ? result.value : null
	}
}

function isString(input: unknown): input is string {
	return typeof input === 'string'
}

/** The survey language: the root's State `language`. */
export function languageRead(dep: PropertyDeps) {
	return dep.root.state.get('language')
		.validate(isString)
}

/**
 * The survey language read of a question: `{ language }` when the root is a `Survey`, `{}` otherwise. A
 * question placed at the root is already `question-outside-survey`; reading `language` from it would add
 * a `missing-dependency-member` on top of that one diagnostic.
 */
export function languageReads(dep: PropertyDeps, blueprint: BlueprintCompileView): { readonly language?: ReturnType<typeof languageRead> } {
	const root = blueprint.root
	return root.resolved && root.type === 'Survey' ? { language: languageRead(dep) } : {}
}

const FALLBACK_LANGUAGE = 'en'

/**
 * The survey language from an executed `languageRead`, or from the root's own `state.get('language')`
 * (typed `string | null` there). A failed read is already a recorded diagnostic.
 */
export function languageOf(result: ExecutionResult<string | null, unknown>): string {
	return result.ok && result.value !== null ? result.value : FALLBACK_LANGUAGE
}

/** The executed form of `languageReads`; the language is the fallback when there is no read. */
export interface LanguageReaders {
	readonly language?: () => ExecutionResult<string | null, unknown>
}

export function languageFrom(readers: LanguageReaders): string {
	return readers.language === undefined ? FALLBACK_LANGUAGE : languageOf(readers.language())
}
