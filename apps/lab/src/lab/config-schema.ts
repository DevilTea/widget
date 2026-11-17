/**
 * What the Structure editor knows about one config value, read from the plugin's passive config JSON Schema
 * (`WidgetCatalogEntry.config.schema`, Draft 2020-12) and from the value itself (audit U15).
 *
 * This is presentation only. It picks the control for a value (a switch, a number box, a choice list, a text box, a
 * list with Add and Remove) and what may be added or removed where the schema allows it. It never validates:
 * Core's compiler stays the one authority, and whatever the editor writes goes through `WidgetDocument` like any
 * other patch, where a wrong value shows up as Core diagnostics in Problems. Without a schema (or for a shape this
 * module does not read, such as an unmatched `oneOf`) a value is typed by what it is, and anything that is not a
 * scalar falls back to editing its JSON text.
 *
 * Understood keywords: `$ref` into `$defs`/`definitions`, `type` (single or list), `enum`, `const`, `oneOf`/`anyOf`,
 * `properties`, `required`, `additionalProperties`, `items`, `minItems`, `maxItems`, `minimum`, `maximum`,
 * `minLength`, `maxLength`, `default`, `description`. Everything else is ignored.
 */

export type JsonSchema = Readonly<Record<string, unknown>>
export type ConfigPathSegment = string | number
export type ConfigPath = readonly ConfigPathSegment[]

export type FieldKind
	= | { readonly kind: 'boolean' }
		| { readonly kind: 'number', readonly integer: boolean, readonly min: number | null, readonly max: number | null }
		| { readonly kind: 'string', readonly maxLength: number | null }
		| { readonly kind: 'enum', readonly options: readonly (string | number | boolean)[] }
		| {
			readonly kind: 'object'
			/** Properties the schema names, in schema order. */
			readonly properties: Readonly<Record<string, JsonSchema>>
			readonly required: ReadonlySet<string>
			/** Schema for keys the schema does not name, or `null` when it allows none (or there is no schema). */
			readonly additional: JsonSchema | null
			/** `true` when a schema describes this object, so keys may be added and removed. */
			readonly known: boolean
		}
		| {
			readonly kind: 'array'
			readonly items: JsonSchema | null
			readonly minItems: number
			readonly maxItems: number | null
			/** `true` when a schema describes the items, so items may be added and removed. */
			readonly known: boolean
		}
		| { readonly kind: 'json' }

export interface FieldModel {
	readonly field: FieldKind
	/** Schema `description` of the field, for the field's help text. */
	readonly description: string | null
	/** The (resolved, union-selected) schema the field was read from, `null` without one. */
	readonly schema: JsonSchema | null
}

const MAX_DEPTH = 24

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asSchema(value: unknown): JsonSchema | null {
	return isRecord(value) ? value : null
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Follows `$ref` (`#/$defs/Name`, `#/definitions/Name`); sibling keywords of the `$ref` (a description) win over the target's. */
export function resolveSchema(root: JsonSchema | null, schema: JsonSchema | null): JsonSchema | null {
	let current = schema
	for (let hops = 0; current !== null && hops < MAX_DEPTH; hops++) {
		const ref = current.$ref
		if (typeof ref !== 'string')
			return current
		const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)
		const target = match === null || root === null ? null : asSchema((asSchema(root.$defs) ?? asSchema(root.definitions))?.[match[1]!])
		if (target === null)
			return null
		const { $ref: _ref, ...siblings } = current
		current = { ...target, ...siblings }
	}
	return null
}

function typeList(schema: JsonSchema): readonly string[] {
	const type = schema.type
	if (typeof type === 'string')
		return [type]
	return Array.isArray(type) ? type.filter((entry): entry is string => typeof entry === 'string') : []
}

function typeMatches(type: string, value: unknown): boolean {
	switch (type) {
		case 'string': return typeof value === 'string'
		case 'boolean': return typeof value === 'boolean'
		case 'number': return typeof value === 'number'
		case 'integer': return typeof value === 'number' && Number.isInteger(value)
		case 'null': return value === null
		case 'array': return Array.isArray(value)
		case 'object': return isRecord(value)
		default: return false
	}
}

function sameScalar(a: unknown, b: unknown): boolean {
	return a === b
}

/**
 * A deliberately shallow "does this value look like this schema" test, used only to choose which branch of a
 * `oneOf`/`anyOf` to edit a value as. It reads type, enum/const, required keys, `additionalProperties: false`
 * and nested properties/items to a small depth.
 */
