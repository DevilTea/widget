/**
 * The value re-encoding the LLM profile uses for config values, shared by the schema emitter (to rewrite
 * `@default` and `@examples`) and the flat/tree converters.
 *
 * - a dictionary (`Record<string, T>`) is a list of `{ key, value }` entries;
 * - an untyped value, or a value of a recursive named type, is JSON text;
 * - everything else keeps its shape, and a value that does not fit the declared shape passes through unchanged.
 */

import type { Shape, ShapeProperty, SystemIr } from './ir'

/** The names of the named types that reach themselves, which the LLM profile cannot express with `$ref`. */
export function recursiveTypeNames(ir: SystemIr): Set<string> {
	const recursive = new Set<string>()
	const reaches = (shape: Shape, target: string, seen: Set<string>): boolean => {
		switch (shape.kind) {
			case 'ref':
				if (shape.name === target)
					return true
				if (seen.has(shape.name) || ir.types[shape.name] === undefined)
					return false
				seen.add(shape.name)
				return reaches(ir.types[shape.name]!.shape, target, seen)
			case 'array':
				return reaches(shape.items, target, seen)
			case 'record':
				return reaches(shape.value, target, seen)
			case 'union':
				return shape.members.some(member => reaches(member, target, seen))
			case 'object':
				return shape.properties.some(property => reaches(property.shape, target, seen))
			default:
				return false
		}
	}
	for (const [name, type] of Object.entries(ir.types)) {
		if (reaches(type.shape, name, new Set()))
			recursive.add(name)
	}
	return recursive
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Sets an own property; `__proto__` must become an own property, never the prototype. */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

export interface ValueEncoding {
	/** Authored value -> LLM-profile value. */
	encode: (value: unknown, shape: Shape) => unknown
	/** LLM-profile value -> authored value. */
	decode: (value: unknown, shape: Shape) => unknown
}

export function createValueEncoding(ir: SystemIr): ValueEncoding {
	const recursive = recursiveTypeNames(ir)
	const isOpaque = (shape: Shape): boolean => shape.kind === 'unknown' || (shape.kind === 'ref' && (recursive.has(shape.name) || ir.types[shape.name] === undefined))
	const resolve = (shape: Shape): Shape => {
		let current = shape
		while (current.kind === 'ref' && !isOpaque(current))
			current = ir.types[current.name]!.shape
		return current
	}

	/** The literal values a property admits when it is a discriminant (a literal or a union of literals), else `null`. */
	function literalsOf(property: ShapeProperty): readonly (string | number | boolean)[] | null {
		const shape = resolve(property.shape)
		if (shape.kind === 'literal')
			return [shape.value]
		if (shape.kind === 'union') {
			const values: (string | number | boolean)[] = []
			for (const member of shape.members.map(resolve)) {
				if (member.kind !== 'literal')
					return null
				values.push(member.value)
			}
			return values
		}
		return null
	}

	/**
	 * Whether `value` could be an instance of `shape`, shallowly: the JSON type fits, and for an object every
	 * required key is present and every discriminant property has one of its literal values. `flat` says which
	 * of the two encodings `value` is in.
	 */
	function matches(value: unknown, shape: Shape, flat: boolean): boolean {
		if (isOpaque(shape))
			return flat ? typeof value === 'string' : true
		const resolved = resolve(shape)
		switch (resolved.kind) {
			case 'string':
				return typeof value === 'string'
			case 'number':
				return typeof value === 'number'
			case 'boolean':
				return typeof value === 'boolean'
			case 'null':
				return value === null
			case 'literal':
				return value === resolved.value
			case 'array':
				return Array.isArray(value)
			case 'record':
				return flat ? Array.isArray(value) : isPlainObject(value)
			case 'object':
				return isPlainObject(value) && resolved.properties.every((property) => {
					if (!Object.hasOwn(value, property.name))
						return property.optional
					const literals = literalsOf(property)
					return literals === null || literals.includes(value[property.name] as string | number | boolean)
				})
			case 'union':
				return resolved.members.some(member => matches(value, member, flat))
			default:
				return true
		}
	}

	/** The union member `value` belongs to: the first member that matches, preferring one that declares every key of an object value. */
	function memberOf(value: unknown, members: readonly Shape[], flat: boolean): Shape | undefined {
		const candidates = members.filter(member => matches(value, member, flat))
		if (candidates.length <= 1 || !isPlainObject(value))
			return candidates[0]
		const keys = Object.keys(value)
		return candidates.find((candidate) => {
			const resolved = resolve(candidate)
			return resolved.kind === 'object' && keys.every(key => resolved.properties.some(property => property.name === key))
		}) ?? candidates[0]
	}

	function parseJsonText(value: unknown): unknown {
		if (typeof value !== 'string')
			return value
		try {
			return JSON.parse(value)
		}
		catch {
			return value
		}
	}

	function convert(value: unknown, shape: Shape, flat: boolean): unknown {
		if (isOpaque(shape))
			return flat ? parseJsonText(value) : JSON.stringify(value)
		const resolved = resolve(shape)
		switch (resolved.kind) {
			case 'array':
				return Array.isArray(value) ? value.map(item => convert(item, resolved.items, flat)) : value
			case 'record': {
				if (!flat) {
					return isPlainObject(value)
						? Object.entries(value)
								.map(([key, entry]) => ({ key, value: convert(entry, resolved.value, flat) }))
						: value
				}
				if (!Array.isArray(value) || !value.every(entry => isPlainObject(entry) && typeof entry.key === 'string' && Object.hasOwn(entry, 'value')))
					return value
				const result: Record<string, unknown> = {}
				for (const entry of value as { key: string, value: unknown }[])
					setOwn(result, entry.key, convert(entry.value, resolved.value, flat))
				return result
			}
			case 'union': {
				const member = memberOf(value, resolved.members, flat)
				return member === undefined ? value : convert(value, member, flat)
			}
			case 'object': {
				if (!isPlainObject(value))
					return value
				const declared = new Map(resolved.properties.map(property => [property.name, property]))
				const result: Record<string, unknown> = {}
				// Key order is kept, a missing optional property stays missing, an explicit null stays null, and an
				// undeclared key passes through.
				for (const [key, entry] of Object.entries(value)) {
					const property = declared.get(key)
					setOwn(result, key, property === undefined ? entry : convert(entry, property.shape, flat))
				}
				return result
			}
			default:
				return value
		}
	}

	return {
		encode: (value, shape) => convert(value, shape, false),
		decode: (value, shape) => convert(value, shape, true),
	}
}
