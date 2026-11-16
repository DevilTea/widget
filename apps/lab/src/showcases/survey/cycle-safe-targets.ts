/**
 * Which questions may one condition slot name without creating an evaluation cycle?
 *
 * This is the editor capability behind "why Widget requires dependencies to be declared": every
 * condition target is a declared dependency, so a cycle is known when the document is compiled, and an
 * editor can forbid or remove the choices that would create one. The Lab has no editor UI; this
 * function is exercised by tests only.
 */

import type { JsonValue } from '@deviltea/widget-core'
import type { QuestionConfig } from './config'
import type { Condition } from './domain'
import { createWidgetDocument } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { isQuestionType } from './domain'
import { surveySystem } from './system'

/** One place in a question's config that holds a condition. */
export type ConditionSlot
	= | { readonly kind: 'visibleWhen' }
		| { readonly kind: 'required' }
		| { readonly kind: 'option', readonly option: string, readonly field: 'visibleWhen' | 'enabledWhen' }
		| { readonly kind: 'rule', readonly index: number }

export type TargetClassification
	= | { readonly ok: true, readonly safe: readonly string[], readonly cycle: readonly string[] }
		| { readonly ok: false, readonly reason: 'invalid-document' | 'unknown-question' | 'unknown-slot' }

/**
 * Classifies every question (the asked question itself included, in document order) as a `safe` or a
 * `cycle` target for `slot`: the candidate `{ question, op: 'answered' }` is combined with the slot's
 * current condition through `all`, written with a source patch to a copy of `source`, and the copy is
 * compiled. Core is the only cycle authority: the candidate is a `cycle` exactly when
 * `inspectBlueprint(...).invalidCycles` of that compile is not empty. There is no graph walk here.
 *
 * Cost: one compile per candidate (plus the Document's own compile of the unchanged source). Fine at
 * survey sizes. The check is as conservative as Core's analysis, which is per member, not per branch
 * (design §2.3 "Limits"). `source` is never mutated.
 */
export function classifyConditionTargets(source: unknown, questionId: string, slot: ConditionSlot): TargetClassification {
	const blueprint = surveySystem.createBlueprint(source)
	if (blueprint.status !== 'valid')
		return { ok: false, reason: 'invalid-document' }

	const questions = blueprint.getChildrenAt(blueprint.root, 'questions')
	const question = blueprint.getWidget(questionId)
	if (question === null || !isQuestionType(question.type))
		return { ok: false, reason: 'unknown-question' }

	const located = locateSlot(question.config as QuestionConfig, slot)
	if (located === null)
		return { ok: false, reason: 'unknown-slot' }
	const path = [...blueprint.getSourcePath(question)!, 'config', ...located.path]

	const safe: string[] = []
	const cycle: string[] = []
	for (const { id } of questions) {
		const candidate: Condition = { question: id, op: 'answered' }
		const value = located.current === null ? candidate : { all: [located.current, candidate] }
		const document = createWidgetDocument({ system: surveySystem, source })
		document.applyPatch([{ op: 'add', path, value: value as unknown as JsonValue }])
		const hasCycle = inspectBlueprint(document.getSnapshot().blueprint).invalidCycles.length > 0
		;(hasCycle ? cycle : safe).push(id)
	}
	return { ok: true, safe, cycle }
}

/** The slot's path inside the question's `config` and its current condition (`null`: none, or a boolean). */
function locateSlot(config: QuestionConfig, slot: ConditionSlot): { path: (string | number)[], current: Condition | null } | null {
	const conditionOrNull = (value: boolean | Condition | null) => typeof value === 'boolean' ? null : value
	switch (slot.kind) {
		case 'visibleWhen':
			return { path: ['visibleWhen'], current: config.visibleWhen }
		case 'required':
			return { path: ['required'], current: conditionOrNull(config.required) }
		case 'option': {
			const index = config.options?.findIndex(option => option.value === slot.option) ?? -1
			return index < 0 ? null : { path: ['options', index, slot.field], current: config.options![index]![slot.field] }
		}
		case 'rule': {
			const rule = config.rules[slot.index]
			return rule === undefined ? null : { path: ['rules', slot.index, 'when'], current: rule.when }
		}
	}
}
