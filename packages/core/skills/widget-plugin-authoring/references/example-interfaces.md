# Example Interfaces

The Interfaces of a small survey System. Together they use every capability, every slot form (a plain union
of plugin types, `WidgetContract<Shape, Types>`, `WidgetContract<Shape>` and `WidgetChild`), a widget reference, an omittable config, named types and reasons with and without `details`. The descriptions belong in each
plugin's builder (`plugin.docs`), not here.

<!-- sample: example-interfaces after -->
```ts
import type { WidgetChild, WidgetContract, WidgetInterfaces, WidgetInterfacesViolationOf, WidgetRef } from '@deviltea/widget-core'

// A dictionary: text per language tag.
export type I18nText = Record<string, string>

export interface ChoiceOption {
	id: string
	label: I18nText
}

export interface SubmitSummary {
	answered: number
	total: number
}

export interface SurveyRawConfig {
	title: I18nText
	maxQuestions?: number
	submitUrl?: string
}

// The root: a header, the questions in order and a footer note.
export interface SurveyInterfaces {
	config: {
		raw: SurveyRawConfig
		resolved: { title: I18nText, maxQuestions: number, submitUrl: string | null }
	}
	slots: {
		// Any widget.
		header: WidgetChild
		// Ratings and choices, read through the contract's Shape by the parent's Properties.
		questions: WidgetContract<{ properties: { answered: boolean } }, 'Rating' | 'Choice'>
		// Any widget that has an `answered` Property, whatever its type (a contract without `Types`).
		extras: WidgetContract<{ properties: { answered: boolean } }>
		// A plain union of plugin types.
		footer: 'Note'
	}
	state: {
		submitted: boolean
	}
	properties: {
		progress: number
	}
	methods: {
		submit: () => boolean
	}
	events: {
		submitted: [summary: SubmitSummary]
	}
	reasons: {
		'empty-title': void
		'too-many-questions': { max: number, count: number }
	}
}

export interface RatingInterfaces {
	config: {
		raw: { question: I18nText, scale?: number }
		resolved: { question: I18nText, scale: number }
	}
	state: {
		value: number | null
	}
	properties: {
		answered: boolean
	}
	methods: {
		rate: (value: number) => number
	}
	events: {
		rated: [value: number]
	}
	reasons: {
		'out-of-range': { min: number, max: number, received: number }
	}
}

export interface ChoiceInterfaces {
	config: {
		raw: {
			question: I18nText
			options: ChoiceOption[]
			multiple?: boolean
			// The id of another question in the same document.
			followUp?: WidgetRef<'Rating' | 'Choice'>
		}
		resolved: { question: I18nText, options: readonly ChoiceOption[], multiple: boolean, followUp: string | null }
	}
	state: {
		selected: readonly string[]
	}
	properties: {
		answered: boolean
	}
	methods: {
		select: (id: string) => readonly string[]
	}
	events: {
		changed: [selected: readonly string[]]
	}
	reasons: {
		'unknown-option': { id: string }
	}
}

// Config only, and it may be left out (`null`).
export interface NoteInterfaces {
	config: {
		raw: { text: I18nText } | null
		resolved: { text: I18nText }
	}
}

// Core's check of an Interfaces type, the one `.interfaces<T>()` applies: `never` when Core accepts the type. A
// malformed slot expectation (a plugin type mixed with a contract, for one) is a violation, and the next phase of the
// builder is then a type error.
type Accepted<T extends WidgetInterfaces> = [WidgetInterfacesViolationOf<T>] extends [never] ? true : false
export const accepted: [Accepted<SurveyInterfaces>, Accepted<RatingInterfaces>, Accepted<ChoiceInterfaces>, Accepted<NoteInterfaces>] = [true, true, true, true]
```
