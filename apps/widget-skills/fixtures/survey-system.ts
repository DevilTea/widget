/**
 * The fixture System of the generator. It is small and fully documented in the builder (Core 0.4: the prose lives
 * on `plugin.docs`), and it exercises every feature the generator reads:
 *
 * - config `raw` with field docs whose prose states the constraints, a named dictionary type and a named object type
 *   documented once with `defineTypeDocs`, an omittable config (`Note`) and a `WidgetRef`;
 * - record slots in all three forms: a plain union of plugin types (`Survey.footer`), a
 *   `WidgetContract<Shape, Types>` (`Survey.questions`) and `WidgetChild` (`Survey.header`);
 * - `reasons` with a `void` reason and reasons with payloads (`details` docs);
 * - State (with `authorWritable`), Properties, Methods with parameters and Events with labelled payloads;
 * - descriptions with a second paragraph (the remarks).
 */

import type { WidgetChild, WidgetContract, WidgetRef } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem, defineTypeDocs } from '@deviltea/widget-core'

export type I18nText = Record<string, string>

export const i18nTextDocs = defineTypeDocs<I18nText>('I18nText', {
	description: 'Text per language, keyed by language tag (`en`, `zh-TW`).\n\nAt least one language should be present; the renderer falls back to the first one.',
})

export interface ChoiceOption {
	id: string
	label: I18nText
}

export const choiceOptionDocs = defineTypeDocs<ChoiceOption>('ChoiceOption', {
	description: 'One option of a choice question.',
	fields: {
		id: { description: 'The option\'s identifier, unique within the question: a lowercase letter, then lowercase letters, digits or hyphens (`^[a-z][a-z0-9-]*$`).' },
		label: { description: 'The label shown for the option.', ref: i18nTextDocs },
	},
})

export interface SubmitSummary {
	answered: number
	total: number
}

export const submitSummaryDocs = defineTypeDocs<SubmitSummary>('SubmitSummary', {
	description: 'What `Survey.submit()` reports when the survey is sent.',
	fields: {
		answered: { description: 'How many questions were answered.' },
		total: { description: 'How many questions the survey has.' },
	},
})

const isObject = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input)
function isI18nText(input: unknown): input is I18nText {
	return isObject(input) && Object.values(input)
		.every(value => typeof value === 'string')
}
const isNumberFrom = (input: unknown, min: number, max: number): boolean => typeof input === 'number' && input >= min && input <= max
function isUri(input: unknown): boolean {
	if (typeof input !== 'string')
		return false
	try {
		void new URL(input)
		return true
	}
	catch {
		return false
	}
}
const OPTION_ID = /^[a-z][a-z0-9-]*$/

// -------------------------------------------------------------------------------------------------
// Survey (root)
// -------------------------------------------------------------------------------------------------

export interface SurveyRawConfig {
	title: I18nText
	maxQuestions?: number
	submitUrl?: string
}

