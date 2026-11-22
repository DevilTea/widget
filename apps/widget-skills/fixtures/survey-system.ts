/**
 * The 0.3 fixture System of the generator. It is small and fully documented, and it exercises every feature the
 * generator reads:
 *
 * - config `raw` with JSDoc constraint tags, a named dictionary type, an omittable config (`Note`) and a
 *   `@widgetRef`;
 * - record slots in all three forms: a plain union of plugin types (`Survey.footer`), a
 *   `WidgetContract<Shape, Types>` (`Survey.questions`) and `WidgetChild` (`Survey.header`);
 * - `reasons` with a `void` reason and reasons with payloads;
 * - State (with `authorWritable`), Properties, Methods with parameters and Events with labelled payloads.
 */

import type { WidgetChild, WidgetContract } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

/**
 * Text per language, keyed by language tag (`en`, `zh-TW`).
 * @remarks At least one language should be present; the renderer falls back to the first one.
 */
export type I18nText = Record<string, string>

/** One option of a choice question. */
export interface ChoiceOption {
	/**
	 * The option's identifier, unique within the question.
	 * @pattern ^[a-z][a-z0-9-]*$
	 */
	id: string
	/** The label shown for the option. */
	label: I18nText
}

/** What `Survey.submit()` reports when the survey is sent. */
export interface SubmitSummary {
	/** How many questions were answered. */
	answered: number
	/** How many questions the survey has. */
	total: number
}

const isObject = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input)
function isI18nText(input: unknown): input is I18nText {
	return isObject(input) && Object.values(input)
		.every(value => typeof value === 'string')
}

// -------------------------------------------------------------------------------------------------
// Survey (root)
// -------------------------------------------------------------------------------------------------

/** The raw config of a survey. */
export interface SurveyRawConfig {
	/** The survey's title. */
	title: I18nText
	/**
	 * The most questions the survey may hold.
	 * @minimum 1
	 * @maximum 20
	 * @default 10
	 */
	maxQuestions?: number
	/**
	 * Where the answers are sent.
	 * @format uri
	 */
	submitUrl?: string
}

/**
 * A survey: a header, the questions in order, and a footer note.
 * @remarks The root of a survey document. It counts the answered questions through the `questions` contract.
 */
export interface SurveyInterfaces {
	/** How the survey is titled and where it is sent. */
	config: {
		raw: SurveyRawConfig
		resolved: { title: I18nText, maxQuestions: number, submitUrl: string | null }
	}
	slots: {
		/** Anything shown above the questions. */
		header: WidgetChild
		/**
		 * The questions, in order.
		 * @remarks Every question exposes whether it was answered.
		 */
		questions: WidgetContract<{ properties: { answered: boolean } }, 'Rating' | 'Choice'>
		/** Closing notes shown under the questions. */
		footer: 'Note'
	}
	state: {
		/** Whether the survey was sent. */
		submitted: boolean
	}
	properties: {
		/**
		 * The share of answered questions, from 0 to 1.
		 * @minimum 0
		 * @maximum 1
		 */
		progress: number
	}
	methods: {
		/**
		 * Sends the survey.
		 * @returns Whether the survey was sent by this call.
		 */
		submit: () => boolean
	}
	events: {
		/** The survey was sent. */
		submitted: [summary: SubmitSummary]
	}
	reasons: {
		/** The title has no language. */
		'empty-title': void
		/** The `questions` slot holds more questions than `maxQuestions` allows. */
		'too-many-questions': {
			/** The configured maximum. */
			max: number
			/** How many questions the slot holds. */
			count: number
		}
	}
}

