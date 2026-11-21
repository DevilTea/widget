/**
 * A small JSON Schema validator for the keywords the emitters produce (`type`, `properties`, `required`,
 * `additionalProperties`, `items`, `enum`, `const`, `anyOf`, `$ref` into `$defs`, and the numeric/length bounds).
 * The repository has no Draft 2020-12 validator; this one exists so the generated schemas can be exercised in
 * tests and by a host that wants a cheap structural pre-check. `format` and `pattern` are not evaluated.
 */

import type { JsonSchema } from './schema'

function typeOf(value: unknown): string {
	if (value === null)
		return 'null'
	if (Array.isArray(value))
		return 'array'
	return typeof value
}

function sameJson(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

/** The errors of `value` against `schema`, as `path: message` lines. Empty when it validates. */
export function validateSchema(root: JsonSchema, value: unknown): string[] {
	const errors: string[] = []
	const visit = (schema: unknown, current: unknown, path: string, into: string[]): void => {
		if (typeof schema === 'boolean') {
			if (!schema)
				into.push(`${path}: not allowed`)
			return
		}
		if (typeof schema !== 'object' || schema === null)
			return
		const node = schema as JsonSchema
		if (typeof node.$ref === 'string') {
			const name = node.$ref.replace('#/$defs/', '')
			const target = (root.$defs as Record<string, unknown> | undefined)?.[name]
			if (target === undefined)
				into.push(`${path}: unresolved $ref ${node.$ref}`)
			else
				visit(target, current, path, into)
		}
		const actual = typeOf(current)
		if (node.type !== undefined) {
			const allowed = Array.isArray(node.type) ? node.type as string[] : [node.type as string]
			if (!allowed.some(type => type === actual || (type === 'integer' && actual === 'number' && Number.isInteger(current))))
				into.push(`${path}: expected ${allowed.join(' or ')}, got ${actual}`)
		}
		if ('const' in node && !sameJson(node.const, current))
			into.push(`${path}: expected ${JSON.stringify(node.const)}`)
		if (Array.isArray(node.enum) && !node.enum.some(option => sameJson(option, current)))
			into.push(`${path}: expected one of ${JSON.stringify(node.enum)}`)
		if (Array.isArray(node.anyOf)) {
			const attempts = node.anyOf.map((option) => {
				const attempt: string[] = []
				visit(option, current, path, attempt)
				return attempt
			})
			if (!attempts.some(attempt => attempt.length === 0)) {
				into.push(`${path}: matches no anyOf branch (${attempts.map(attempt => attempt[0])
					.join(' | ')})`)
			}
		}
		if (actual === 'number') {
			const number = current as number
			if (typeof node.minimum === 'number' && number < node.minimum)
				into.push(`${path}: below minimum ${node.minimum}`)
			if (typeof node.maximum === 'number' && number > node.maximum)
				into.push(`${path}: above maximum ${node.maximum}`)
			if (typeof node.exclusiveMinimum === 'number' && number <= node.exclusiveMinimum)
				into.push(`${path}: not above ${node.exclusiveMinimum}`)
			if (typeof node.exclusiveMaximum === 'number' && number >= node.exclusiveMaximum)
				into.push(`${path}: not below ${node.exclusiveMaximum}`)
		}
		if (actual === 'string') {
			const length = [...(current as string)].length
			if (typeof node.minLength === 'number' && length < node.minLength)
				into.push(`${path}: shorter than ${node.minLength}`)
			if (typeof node.maxLength === 'number' && length > node.maxLength)
				into.push(`${path}: longer than ${node.maxLength}`)
		}
		if (actual === 'array') {
			const items = current as unknown[]
			if (typeof node.minItems === 'number' && items.length < node.minItems)
				into.push(`${path}: fewer than ${node.minItems} items`)
			if (typeof node.maxItems === 'number' && items.length > node.maxItems)
				into.push(`${path}: more than ${node.maxItems} items`)
			if (node.items !== undefined)
				items.forEach((item, index) => visit(node.items, item, `${path}/${index}`, into))
		}
		if (actual === 'object') {
			const object = current as Record<string, unknown>
			const properties = (node.properties ?? {}) as Record<string, unknown>
			for (const name of (node.required ?? []) as string[]) {
				if (!Object.hasOwn(object, name))
					into.push(`${path}: missing "${name}"`)
			}
			for (const [key, entry] of Object.entries(object)) {
				if (Object.hasOwn(properties, key))
					visit(properties[key], entry, `${path}/${key}`, into)
				else if (node.additionalProperties !== undefined)
					visit(node.additionalProperties, entry, `${path}/${key}`, into)
			}
		}
	}
	visit(root, value, '', errors)
	return errors
}
