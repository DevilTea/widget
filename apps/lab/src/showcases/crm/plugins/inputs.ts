/**
 * `TextInput` and `SelectInput` (checkpoint §2 "Reusable-style primitives"): `config + state +
 * properties + methods`, generic prompt/input primitives with primitive State validation only. Neither
 * plugin knows about deals/stages/CRM search semantics — in this showcase `TextInput` is the generic
 * search box and `SelectInput` is reused twice (`stage-filter`: `'all'` + every `DealStage`;
 * `stage-editor`: `DealStage` values only), driven entirely by each instance's own configured
 * `options` (checkpoint §2 "The same plugin is used for" / §6).
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { isPlainObject } from '../domain'

// -------------------------------------------------------------------------------------------------
// TextInput
// -------------------------------------------------------------------------------------------------

export interface TextInputRawConfig {
	readonly label: string
	readonly placeholder?: string
	readonly default?: string
	readonly maxLength?: number
}

export interface TextInputResolvedConfig {
	readonly label: string
	readonly placeholder: string | null
	readonly default: string
	readonly maxLength?: number
}

export interface TextInputInterfaces extends WidgetInterfaces {
	config: {
		raw: TextInputRawConfig
		resolved: TextInputResolvedConfig
	}
	state: {
		value: string
	}
	properties: {
		label: string
		placeholder: string | null
		maxLength: number | null
	}
	methods: {
		clear: () => void
		reset: () => void
	}
}

export const TextInputPlugin = createWidgetPlugin('TextInput')
	.description('Text input widget')
	.interfaces<TextInputInterfaces>()
	.config({
		description: 'Text input configuration',
		validate: (input): input is TextInputRawConfig =>
			isPlainObject(input)
			&& typeof input.label === 'string'
			&& (input.placeholder === undefined || typeof input.placeholder === 'string')
			&& (input.default === undefined || typeof input.default === 'string')
			&& (input.maxLength === undefined || typeof input.maxLength === 'number'),
		resolve: raw => ({
			label: raw?.label ?? '',
			placeholder: raw?.placeholder ?? null,
			default: raw?.default ?? '',
			maxLength: raw?.maxLength,
		}),
	})
	.state(state =>
		state.value({
			// Primitive State validation only: a string within the configured `maxLength` (when set).
			// The value's own semantic meaning (a CRM search query) lives entirely in `DealQuery`.
			validate: (input, ctx): input is string => {
				if (typeof input !== 'string')
					return false
				if (ctx.config.maxLength !== undefined && input.length > ctx.config.maxLength)
					return false
				return true
			},
			default: ({ config }) => config.default,
		}))
	.properties(properties =>
		properties
			.label({ compute: ({ config }) => config.label })
			.placeholder({ compute: ({ config }) => config.placeholder })
			.maxLength({ compute: ({ config }) => config.maxLength ?? null }))
	.methods(methods =>
		methods
			.clear({
				registerDeps: ({ dep }) => dep.self.state.set('value'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps }) => {
					deps('')
				},
			})
			.reset({
				registerDeps: ({ dep }) => dep.self.state.set('value'),
				validateArgs: (args): args is [] => args.length === 0,
				execute: ({ deps, config }) => {
					deps(config.default)
				},
			}))
	.done()

// -------------------------------------------------------------------------------------------------
// SelectInput
// -------------------------------------------------------------------------------------------------

export interface SelectOption {
	readonly value: string
	readonly label: string
}

export interface SelectInputConfig {
	readonly label: string
	readonly options: readonly SelectOption[]
	readonly default: string
}

export interface SelectInputInterfaces extends WidgetInterfaces {
	config: {
		raw: SelectInputConfig
		resolved: SelectInputConfig
	}
	state: {
		value: string
	}
	properties: {
		label: string
		options: readonly SelectOption[]
	}
	methods: {
		reset: () => void
	}
}

function isSelectOption(value: unknown): value is SelectOption {
	return isPlainObject(value) && typeof value.value === 'string' && typeof value.label === 'string'
}

function isSelectInputConfig(input: unknown): input is SelectInputConfig {
	return isPlainObject(input)
		&& typeof input.label === 'string'
		&& Array.isArray(input.options) && input.options.every(isSelectOption)
		&& typeof input.default === 'string'
}

export const SelectInputPlugin = createWidgetPlugin('SelectInput')
	.description('Select input widget')
	.interfaces<SelectInputInterfaces>()
	.config({
		description: 'Select input configuration',
		validate: (input): input is SelectInputConfig => isSelectInputConfig(input),
		resolve: raw => ({
			label: raw?.label ?? '',
			options: raw?.options ?? [],
			default: raw?.default ?? '',
		}),
	})
	.state(state =>
		state.value({
			// Primitive State validation requires the value to exist in configured options (checkpoint
			// §2) — this is what makes the *same* plugin usable both as `stage-filter` (`'all'` + every
			// `DealStage`) and `stage-editor` (`DealStage` values only): each instance's own `options`
			// defines its own legal value domain.
			validate: (input, ctx): input is string => typeof input === 'string' && ctx.config.options.some(option => option.value === input),
			default: ({ config }) => config.default,
		}))
	.properties(properties =>
		properties
			.label({ compute: ({ config }) => config.label })
			.options({ compute: ({ config }) => config.options }))
	.methods(methods =>
		methods.reset({
			registerDeps: ({ dep }) => dep.self.state.set('value'),
			validateArgs: (args): args is [] => args.length === 0,
			execute: ({ deps, config }) => {
				deps(config.default)
			},
		}))
	.done()
