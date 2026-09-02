import type { JsonCompatibilityDiagnostic, JsonCompatibilityReason, SourceAccessDiagnostic } from './diagnostic'

/**
 * The authored value domain. Runtime/config-resolved values intentionally use `unknown` instead;
 * this type is only for values that can occur in persisted Widget source and SourcePatch operands.
 */
export type JsonPrimitive = string | number | boolean | null

export type JsonArray = readonly JsonValue[]

export interface JsonObject {
	readonly [key: string]: JsonValue
}

export type JsonValue = JsonPrimitive | JsonArray | JsonObject

type JsonInspectionDiagnostic = JsonCompatibilityDiagnostic | SourceAccessDiagnostic

export interface JsonValueInspection {
	readonly compatible: boolean
	readonly diagnostics: readonly JsonInspectionDiagnostic[]
}

function jsonDiagnostic(path: readonly PropertyKey[], reason: JsonCompatibilityReason): JsonCompatibilityDiagnostic {
	return {
		code: 'json-incompatible-value',
		location: { type: 'source' },
		path: [...path],
		reason,
		message: `Authored source is outside the JSON domain (${reason}).`,
	}
}

function accessDiagnostic(path: readonly PropertyKey[]): SourceAccessDiagnostic {
	return {
		code: 'source-access-failed',
		location: { type: 'source' },
		path: [...path],
		message: 'Authored source could not be safely inspected.',
	}
}

function inspectJsonValueAt(
	value: unknown,
	path: readonly PropertyKey[],
	active: Set<object>,
	diagnostics: JsonInspectionDiagnostic[],
): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return

	if (typeof value === 'number') {
		if (!Number.isFinite(value))
			diagnostics.push(jsonDiagnostic(path, 'non-finite-number'))
		return
	}

	if (typeof value === 'undefined') {
		diagnostics.push(jsonDiagnostic(path, 'undefined'))
		return
	}
	if (typeof value === 'bigint') {
		diagnostics.push(jsonDiagnostic(path, 'bigint'))
		return
	}
	if (typeof value === 'symbol') {
		diagnostics.push(jsonDiagnostic(path, 'symbol'))
		return
	}
	if (typeof value === 'function') {
		diagnostics.push(jsonDiagnostic(path, 'function'))
		return
	}
	if (typeof value !== 'object')
		return

	let isArray: boolean
	try {
		isArray = Array.isArray(value)
	}
	catch {
		diagnostics.push(accessDiagnostic(path))
		return
	}

	if (active.has(value)) {
		diagnostics.push(jsonDiagnostic(path, 'cyclic-reference'))
		return
	}
	active.add(value)
	try {
		let prototype: object | null
		try {
			prototype = Object.getPrototypeOf(value)
		}
		catch {
			diagnostics.push(accessDiagnostic(path))
			return
		}

		if (prototype !== (isArray ? Array.prototype : Object.prototype) && !(prototype === null && !isArray)) {
			diagnostics.push(jsonDiagnostic(path, 'unsupported-object-prototype'))
			return
		}

		let keys: readonly (string | symbol)[]
		try {
			keys = Reflect.ownKeys(value)
		}
		catch {
			diagnostics.push(accessDiagnostic(path))
			return
		}

		if (isArray) {
			let length: number
			try {
				const descriptor = Object.getOwnPropertyDescriptor(value, 'length')
				if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'number') {
					diagnostics.push(accessDiagnostic(path))
					return
				}
				length = descriptor.value
			}
			catch {
				diagnostics.push(accessDiagnostic(path))
				return
			}

			for (const key of keys) {
				if (typeof key === 'symbol') {
					diagnostics.push(jsonDiagnostic([...path, key], 'symbol-key'))
					continue
				}
				if (key === 'length')
					continue
				if (/^(?:0|[1-9]\d*)$/.test(key) && Number(key) < length)
					continue
				diagnostics.push(jsonDiagnostic([...path, key], 'array-extra-property'))
			}

			for (let index = 0; index < length; index++) {
				let descriptor: PropertyDescriptor | undefined
				try {
					descriptor = Object.getOwnPropertyDescriptor(value, String(index))
				}
				catch {
					diagnostics.push(accessDiagnostic([...path, index]))
					continue
				}
				if (descriptor === undefined) {
					diagnostics.push(jsonDiagnostic([...path, index], 'sparse-array'))
					continue
				}
				if (!('value' in descriptor)) {
					diagnostics.push(jsonDiagnostic([...path, index], 'accessor-property'))
					continue
				}
				inspectJsonValueAt(descriptor.value, [...path, index], active, diagnostics)
			}
			return
		}

		for (const key of keys) {
			if (typeof key === 'symbol') {
				diagnostics.push(jsonDiagnostic([...path, key], 'symbol-key'))
				continue
			}

			let descriptor: PropertyDescriptor | undefined
			try {
				descriptor = Object.getOwnPropertyDescriptor(value, key)
			}
			catch {
				diagnostics.push(accessDiagnostic([...path, key]))
				continue
			}
			if (descriptor === undefined) {
				diagnostics.push(accessDiagnostic([...path, key]))
				continue
			}
			if (!('value' in descriptor)) {
				diagnostics.push(jsonDiagnostic([...path, key], 'accessor-property'))
				continue
			}
			inspectJsonValueAt(descriptor.value, [...path, key], active, diagnostics)
		}
	}
	finally {
		active.delete(value)
	}
}