export function looksLike(root: JsonSchema | null, schema: JsonSchema | null, value: unknown, depth = 0): boolean {
	const resolved = resolveSchema(root, schema)
	if (resolved === null)
		return schema === null
	if (depth > 6)
		return true
	const branches = (Array.isArray(resolved.oneOf) ? resolved.oneOf : Array.isArray(resolved.anyOf) ? resolved.anyOf : null)
	if (branches !== null)
		return branches.some(branch => looksLike(root, asSchema(branch), value, depth + 1))
	if (Array.isArray(resolved.enum) && !resolved.enum.some(option => sameScalar(option, value)))
		return false
	if ('const' in resolved && !sameScalar(resolved.const, value))
		return false
	const types = typeList(resolved)
	if (types.length > 0 && !types.some(type => typeMatches(type, value)))
		return false
	if (isRecord(value)) {
		const properties = asSchema(resolved.properties) ?? {}
		if (Array.isArray(resolved.required) && resolved.required.some(key => typeof key === 'string' && !Object.hasOwn(value, key)))
			return false
		if (resolved.additionalProperties === false && Object.keys(value)
			.some(key => !Object.hasOwn(properties, key))) {
			return false
		}
		for (const [key, child] of Object.entries(properties)) {
			if (Object.hasOwn(value, key) && !looksLike(root, asSchema(child), value[key], depth + 1))
				return false
		}
	}
	else if (Array.isArray(value)) {
		const items = asSchema(resolved.items)
		if (items !== null && !value.every(item => looksLike(root, items, item, depth + 1)))
			return false
	}
	return true
}

/** The branch of a union the value is edited as, or `null` when the schema is a union and no branch fits. */
function selectBranch(root: JsonSchema | null, schema: JsonSchema, value: unknown): JsonSchema | null | 'none' {
	const branches = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
	if (branches === null)
		return null
	for (const branch of branches) {
		const candidate = asSchema(branch)
		if (candidate !== null && looksLike(root, candidate, value))
			return candidate
	}
	return 'none'
}

function inferFromValue(value: unknown): FieldKind {
	if (typeof value === 'boolean')
		return { kind: 'boolean' }
	if (typeof value === 'number')
		return { kind: 'number', integer: Number.isInteger(value), min: null, max: null }
	if (typeof value === 'string')
		return { kind: 'string', maxLength: null }
	if (Array.isArray(value))
		return { kind: 'array', items: null, minItems: 0, maxItems: null, known: false }
	if (isRecord(value))
		return { kind: 'object', properties: {}, required: new Set(), additional: null, known: false }
	return { kind: 'json' }
}

/** Reads how to edit `value` given its schema (`null`: none). */
export function describeField(root: JsonSchema | null, schema: JsonSchema | null, value: unknown, depth = 0): FieldModel {
	const resolved = resolveSchema(root, schema)
	if (resolved === null || depth > MAX_DEPTH)
		return { field: schema === null ? inferFromValue(value) : { kind: 'json' }, description: null, schema: null }
	const description = typeof resolved.description === 'string' ? resolved.description : null
	const branch = selectBranch(root, resolved, value)
	if (branch === 'none')
		return { field: { kind: 'json' }, description, schema: resolved }
	if (branch !== null) {
		const inner = describeField(root, { ...branch, ...(description === null ? {} : { description }) }, value, depth + 1)
		return inner
	}

	const options = 'const' in resolved ? [resolved.const] : Array.isArray(resolved.enum) ? resolved.enum : null
	if (options !== null) {
		const scalars = options.filter((option): option is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof option))
		if (scalars.length === options.length && scalars.length > 0 && scalars.includes(value as string | number | boolean))
			return { field: { kind: 'enum', options: scalars }, description, schema: resolved }
		return { field: { kind: 'json' }, description, schema: resolved }
	}

	const types = typeList(resolved)
	const type = types.find(candidate => typeMatches(candidate, value)) ?? null
	if (type === null) {
		// The schema names no type (or none that fits): trust the value for scalars, the text for everything else.
		return { field: types.length === 0 ? inferFromValue(value) : { kind: 'json' }, description, schema: resolved }
	}
	switch (type) {
		case 'boolean':
			return { field: { kind: 'boolean' }, description, schema: resolved }
		case 'number':
		case 'integer':
			return { field: { kind: 'number', integer: type === 'integer', min: numberOrNull(resolved.minimum), max: numberOrNull(resolved.maximum) }, description, schema: resolved }
		case 'string':
			return { field: { kind: 'string', maxLength: numberOrNull(resolved.maxLength) }, description, schema: resolved }
		case 'array':
			return {
				field: {
					kind: 'array',
					items: asSchema(resolved.items),
					minItems: numberOrNull(resolved.minItems) ?? 0,
					maxItems: numberOrNull(resolved.maxItems),
					known: asSchema(resolved.items) !== null,
				},
				description,
				schema: resolved,
			}
		case 'object': {
			const properties = Object.fromEntries(Object.entries(asSchema(resolved.properties) ?? {})
				.flatMap(([key, child]) => asSchema(child) === null ? [] : [[key, asSchema(child)!] as const]))
			const additional = resolved.additionalProperties === true
				? {}
				: asSchema(resolved.additionalProperties)
			return {
				field: {
					kind: 'object',
					properties,
					required: new Set(Array.isArray(resolved.required) ? resolved.required.filter((key): key is string => typeof key === 'string') : []),
					additional,
					known: true,
				},
				description,
				schema: resolved,
			}
		}
		default:
			return { field: { kind: 'json' }, description, schema: resolved }
	}
}

