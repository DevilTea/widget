/**
 * Test fixture for the schema keywords and type names the survey fixture does not reach: the array and dictionary
 * constraint tags (`@uniqueItems`, `@minProperties`, `@maxProperties`, `@propertyNames`, `@integer`), a string or number
 * tag on an array or a dictionary (it applies to each item or value), a named type behind an optional property and inside
 * a written union, and an unnamed recursive type from a dependency (Core's `JsonValue`).
 */

import type { JsonValue } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'

/** A condition on another field, or a combination of conditions. */
export type Rule = { field: string } | { all: readonly Rule[] }

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
	.interfaces<FormInterfaces>()
	.config({
		validate: (input): input is FormRawConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw ?? { fields: [], weights: {} },
	})
	.done()

export const constraintsSystem = createWidgetSystem({ plugins: [FormPlugin] })
