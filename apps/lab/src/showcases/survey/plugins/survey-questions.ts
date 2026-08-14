/**
 * The three leaf question plugins (checkpoint §2): `SurveyDateQuestion`, `SurveyNumberQuestion`,
 * `SurveyChoiceQuestion`. Each is `config + state + properties + methods`, with primitive State
 * validation only — cross-field/contextual validation (date ordering, conditional requiredness) lives
 * in `TripMetrics`/`TripReadiness`, never here. Every plugin is built exclusively through
 * `@deviltea/widget-core`'s public `createWidgetPlugin` contract.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject, isValidCalendarDateString } from '../domain'

// -------------------------------------------------------------------------------------------------
// SurveyDateQuestion
// -------------------------------------------------------------------------------------------------

export interface SurveyDateQuestionRawConfig {
	readonly label: string
	readonly help?: string
	readonly default?: string | null
}

export interface SurveyDateQuestionResolvedConfig {
	readonly label: string
	readonly help: string | null
	readonly default: string | null
}

export interface SurveyDateQuestionInterfaces extends WidgetInterfaces {
	config: {
		raw: SurveyDateQuestionRawConfig
		resolved: SurveyDateQuestionResolvedConfig
	}
	state: {
		answer: string | null
	}
	properties: {
		label: string
		help: string | null
	}
	methods: {
		reset: () => void
	}
}

export const SurveyDateQuestionPlugin = createWidgetPlugin('SurveyDateQuestion')
	.interfaces<SurveyDateQuestionInterfaces>()
	.config({
		validate: (input): input is SurveyDateQuestionRawConfig =>
			isPlainObject(input)
			&& typeof input.label === 'string'
			&& (input.help === undefined || typeof input.help === 'string')
			&& (input.default === undefined || input.default === null || typeof input.default === 'string'),
		resolve: raw => ({
			label: raw?.label ?? '',
			help: raw?.help ?? null,
			default: raw?.default ?? null,
		}),
	})
	.state(state =>
		state.answer({
			// Primitive State validation only: `null` or a strict calendar-valid `YYYY-MM-DD` string.
			// Cross-field departure/return ordering is not a State-level concern (checkpoint §2).
			validate: (input): input is string | null => input === null || (typeof input === 'string' && isValidCalendarDateString(input)),
			default: ({ config }) => config.default,
		}))
	.properties(properties =>
		properties
			.label({ compute: ({ config }) => config.label })
			.help({ compute: ({ config }) => config.help }))
	.methods(methods =>
		methods.reset({
			registerDeps: ({ dep }) => dep.self.state.set('answer'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps, config }) => {
				deps(config.default)
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// SurveyNumberQuestion
// -------------------------------------------------------------------------------------------------

export interface SurveyNumberQuestionRawConfig {
	readonly label: string
	readonly help?: string
	readonly min?: number
	readonly max?: number
	readonly integer?: boolean
	readonly default?: number | null
}

export interface SurveyNumberQuestionResolvedConfig {
	readonly label: string
	readonly help: string | null
	readonly min?: number
	readonly max?: number
	readonly integer: boolean
	readonly default: number | null
}

export interface SurveyNumberQuestionInterfaces extends WidgetInterfaces {
	config: {
		raw: SurveyNumberQuestionRawConfig
		resolved: SurveyNumberQuestionResolvedConfig
	}
	state: {
		answer: number | null
	}
	properties: {
		label: string
		help: string | null
		min: number | null
		max: number | null
		integer: boolean
	}
	methods: {
		reset: () => void
	}
}

export const SurveyNumberQuestionPlugin = createWidgetPlugin('SurveyNumberQuestion')
	.interfaces<SurveyNumberQuestionInterfaces>()
	.config({
		validate: (input): input is SurveyNumberQuestionRawConfig =>
			isPlainObject(input)
			&& typeof input.label === 'string'
			&& (input.help === undefined || typeof input.help === 'string')
			&& (input.min === undefined || typeof input.min === 'number')
			&& (input.max === undefined || typeof input.max === 'number')
			&& (input.integer === undefined || typeof input.integer === 'boolean')
			&& (input.default === undefined || input.default === null || typeof input.default === 'number'),
		resolve: raw => ({
			label: raw?.label ?? '',
			help: raw?.help ?? null,
			min: raw?.min,
			max: raw?.max,
			integer: raw?.integer ?? false,
			default: raw?.default ?? null,
		}),
	})
	.state(state =>
		state.answer({
			// `answer.validate` uses resolved config (min/max/integer). Invalid writes produce an
			// ordinary `state-validation` Runtime Issue and preserve the previous authoritative value —
			// `RuntimeState.attemptSet` never commits a rejected candidate (checkpoint §2/§4).
			validate: (input, ctx): input is number | null => {
				if (input === null)
					return true
				if (typeof input !== 'number' || !Number.isFinite(input))
					return false
				if (ctx.config.min !== undefined && input < ctx.config.min)
					return false
				if (ctx.config.max !== undefined && input > ctx.config.max)
					return false
				if (ctx.config.integer && !Number.isInteger(input))
					return false
				return true
			},
			default: ({ config }) => config.default,
		}))
	.properties(properties =>
		properties
			.label({ compute: ({ config }) => config.label })
			.help({ compute: ({ config }) => config.help })
			.min({ compute: ({ config }) => config.min ?? null })
			.max({ compute: ({ config }) => config.max ?? null })
			.integer({ compute: ({ config }) => config.integer }))
	.methods(methods =>
		methods.reset({
			registerDeps: ({ dep }) => dep.self.state.set('answer'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps, config }) => {
				deps(config.default)
			},
		}))
	.done()

// -------------------------------------------------------------------------------------------------
// SurveyChoiceQuestion
// -------------------------------------------------------------------------------------------------

export interface SurveyChoiceOption {
	readonly value: string
	readonly label: string
}

export interface SurveyChoiceQuestionRawConfig {
	readonly label: string
	readonly help?: string
	readonly options: readonly SurveyChoiceOption[]
	readonly default?: string | null
}

export interface SurveyChoiceQuestionResolvedConfig {
	readonly label: string
	readonly help: string | null
	readonly options: readonly SurveyChoiceOption[]
	readonly default: string | null
}

export interface SurveyChoiceQuestionInterfaces extends WidgetInterfaces {
	config: {
		raw: SurveyChoiceQuestionRawConfig
		resolved: SurveyChoiceQuestionResolvedConfig
	}
	state: {
		answer: string | null
	}
	properties: {
		label: string
		help: string | null
		options: readonly SurveyChoiceOption[]
	}
	methods: {
		reset: () => void
	}
}

function isSurveyChoiceOption(value: unknown): value is SurveyChoiceOption {
	return isPlainObject(value) && typeof value.value === 'string' && typeof value.label === 'string'
}

export const SurveyChoiceQuestionPlugin = createWidgetPlugin('SurveyChoiceQuestion')
	.interfaces<SurveyChoiceQuestionInterfaces>()
	.config({
		validate: (input): input is SurveyChoiceQuestionRawConfig =>
			isPlainObject(input)
			&& typeof input.label === 'string'
			&& (input.help === undefined || typeof input.help === 'string')
			&& Array.isArray(input.options) && input.options.every(isSurveyChoiceOption)
			&& (input.default === undefined || input.default === null || typeof input.default === 'string'),
		resolve: raw => ({
			label: raw?.label ?? '',
			help: raw?.help ?? null,
			options: raw?.options ?? [],
			default: raw?.default ?? null,
		}),
	})
	.state(state =>
		state.answer({
			// Primitive State validation accepts `null` or a string present in configured options.
			// Trip-specific consumers (TripMetrics/TripReadiness/TripRecommendation) narrow this generic
			// string to `Destination`/`TravelStyle`/`FamilyPriority` via dependency `.validate()`
			// refinements — never here (checkpoint §2).
			validate: (input, ctx): input is string | null => {
				if (input === null)
					return true
				if (typeof input !== 'string')
					return false
				return ctx.config.options.some(option => option.value === input)
			},
			default: ({ config }) => config.default,
		}))
	.properties(properties =>
		properties
			.label({ compute: ({ config }) => config.label })
			.help({ compute: ({ config }) => config.help })
			.options({ compute: ({ config }) => config.options }))
	.methods(methods =>
		methods.reset({
			registerDeps: ({ dep }) => dep.self.state.set('answer'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps, config }) => {
				deps(config.default)
			},
		}))
	.done()