/** A value to start a new array item or object field from, as the schema describes it (`null` when it says nothing). */
export function defaultValueFor(root: JsonSchema | null, schema: JsonSchema | null, depth = 0): unknown {
	const resolved = resolveSchema(root, schema)
	if (resolved === null || depth > 6)
		return null
	if ('default' in resolved)
		return structuredClone(resolved.default)
	if ('const' in resolved)
		return resolved.const
	if (Array.isArray(resolved.enum) && resolved.enum.length > 0)
		return resolved.enum[0]
	const branches = Array.isArray(resolved.oneOf) ? resolved.oneOf : Array.isArray(resolved.anyOf) ? resolved.anyOf : null
	if (branches !== null)
		return defaultValueFor(root, asSchema(branches[0]), depth + 1)
	const type = typeList(resolved)[0]
	switch (type) {
		case 'boolean': return false
		case 'integer': return Math.ceil(numberOrNull(resolved.minimum) ?? 0)
		case 'number': return numberOrNull(resolved.minimum) ?? 0
		case 'string': return ''
		case 'array': {
			const minItems = numberOrNull(resolved.minItems) ?? 0
			return Array.from({ length: minItems }, () => defaultValueFor(root, asSchema(resolved.items), depth + 1))
		}
		case 'object': {
			const properties = asSchema(resolved.properties) ?? {}
			const required = Array.isArray(resolved.required) ? resolved.required.filter((key): key is string => typeof key === 'string') : []
			return Object.fromEntries(required.map(key => [key, defaultValueFor(root, asSchema(properties[key]), depth + 1)]))
		}
		default: return null
	}
}

export interface ObjectFieldKeys {
	/** Keys present in the value: the schema's order first, then the others in value order. */
	readonly present: readonly string[]
	/** Schema properties not in the value yet, which may be added. */
	readonly addable: readonly string[]
}

export function objectFieldKeys(field: Extract<FieldKind, { kind: 'object' }>, value: Readonly<Record<string, unknown>>): ObjectFieldKeys {
	const named = Object.keys(field.properties)
	const present = [
		...named.filter(key => Object.hasOwn(value, key)),
		...Object.keys(value)
			.filter(key => !Object.hasOwn(field.properties, key)),
	]
	return { present, addable: named.filter(key => !Object.hasOwn(value, key)) }
}

/** Whether `key` may be removed: the schema knows the object and does not require it. */
export function canRemoveKey(field: Extract<FieldKind, { kind: 'object' }>, key: string): boolean {
	return field.known && !field.required.has(key)
}

export function canAddItem(field: Extract<FieldKind, { kind: 'array' }>, length: number): boolean {
	return field.known && (field.maxItems === null || length < field.maxItems)
}

export function canRemoveItem(field: Extract<FieldKind, { kind: 'array' }>, length: number): boolean {
	return field.known && length > field.minItems
}

/** Text for a number box → a number, or `null` when it is not a finite number the schema accepts. */
export function parseNumberText(text: string, field: Extract<FieldKind, { kind: 'number' }>): number | null {
	if (text.trim() === '')
		return null
	const parsed = Number(text)
	if (!Number.isFinite(parsed) || (field.integer && !Number.isInteger(parsed)))
		return null
	if ((field.min !== null && parsed < field.min) || (field.max !== null && parsed > field.max))
		return null
	return parsed
}