export const SurveyPlugin = createWidgetPlugin('Survey')
	.interfaces<SurveyInterfaces>()
	.config({
		validate: (input, ctx): input is SurveyRawConfig => {
			if (!isObject(input) || !isI18nText(input.title)) {
				ctx.addDiagnostic({ message: 'The survey needs a title per language.', path: ['title'] })
				return false
			}
			if (Object.keys(input.title).length === 0) {
				ctx.addDiagnostic({ message: 'The title has no language.', path: ['title'], reason: 'empty-title' })
				return false
			}
			return true
		},
		resolve: raw => ({ title: raw?.title ?? {}, maxQuestions: raw?.maxQuestions ?? 10, submitUrl: raw?.submitUrl ?? null }),
	})
	.slots({
		header: {},
		questions: {
			validateStructure: ({ children, config, addDiagnostic }) => {
				const max = config?.maxQuestions ?? 10
				if (children.length > max)
					addDiagnostic({ message: `At most ${max} questions.`, index: max, reason: 'too-many-questions', details: { max, count: children.length } })
			},
		},
		footer: {},
	})
	.state(state => state.submitted({ validate: (input): input is boolean => typeof input === 'boolean', default: () => false }))
	.properties(properties => properties.progress({
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
	.events(['submitted'])
	.done()

// -------------------------------------------------------------------------------------------------
// Rating
// -------------------------------------------------------------------------------------------------

/** A rating question: pick a number on a scale. */
export interface RatingInterfaces {
	/** The question and its scale. */
	config: {
		raw: {
			/** The question asked. */
			question: I18nText
			/**
			 * The highest value of the scale; the lowest is 1.
			 * @minimum 3
			 * @maximum 10
			 * @default 5
			 */
			scale?: number
		}
		resolved: { question: I18nText, scale: number }
	}
	state: {
		/**
		 * The chosen value, or `null` while unanswered.
		 * @remarks An editor may preset it.
		 */
		value: number | null
	}
	properties: {
		/** Whether a value was chosen. */
		answered: boolean
	}
	methods: {
		/**
		 * Chooses a value.
		 * @param value - The value, from 1 to the scale.
		 * @returns The chosen value.
		 */
		rate: (value: number) => number
	}
	events: {
		/** A value was chosen. */
		rated: [value: number]
	}
	reasons: {
		/** The value is outside the scale. */
		'out-of-range': {
			/** The lowest allowed value. */
			min: number
			/** The highest allowed value. */
			max: number
			/** The value given. */
			received: number
		}
	}
}

export const RatingPlugin = createWidgetPlugin('Rating')
	.interfaces<RatingInterfaces>()
	.config({
		validate: (input, ctx): input is RatingInterfaces['config']['raw'] => {
			if (!isObject(input) || !isI18nText(input.question)) {
				ctx.addDiagnostic({ message: 'A rating needs a question per language.', path: ['question'] })
				return false
			}
			return true
		},
		resolve: raw => ({ question: raw?.question ?? {}, scale: raw?.scale ?? 5 }),
	})
	.state(state => state.value({
		validate: (input): input is number | null => input === null || typeof input === 'number',
		default: () => null,
		authorWritable: true,
	}))
	.properties(properties => properties.answered({
		registerDeps: ({ dep }) => ({ value: dep.self.state.get('value') }),
		compute: ({ deps }) => {
			const value = deps.value()
			return value.ok && value.value !== null
		},
	}))
	.methods(methods => methods.rate({
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
	.events(['rated'])
	.done()

// -------------------------------------------------------------------------------------------------
// Choice
// -------------------------------------------------------------------------------------------------

/** A choice question: pick one or more options. */
export interface ChoiceInterfaces {
	/** The question and its options. */
	config: {
		raw: {
			/** The question asked. */
			question: I18nText
			/**
			 * The options, in the order shown.
			 * @minItems 2
			 */
			options: ChoiceOption[]
			/** Whether more than one option may be chosen. */
			multiple?: boolean
			/**
			 * A question shown once this one is answered.
			 * @widgetRef Rating | Choice
			 */
			followUp?: string
		}
		resolved: { question: I18nText, options: readonly ChoiceOption[], multiple: boolean, followUp: string | null }
	}
	state: {
		/** The ids of the chosen options. */
		selected: readonly string[]
	}
	properties: {
		/** Whether at least one option was chosen. */
		answered: boolean
	}
	methods: {
		/**
		 * Chooses an option, replacing the choice unless the question takes several.
		 * @param id - The id of the option.
		 * @returns The ids now chosen.
		 */
		select: (id: string) => readonly string[]
	}
	events: {
		/** The choice changed. */
		changed: [selected: readonly string[]]
	}
	reasons: {
		/** The id names no option of the question. */
		'unknown-option': {
			/** The id given. */
			id: string
		}
	}
}

export const ChoicePlugin = createWidgetPlugin('Choice')
	.interfaces<ChoiceInterfaces>()
	.config({
		validate: (input, ctx): input is ChoiceInterfaces['config']['raw'] => {
			if (!isObject(input) || !isI18nText(input.question) || !Array.isArray(input.options)) {
				ctx.addDiagnostic({ message: 'A choice needs a question and a list of options.' })
				return false
			}
			return true
		},
		resolve: raw => ({ question: raw?.question ?? {}, options: raw?.options ?? [], multiple: raw?.multiple ?? false, followUp: raw?.followUp ?? null }),
	})
	.state(state => state.selected({
		validate: (input): input is readonly string[] => Array.isArray(input) && input.every(item => typeof item === 'string'),
		default: () => [],
	}))
	.properties(properties => properties.answered({
		registerDeps: ({ dep }) => ({ selected: dep.self.state.get('selected') }),
		compute: ({ deps }) => {
			const selected = deps.selected()
			return selected.ok && (selected.value?.length ?? 0) > 0
		},
	}))
	.methods(methods => methods.select({
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
	.events(['changed'])
	.done()

// -------------------------------------------------------------------------------------------------
// Note
// -------------------------------------------------------------------------------------------------

/** A short text. */
export interface NoteInterfaces {
	/**
	 * The text of the note.
	 * @remarks Leave the config out for an empty note.
	 */
	config: {
		raw: {
			/** The text shown. */
			text: I18nText
		} | null
		resolved: { text: I18nText }
	}
}

export const NotePlugin = createWidgetPlugin('Note')
	.interfaces<NoteInterfaces>()
	.config({
		validate: (input): input is NoteInterfaces['config']['raw'] => input === null || (isObject(input) && isI18nText(input.text)),
		resolve: raw => ({ text: raw?.text ?? {} }),
	})
	.done()

export const surveySystem = createWidgetSystem({ plugins: [SurveyPlugin, RatingPlugin, ChoicePlugin, NotePlugin] as const })
