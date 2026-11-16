/**
 * The rows a choice question renders: its option labels (Property `text`, in the survey language and
 * config order) joined with each option's flags (Property `options`). A hidden option has no row;
 * a disabled option keeps its row with `enabled: false`. Presentation only: the flags are read, never
 * computed here.
 */

import type { OptionState, QuestionText } from '../domain'

export interface ChoiceRow {
	readonly value: string
	readonly label: string
	readonly enabled: boolean
}

export function choiceRows(text: QuestionText | null, options: readonly OptionState[] | null): readonly ChoiceRow[] {
	if (text === null || options === null)
		return []
	const states = new Map(options.map(option => [option.value, option]))
	return text.options.flatMap(({ value, label }) => {
		const state = states.get(value)
		return state?.visible === true ? [{ value, label, enabled: state.enabled }] : []
	})
}