export interface SurveyInterfaces {
	config: {
		raw: SurveyRawConfig
		resolved: { title: I18nText, maxQuestions: number, submitUrl: string | null }
	}
	slots: {
		header: WidgetChild
		questions: WidgetContract<{ properties: { answered: boolean } }, 'Rating' | 'Choice'>
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

export const SurveyPlugin = createWidgetPlugin('Survey')
	.description('A survey: a header, the questions in order, and a footer note.\n\nThe root of a survey document. It counts the answered questions through the `questions` contract.')
	.interfaces<SurveyInterfaces>()
	.config({
		description: 'How the survey is titled and where it is sent.',
		raw: {
			description: 'The raw config of a survey.',
			fields: {
				title: { description: 'The survey\'s title.', ref: i18nTextDocs },
				maxQuestions: { description: 'The most questions the survey may hold: from 1 to 20; 10 when left out.' },
				submitUrl: { description: 'Where the answers are sent: a URI.' },
			},
		},
		resolved: {
			fields: {
				title: { description: 'The survey\'s title.', ref: i18nTextDocs },
				maxQuestions: { description: 'The most questions the survey may hold.' },
				submitUrl: { description: 'Where the answers are sent, or `null` when they are not sent anywhere.' },
			},
		},
		validate: (input, ctx): input is SurveyRawConfig => {
			if (!isObject(input) || !isI18nText(input.title)) {
				ctx.addDiagnostic({ message: 'The survey needs a title per language.', path: ['title'] })
				return false
			}
			if (Object.keys(input.title).length === 0) {
				ctx.addDiagnostic({ message: 'The title has no language.', path: ['title'], reason: 'empty-title' })
				return false
			}
			// What the field docs state, enforced here: the schema has the shape only.
			if (input.maxQuestions !== undefined && !isNumberFrom(input.maxQuestions, 1, 20))
				ctx.addDiagnostic({ message: 'maxQuestions must be a number from 1 to 20.', path: ['maxQuestions'] })
			if (input.submitUrl !== undefined && !isUri(input.submitUrl))
				ctx.addDiagnostic({ message: 'submitUrl must be a URI.', path: ['submitUrl'] })
			return !ctx.hasAnyDiagnostic()
		},
		resolve: raw => ({ title: raw?.title ?? {}, maxQuestions: raw?.maxQuestions ?? 10, submitUrl: raw?.submitUrl ?? null }),
	})
	.slots({
		header: { description: 'Anything shown above the questions.' },
		questions: {
			description: 'The questions, in order.\n\nEvery question exposes whether it was answered.',
			validateStructure: ({ children, config, addDiagnostic }) => {
				const max = config?.maxQuestions ?? 10
				if (children.length > max)
					addDiagnostic({ message: `At most ${max} questions.`, index: max, reason: 'too-many-questions', details: { max, count: children.length } })
			},
		},
		footer: { description: 'Closing notes shown under the questions.' },
	})
	.state(state => state.submitted({ description: 'Whether the survey was sent.', validate: (input): input is boolean => typeof input === 'boolean', default: () => false }))
	.properties(properties => properties.progress({
		description: 'The share of answered questions, from 0 to 1.',
		registerDeps: ({ slot }) => slot('questions')
			.map(question => question.properties.get('answered')),
		compute: ({ deps }) => deps.length === 0
			? 0
			: deps.filter((read) => {
				const answered = read()
				return answered.ok && answered.value
			}).length / deps.length,
	}))
	.methods(methods => methods.submit({
		description: 'Sends the survey.',
		returns: { description: 'Whether the survey was sent by this call.' },
		validateArgs: (args): args is [] => args.length === 0,
		registerDeps: ({ slot, dep }) => ({
			answered: slot('questions')
				.map(question => question.properties.get('answered')),
			submitted: dep.self.state.get('submitted'),
			setSubmitted: dep.self.state.set('submitted'),
		}),
		emits: ['submitted'],
		execute: ({ deps, emit }) => {
			const submitted = deps.submitted()
			if (submitted.ok && submitted.value === true)
				return false
			const answered = deps.answered.filter((read) => {
				const value = read()
				return value.ok && value.value
			}).length
			deps.setSubmitted(true)
			emit.submitted({ answered, total: deps.answered.length })
			return true
		},
	}))
	.events({ submitted: { description: 'The survey was sent.', payload: [{ description: 'How many questions were answered, of how many.', ref: submitSummaryDocs }] } })
	.reasons({
		'empty-title': { description: 'The title has no language.' },
		'too-many-questions': {
			description: 'The `questions` slot holds more questions than `maxQuestions` allows.',
			details: {
				fields: {
					max: { description: 'The configured maximum.' },
					count: { description: 'How many questions the slot holds.' },
				},
			},
		},
	})
	.done()

// -------------------------------------------------------------------------------------------------
// Rating
// -------------------------------------------------------------------------------------------------

export interface RatingInterfaces {
	config: {
		raw: {
			question: I18nText
			scale?: number
		}
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

export const RatingPlugin = createWidgetPlugin('Rating')
	.description('A rating question: pick a number on a scale.')
	.interfaces<RatingInterfaces>()
	.config({
		description: 'The question and its scale.',
		raw: {
			fields: {
				question: { description: 'The question asked.', ref: i18nTextDocs },
				scale: { description: 'The highest value of the scale, from 3 to 10; the lowest is 1. 5 when left out.' },
			},
		},
		resolved: {
			fields: {
				question: { description: 'The question asked.', ref: i18nTextDocs },
				scale: { description: 'The highest value of the scale; the lowest is 1.' },
			},
		},
		validate: (input, ctx): input is RatingInterfaces['config']['raw'] => {
			if (!isObject(input) || !isI18nText(input.question)) {
				ctx.addDiagnostic({ message: 'A rating needs a question per language.', path: ['question'] })
				return false
			}
			if (input.scale !== undefined && !isNumberFrom(input.scale, 3, 10)) {
				ctx.addDiagnostic({ message: 'scale must be a number from 3 to 10.', path: ['scale'] })
				return false
			}
			return true
		},
		resolve: raw => ({ question: raw?.question ?? {}, scale: raw?.scale ?? 5 }),
	})
	.state(state => state.value({
		description: 'The chosen value, or `null` while unanswered.\n\nAn editor may preset it.',
		validate: (input): input is number | null => input === null || typeof input === 'number',
		default: () => null,
		authorWritable: true,
	}))
	.properties(properties => properties.answered({
		description: 'Whether a value was chosen.',
		registerDeps: ({ dep }) => ({ value: dep.self.state.get('value') }),
		compute: ({ deps }) => {
			const value = deps.value()
			return value.ok && value.value !== null
		},
	}))
	.methods(methods => methods.rate({
		description: 'Chooses a value.',
		params: [{ description: 'The value, from 1 to the scale.' }],
		returns: { description: 'The chosen value.' },
		validateArgs: (args, ctx): args is [number] => {
			if (args.length !== 1 || typeof args[0] !== 'number') {
				ctx.addDiagnostic({ message: 'rate() takes one number.' })
				return false
			}
			return true
		},
		registerDeps: ({ dep }) => ({ setValue: dep.self.state.set('value') }),
		emits: ['rated'],
		execute: ({ args: [value], config, deps, emit, addDiagnostic }) => {
			if (value < 1 || value > config.scale) {
				addDiagnostic({ message: `The value must be between 1 and ${config.scale}.`, reason: 'out-of-range', details: { min: 1, max: config.scale, received: value } })
				return value
			}
			deps.setValue(value)
			emit.rated(value)
			return value
		},
	}))
	.events({ rated: { description: 'A value was chosen.', payload: [{ description: 'The chosen value.' }] } })
	.reasons({
		'out-of-range': {
			description: 'The value is outside the scale.',
			details: {
				fields: {
					min: { description: 'The lowest allowed value.' },
					max: { description: 'The highest allowed value.' },
					received: { description: 'The value given.' },
				},
			},
		},
	})
	.done()

// -------------------------------------------------------------------------------------------------
// Choice
// -------------------------------------------------------------------------------------------------

export interface ChoiceInterfaces {
	config: {
		raw: {
			question: I18nText
			options: ChoiceOption[]
			multiple?: boolean
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

export const ChoicePlugin = createWidgetPlugin('Choice')
	.description('A choice question: pick one or more options.')
	.interfaces<ChoiceInterfaces>()
	.config({
		description: 'The question and its options.',
		raw: {
			fields: {
				question: { description: 'The question asked.', ref: i18nTextDocs },
				options: { description: 'The options, in the order shown: at least two.', items: { ref: choiceOptionDocs } },
				multiple: { description: 'Whether more than one option may be chosen.' },
				followUp: { description: 'A question shown once this one is answered.' },
			},
		},
		resolved: {
			fields: {
				question: { description: 'The question asked.', ref: i18nTextDocs },
				options: { description: 'The options, in the order shown.', items: { ref: choiceOptionDocs } },
				multiple: { description: 'Whether more than one option may be chosen.' },
				followUp: { description: 'The id of the question shown once this one is answered, or `null` for none.' },
			},
		},
		validate: (input, ctx): input is ChoiceInterfaces['config']['raw'] => {
			if (!isObject(input) || !isI18nText(input.question) || !Array.isArray(input.options)) {
				ctx.addDiagnostic({ message: 'A choice needs a question and a list of options.' })
				return false
			}
			if (input.options.length < 2)
				ctx.addDiagnostic({ message: 'A choice needs at least two options.', path: ['options'] })
			const ids = new Set<unknown>()
			input.options.forEach((option: unknown, index: number) => {
				const id = isObject(option) ? option.id : undefined
				if (typeof id !== 'string' || !OPTION_ID.test(id))
					ctx.addDiagnostic({ message: 'An option id is a lowercase letter, then lowercase letters, digits or hyphens.', path: ['options', index, 'id'] })
				else if (ids.has(id))
					ctx.addDiagnostic({ message: `The option id "${id}" is used twice.`, path: ['options', index, 'id'] })
				ids.add(id)
				if (!isObject(option) || !isI18nText(option.label))
					ctx.addDiagnostic({ message: 'An option needs a label per language.', path: ['options', index, 'label'] })
			})
			return !ctx.hasAnyDiagnostic()
		},
		resolve: raw => ({ question: raw?.question ?? {}, options: raw?.options ?? [], multiple: raw?.multiple ?? false, followUp: raw?.followUp ?? null }),
	})
	.state(state => state.selected({
		description: 'The ids of the chosen options.',
		validate: (input): input is readonly string[] => Array.isArray(input) && input.every(item => typeof item === 'string'),
		default: () => [],
	}))
	.properties(properties => properties.answered({
		description: 'Whether at least one option was chosen.',
		registerDeps: ({ dep }) => ({ selected: dep.self.state.get('selected') }),
		compute: ({ deps }) => {
			const selected = deps.selected()
			return selected.ok && (selected.value?.length ?? 0) > 0
		},
	}))
	.methods(methods => methods.select({
		description: 'Chooses an option, replacing the choice unless the question takes several.',
		params: [{ description: 'The id of the option.' }],
		returns: { description: 'The ids now chosen.' },
		validateArgs: (args): args is [string] => args.length === 1 && typeof args[0] === 'string',
		registerDeps: ({ dep }) => ({ selected: dep.self.state.get('selected'), setSelected: dep.self.state.set('selected') }),
		emits: ['changed'],
		execute: ({ args: [id], config, deps, emit, addDiagnostic }) => {
			const current = deps.selected()
			const before = current.ok ? current.value ?? [] : []
			if (!config.options.some(option => option.id === id)) {
				addDiagnostic({ message: `No option "${id}".`, reason: 'unknown-option', details: { id } })
				return before
			}
			const next = config.multiple ? [...before.filter(item => item !== id), id] : [id]
			deps.setSelected(next)
			emit.changed(next)
			return next
		},
	}))
	.events({ changed: { description: 'The choice changed.', payload: [{ description: 'The ids now chosen.' }] } })
	.reasons({ 'unknown-option': { description: 'The id names no option of the question.', details: { fields: { id: { description: 'The id given.' } } } } })
	.done()

// -------------------------------------------------------------------------------------------------
// Note
// -------------------------------------------------------------------------------------------------

export interface NoteInterfaces {
	config: {
		raw: {
			text: I18nText
		} | null
		resolved: { text: I18nText }
	}
}

export const NotePlugin = createWidgetPlugin('Note')
	.description('A short text.')
	.interfaces<NoteInterfaces>()
	.config({
		description: 'The text of the note.\n\nLeave the config out for an empty note.',
		raw: { fields: { text: { description: 'The text shown.', ref: i18nTextDocs } } },
		resolved: { fields: { text: { description: 'The text shown; empty when the config was left out.', ref: i18nTextDocs } } },
		validate: (input): input is NoteInterfaces['config']['raw'] => input === null || (isObject(input) && isI18nText(input.text)),
		resolve: raw => ({ text: raw?.text ?? {} }),
	})
	.done()

export const surveySystem = createWidgetSystem({ plugins: [SurveyPlugin, RatingPlugin, ChoicePlugin, NotePlugin] as const })
