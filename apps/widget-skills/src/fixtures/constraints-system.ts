/**
 * Test fixture for the schema keywords and type names the survey fixture does not reach: the array and dictionary
 * constraint tags (`@uniqueItems`, `@minProperties`, `@maxProperties`, `@propertyNames`, `@integer`), a string or number
 * tag on an array or a dictionary (it applies to each item or value), a named type behind an optional property and inside
 * a written union, and an unnamed recursive type from a dependency (Core's `JsonValue`). Then the places a tag reaches
 * through a union with `null` and through a named type, and the tags that land nowhere (`--check`: `misplaced-tag`).
 */

import type { JsonValue } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem, undocumented } from '@deviltea/widget-core'

/** A condition on another field, or a combination of conditions. */
export type Rule = { field: string } | { all: readonly Rule[] }

/** Field names. */
export type Names = readonly string[]

/** A count, or `null` for none. */
export type MaybeCount = number | null

/** A person. */
export interface Person {
	/** The name. */
	readonly name: string
}

/** The raw config of a Form. */
export interface FormRawConfig {
	/**
	 * The field names, each once.
	 * @minItems 1
	 * @uniqueItems
	 * @pattern ^[a-z]+$
	 */
	fields: readonly string[]
	/**
	 * Weight per field name.
	 * @propertyNames ^[a-z]+$
	 * @minProperties 1
	 * @maxProperties 8
	 * @exclusiveMinimum 0
	 */
	weights: Readonly<Record<string, number>>
	/**
	 * How many fields are shown per page.
	 * @integer
	 * @minimum 1
	 */
	pageSize?: number
	/** Show the form only while this holds. */
	visibleWhen?: Rule
	/** Whether the form must be filled in: always, never, or while a rule holds. */
	required?: boolean | Rule
	/** Anything the host stores with the form. */
	extra?: JsonValue
	/**
	 * Retries, or `null` for the default.
	 * @integer
	 * @minimum 0
	 */
	retries: number | null
	/**
	 * Extra field names, or `null` for none.
	 * @uniqueItems
	 * @pattern ^[a-z]+$
	 */
	extraFields: readonly string[] | null
	/**
	 * Hidden field names.
	 * @minItems 1
	 * @pattern ^[a-z]+$
	 */
	hidden: Names
	/**
	 * The step.
	 * @integer
	 */
	step: 1 | 100 | 500
	/**
	 * The people (a pattern on a list of objects lands nowhere).
	 * @pattern ^x$
	 */
	people: readonly Person[]
	/**
	 * The limit (`@integer` beside a reference to a type with `null` lands nowhere).
	 * @integer
	 */
	limit: MaybeCount
	/**
	 * The title (`@uniqueItems` on a string lands nowhere).
	 * @uniqueItems
	 */
	title: string
}

/** A form. */
export interface FormInterfaces {
	/** The fields of the form and how they are shown. */
	config: {
		raw: FormRawConfig
		resolved: FormRawConfig
	}
}

export const FormPlugin = createWidgetPlugin('Form')
	.description(undocumented)
	.interfaces<FormInterfaces>()
	.config({
		description: undocumented,
		validate: (input): input is FormRawConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw ?? { fields: [], weights: {}, retries: null, extraFields: null, hidden: [], step: 1, people: [], limit: null, title: '' },
	})
	.done()

export const constraintsSystem = createWidgetSystem({ plugins: [FormPlugin] })
