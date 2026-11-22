/**
 * A small JSON Schema validator for the keywords the emitters produce. The repository has no Draft 2020-12
 * validator; this one exists so the generated schemas can be exercised in tests and by a host that wants a cheap
 * structural pre-check.
 *
 * Implemented: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `anyOf`,
 * `$ref` (a JSON Pointer into the same document), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
 * `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `uniqueItems`, `minProperties`, `maxProperties`,
 * `propertyNames`. Annotations are ignored. `format` and `pattern`
 * are annotations here: they are not evaluated. Any other keyword throws, so a schema this validator cannot judge
 * is never reported as passing.
 */

import type { JsonSchema } from './schema'

const ANNOTATIONS = new Set(['$schema', '$id', '$defs', '$comment', 'title', 'description', 'default', 'examples', 'format', 'pattern'])
const IMPLEMENTED = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', '$ref', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'propertyNames'])

function typeOf(value: unknown): string {
	if (value === null)
		return 'null'
	if (Array.isArray(value))
		return 'array'
	return typeof value
}

/** JSON equality: object key order does not matter. */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b)
		return true
	const type = typeOf(a)
	if (type !== typeOf(b))
		return false
	if (type === 'array') {
		const [left, right] = [a as unknown[], b as unknown[]]
		return left.length === right.length && left.every((item, index) => sameJson(item, right[index]))
	}
	if (type === 'object') {
		const [left, right] = [a as Record<string, unknown>, b as Record<string, unknown>]
		const keys = Object.keys(left)
		return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
	}
	return false
}

/** Resolves a same-document JSON Pointer reference (`#/a/b`, with `~0` and `~1` escapes). */
function resolveRef(root: JsonSchema, ref: string): unknown {
	if (ref === '#')
		return root
	if (!ref.startsWith('#/'))
		throw new Error(`Unsupported $ref "${ref}": only references into the same document are resolved.`)
	let current: unknown = root
	for (const token of ref.slice(2)
		.split('/')) {
		const key = decodeURIComponent(token)
			.replaceAll('~1', '/')
			.replaceAll('~0', '~')
		if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key))
			return undefined
		current = (current as Record<string, unknown>)[key]
	}
	return current
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
			throw new Error(`${path}: a schema must be an object or a boolean.`)
		const node = schema as JsonSchema
		for (const keyword of Object.keys(node)) {
			if (!IMPLEMENTED.has(keyword) && !ANNOTATIONS.has(keyword))
				throw new Error(`The keyword "${keyword}" is not implemented by this validator.`)
		}
		if (typeof node.$ref === 'string') {
			const target = resolveRef(root, node.$ref)
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
			if (typeof node.multipleOf === 'number' && node.multipleOf > 0) {
				const quotient = number / node.multipleOf
				// Tolerates binary rounding (0.3 / 0.1), as validators conventionally do.
				if (Math.abs(quotient - Math.round(quotient)) > 1e-9 * Math.max(1, Math.abs(quotient)))
					into.push(`${path}: not a multiple of ${node.multipleOf}`)
			}
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
			if (node.uniqueItems === true && items.some((item, index) => items.findIndex(other => sameJson(other, item)) !== index))
				into.push(`${path}: items are not unique`)
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
			const keys = Object.keys(object)
			if (typeof node.minProperties === 'number' && keys.length < node.minProperties)
				into.push(`${path}: fewer than ${node.minProperties} properties`)
			if (typeof node.maxProperties === 'number' && keys.length > node.maxProperties)
				into.push(`${path}: more than ${node.maxProperties} properties`)
			if (node.propertyNames !== undefined)
				keys.forEach(key => visit(node.propertyNames, key, `${path}/${key}`, into))
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
