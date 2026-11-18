/**
 * The bridge between a schema library and Core, written exactly as the Core guide describes it
 * ("Schema libraries and Standard Schema" in `docs/site/packages/widget-core.md`): Core takes plain
 * predicates, so a Standard Schema v1 object becomes `(input, ctx) => input is Input` and reports every issue
 * the library found as one diagnostic with its own message, verbatim.
 *
 * The Standard Schema interface is copied here, as the spec recommends, instead of depending on
 * `@standard-schema/spec`. Nothing in this file knows which library the schemas come from: `./schemas.ts` is
 * the only file that imports Valibot.
 *
 * Two facts the guide states and this file keeps:
 * - Core keeps the validated **input**, never a schema's output. `KeepsInput` makes a schema whose input and
 *   output types differ (a transform, a default, a coercion) a type error at the slot.
 * - Core is synchronous. A schema that validated asynchronously returned a Promise, which carries no `issues`
 *   and would read as success, so the guard throws instead.
 */

import type { DiagnosticCollector, RelativeValueDiagnosticInput, WidgetConfigJsonSchema } from '@deviltea/widget-core'

export interface StandardIssue {
	readonly message: string
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

export type StandardResult<Value> = { readonly value: Value, readonly issues?: undefined } | { readonly issues: readonly StandardIssue[] }

export interface StandardSchema<Input = unknown, Output = Input> {
	readonly '~standard': {
		readonly version: 1
		readonly vendor: string
		readonly validate: (value: unknown) => StandardResult<Output> | PromiseLike<StandardResult<Output>>
		readonly types?: { readonly input: Input, readonly output: Output } | undefined
		readonly jsonSchema?: { readonly input: (options: { readonly target: string }) => Record<string, unknown> } | undefined
	}
}

export type InferInput<Schema extends StandardSchema> = NonNullable<Schema['~standard']['types']>['input']
export type InferOutput<Schema extends StandardSchema> = NonNullable<Schema['~standard']['types']>['output']

/** `unknown` when the schema's input and output types are the same, `never` when they differ. */
export type KeepsInput<Schema extends StandardSchema> = [InferInput<Schema>] extends [InferOutput<Schema>]
	? ([InferOutput<Schema>] extends [InferInput<Schema>] ? unknown : never)
	: never

/** A Standard Schema in, a Core predicate out. Every issue becomes one diagnostic (`reason: 'standard-schema'`). */
export function guard<Schema extends StandardSchema>(schema: Schema & KeepsInput<Schema>) {
	return (input: unknown, ctx: DiagnosticCollector<RelativeValueDiagnosticInput>): input is InferInput<Schema> => {
		const result = schema['~standard'].validate(input)
		if (typeof (result as { then?: unknown }).then === 'function')
			throw new TypeError(`The ${schema['~standard'].vendor} schema validated asynchronously; Core accepts only synchronous validation.`)
		const { issues } = result as Exclude<typeof result, PromiseLike<unknown>>
		if (issues === undefined)
			return true
		for (const issue of issues) {
			// A Standard Schema path segment is a key or a `{ key }` object; a Core path holds keys.
			const path = issue.path?.map(segment => typeof segment === 'object' ? segment.key : segment)
			ctx.addDiagnostic(path === undefined || path.length === 0
				? { message: issue.message, reason: 'standard-schema' }
				: { message: issue.message, path, reason: 'standard-schema' })
		}
		return false
	}
}

/**
 * The schema's JSON Schema (Draft 2020-12) for `config.schema`, taken from the library through Standard JSON
 * Schema. Core never runs it: it is authoring guidance for the Catalog, the Structure editor and an AI. The
 * validator stays the authority, and a refinement the library cannot express as JSON Schema is not in it.
 */
/** A JSON Schema document (the object form: `WidgetConfigJsonSchema` also allows a bare boolean). */
export type ConfigJsonSchemaObject = Exclude<WidgetConfigJsonSchema, boolean>

export function jsonSchemaOf(schema: StandardSchema): ConfigJsonSchemaObject {
	const jsonSchema = schema['~standard'].jsonSchema
	if (jsonSchema === undefined)
		throw new TypeError(`The ${schema['~standard'].vendor} schema does not export a JSON Schema.`)
	return jsonSchema.input({ target: 'draft-2020-12' }) as ConfigJsonSchemaObject
}
