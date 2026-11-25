/**
 * Test fixture for the shapes and docs the survey fixture does not reach: arrays and dictionaries of primitives, a named
 * type behind an optional property and inside a written union, a recursive named type documented with a `ref` thunk,
 * aliases of an array and of a nullable number, a literal enum of numbers, an unnamed recursive type from a dependency
 * (Core's `JsonValue`), a list of widget references, and one named type used as both the raw and the resolved config
 * with the same docs. The constraints are prose in the descriptions: the schemas carry the shape only.
 */

import type { JsonValue, TypeDocs, WidgetRef } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem, defineFieldDocs, defineTypeDocs } from '@deviltea/widget-core'

export type Rule = { field: string } | { all: readonly Rule[] }

export const ruleDocs: TypeDocs<Rule> = defineTypeDocs<Rule>('Rule', {
	description: 'A condition on another field, or a combination of conditions.',
	fields: {
		field: { description: 'The field that must be filled in.' },
		all: { description: 'Conditions that must all hold.', items: { ref: () => ruleDocs } },
	},
})

export type Names = readonly string[]

export type MaybeCount = number | null

export interface Person {
	readonly name: string
}

export interface FormRawConfig {
	fields: readonly string[]
	weights: Readonly<Record<string, number>>
	pageSize?: number
	visibleWhen?: Rule
	required?: boolean | Rule
	extra?: JsonValue
	retries: number | null
	extraFields: readonly string[] | null
	hidden: Names
	step: 1 | 100 | 500
	people: readonly Person[]
	limit: MaybeCount
	title: string
	reviewers: readonly WidgetRef<'Form'>[]
}

/** The docs of the raw config, also used for the resolved one (the same type, documented the same way). */
const formConfigDocs = defineFieldDocs<FormRawConfig>()({
	description: 'The raw config of a Form.',
	fields: {
		fields: { description: 'The field names, each once: at least one, each matching `^[a-z]+$`.', items: { description: 'A field name.' } },
		weights: { description: 'Weight per field name: from 1 to 8 entries, keys matching `^[a-z]+$`, each weight above 0.' },
		pageSize: { description: 'How many fields are shown per page: a whole number, at least 1.' },
		visibleWhen: { description: 'Show the form only while this holds.', ref: ruleDocs },
		required: { description: 'Whether the form must be filled in: always, never, or while a rule holds.', ref: ruleDocs },
		extra: { description: 'Anything the host stores with the form.' },
		retries: { description: 'Retries, a whole number of at least 0, or `null` for the default.' },
		extraFields: { description: 'Extra field names, each once and matching `^[a-z]+$`, or `null` for none.' },
		hidden: { description: 'Hidden field names: at least one, each matching `^[a-z]+$`.' },
		step: { description: 'The step.' },
		people: { description: 'The people.', items: { fields: { name: { description: 'The name.' } } } },
		limit: { description: 'The limit, or `null` for none.' },
		title: { description: 'The title.' },
		reviewers: { description: 'The Forms that review this one.' },
	},
})

const NAME = /^[a-z]+$/

/** A list of names matching `^[a-z]+$`, at least `min` long, each once unless `unique` is false. */
function isNameList(input: unknown, min: number, unique = true): boolean {
	return Array.isArray(input) && input.length >= min && input.every(item => typeof item === 'string' && NAME.test(item))
		&& (!unique || new Set(input).size === input.length)
}

function isWeights(weights: Record<string, unknown>): boolean {
	const entries = Object.entries(weights)
	return entries.length >= 1 && entries.length <= 8 && entries.every(([key, value]) => NAME.test(key) && typeof value === 'number' && value > 0)
}

export interface FormInterfaces {
	config: {
		raw: FormRawConfig
		resolved: FormRawConfig
	}
}

export const FormPlugin = createWidgetPlugin('Form')
	.description('A form.')
	.interfaces<FormInterfaces>()
	.config({
		description: 'The fields of the form and how they are shown.',
		raw: formConfigDocs,
		resolved: formConfigDocs,
		validate: (input, ctx): input is FormRawConfig => {
			if (typeof input !== 'object' || input === null || Array.isArray(input)) {
				ctx.addDiagnostic({ message: 'The config must be an object.' })
				return false
			}
			// What the field docs state, enforced here: the schema has the shape only.
			const config = input as Record<string, unknown>
			if (!isNameList(config.fields, 1))
				ctx.addDiagnostic({ message: 'fields: at least one name, each once, each matching ^[a-z]+$.', path: ['fields'] })
			const weights = config.weights
			if (typeof weights !== 'object' || weights === null || Array.isArray(weights) || !isWeights(weights as Record<string, unknown>))
				ctx.addDiagnostic({ message: 'weights: from 1 to 8 entries, keys matching ^[a-z]+$, each weight above 0.', path: ['weights'] })
			if (config.pageSize !== undefined && !(Number.isInteger(config.pageSize) && (config.pageSize as number) >= 1))
				ctx.addDiagnostic({ message: 'pageSize: a whole number, at least 1.', path: ['pageSize'] })
			if (config.retries !== null && !(Number.isInteger(config.retries) && (config.retries as number) >= 0))
				ctx.addDiagnostic({ message: 'retries: a whole number of at least 0, or null.', path: ['retries'] })
			if (config.extraFields !== null && !isNameList(config.extraFields, 0))
				ctx.addDiagnostic({ message: 'extraFields: names, each once, each matching ^[a-z]+$, or null.', path: ['extraFields'] })
			if (!isNameList(config.hidden, 1, false))
				ctx.addDiagnostic({ message: 'hidden: at least one name, each matching ^[a-z]+$.', path: ['hidden'] })
			return !ctx.hasAnyDiagnostic()
		},
		resolve: raw => raw ?? { fields: [], weights: {}, retries: null, extraFields: null, hidden: [], step: 1, people: [], limit: null, title: '', reviewers: [] },
	})
	.done()

export const shapesSystem = createWidgetSystem({ plugins: [FormPlugin] })