/**
 * Inspect the complete authored candidate without invoking authored accessors/arbitrary behavior.
 * Diagnostics are deterministic, source-rooted facts; unsafe fragments stop locally while safe
 * siblings continue to aggregate.
 */
export function inspectJsonValue(value: unknown): JsonValueInspection {
	const diagnostics: JsonInspectionDiagnostic[] = []
	inspectJsonValueAt(value, [], new Set(), diagnostics)
	return { compatible: diagnostics.length === 0, diagnostics }
}

export function isJsonValue(value: unknown): value is JsonValue {
	return inspectJsonValue(value).compatible
}

/** JSON-domain equality used by RFC6902 `test` and by SourcePatch no-op detection. */
export function jsonEqual(left: unknown, right: unknown, seen = new Set<unknown>()): boolean {
	if (Object.is(left, right))
		return true
	if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null)
		return false
	if (!isJsonValue(left) || !isJsonValue(right))
		return false
	if (seen.has(left) || seen.has(right))
		return false

	seen.add(left)
	seen.add(right)
	try {
		if (Array.isArray(left) !== Array.isArray(right))
			return false
		if (Array.isArray(left) && Array.isArray(right)) {
			if (left.length !== right.length)
				return false
			for (let index = 0; index < left.length; index++) {
				if (!jsonEqual(left[index], right[index], seen))
					return false
			}
			return true
		}

		const leftObject = left as JsonObject
		const rightObject = right as JsonObject
		const leftKeys = Object.keys(leftObject)
		const rightKeys = Object.keys(rightObject)
		if (leftKeys.length !== rightKeys.length)
			return false
		for (const key of leftKeys) {
			if (!Object.hasOwn(rightObject, key) || !jsonEqual(leftObject[key], rightObject[key], seen))
				return false
		}
		return true
	}
	finally {
		seen.delete(left)
		seen.delete(right)
	}
}

/**
 * Type-level diagnostic for a RawConfig that is not statically within JsonValue. Optional properties
 * are allowed to be omitted, but an explicitly required `undefined` remains outside the domain.
 */
type IsAny<T> = 0 extends 1 & T ? true : false
type OptionalKeys<T extends object> = {
	[Key in keyof T]-?: Record<never, never> extends Pick<T, Key> ? Key : never
}[keyof T]

export type JsonDomainViolation<Value> = IsAny<Value> extends true
	? 'authored JSON values cannot contain any'
	: [Value] extends [never]
			? never
			: [Value] extends [JsonValue]
					? never
					: Value extends string | number | boolean | null
						? never
						: Value extends (...args: any[]) => any
							? 'authored values must be JSON-compatible'
							: Value extends readonly (infer Element)[]
								? JsonDomainViolation<Element>
								: Value extends object
									? Exclude<keyof Value, string> extends never
										? {
												[Key in keyof Value]-?: Key extends OptionalKeys<Value>
													? JsonDomainViolation<Exclude<Value[Key], undefined>>
													: JsonDomainViolation<Value[Key]>
											}[keyof Value]
										: 'authored JSON objects may only have string keys'
									: 'authored values must be JSON-compatible'
