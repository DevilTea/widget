export interface InspectableValueEncodingOptions {
	readonly maxDepth?: number
	readonly maxEntries?: number
	readonly maxStringLength?: number
}

export type InspectableValue
	= | { readonly type: 'null' }
		| { readonly type: 'undefined' }
		| { readonly type: 'boolean', readonly value: boolean }
		| { readonly type: 'string', readonly value: string, readonly truncated: boolean }
		| { readonly type: 'number', readonly value: number }
		| { readonly type: 'number-special', readonly value: 'nan' | 'positive-infinity' | 'negative-infinity' | 'negative-zero' }
		| { readonly type: 'bigint', readonly value: string }
		| { readonly type: 'array', readonly id: number, readonly items: readonly InspectableValue[], readonly truncated: boolean }
		| { readonly type: 'object', readonly id: number, readonly entries: readonly InspectableObjectEntry[], readonly truncated: boolean }
		| { readonly type: 'reference', readonly ref: number }
		| { readonly type: 'opaque', readonly kind: 'function' | 'symbol' | 'dom-node' | 'class-instance' | 'uninspectable' | 'unknown-object' }
		| { readonly type: 'truncated', readonly reason: 'max-depth' }

export interface InspectableObjectEntry {
	readonly key: string
	readonly value: InspectableValue
}

const DEFAULT_MAX_DEPTH = 4
const DEFAULT_MAX_ENTRIES = 50
const DEFAULT_MAX_STRING_LENGTH = 500

function encodeString(value: string, maxLength: number): Extract<InspectableValue, { type: 'string' }> {
	const truncated = value.length > maxLength
	return {
		type: 'string',
		value: truncated ? value.slice(0, maxLength) : value,
		truncated,
	}
}

function opaque(kind: Extract<InspectableValue, { type: 'opaque' }>['kind']): InspectableValue {
	return { type: 'opaque', kind }
}

function isDomNode(value: object): boolean {
	const NodeConstructor = globalThis.Node
	if (typeof NodeConstructor !== 'function')
		return false
	try {
		return value instanceof NodeConstructor
	}
	catch {
		return false
	}
}

export function encodeInspectableValue(
	value: unknown,
	options: InspectableValueEncodingOptions = {},
): InspectableValue {
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
	const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
	const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH
	const seen = new WeakMap<object, number>()
	let nextId = 1

	function encode(current: unknown, depth: number): InspectableValue {
		if (current === null)
			return { type: 'null' }
		if (current === undefined)
			return { type: 'undefined' }

		switch (typeof current) {
			case 'boolean':
				return { type: 'boolean', value: current }
			case 'string':
				return encodeString(current, maxStringLength)
			case 'number':
				if (Number.isNaN(current))
					return { type: 'number-special', value: 'nan' }
				if (current === Infinity)
					return { type: 'number-special', value: 'positive-infinity' }
				if (current === -Infinity)
					return { type: 'number-special', value: 'negative-infinity' }
				if (Object.is(current, -0))
					return { type: 'number-special', value: 'negative-zero' }
				return { type: 'number', value: current }
			case 'bigint':
				return { type: 'bigint', value: current.toString() }
			case 'function':
				return opaque('function')
			case 'symbol':
				return opaque('symbol')
			case 'object':
				break
			default:
				return opaque('unknown-object')
		}

		if (depth >= maxDepth)
			return { type: 'truncated', reason: 'max-depth' }

		const objectValue = current as object

		// Opaque values never receive reference IDs: otherwise a repeated class/DOM/proxy value could
		// produce a { type: 'reference' } pointing at an ID that was never emitted on the wire.
		if (isDomNode(objectValue))
			return opaque('dom-node')

		if (Array.isArray(objectValue)) {
			let length: number
			try {
				length = objectValue.length
			}
			catch {
				return opaque('uninspectable')
			}

			const prior = seen.get(objectValue)
			if (prior !== undefined)
				return { type: 'reference', ref: prior }
			const id = nextId++
			seen.set(objectValue, id)

			const limit = Math.min(length, maxEntries)
			const items: InspectableValue[] = []
			for (let index = 0; index < limit; index++) {
				let descriptor: PropertyDescriptor | undefined
				try {
					descriptor = Object.getOwnPropertyDescriptor(objectValue, String(index))
				}
				catch {
					items.push(opaque('uninspectable'))
					continue
				}
				items.push(descriptor !== undefined && 'value' in descriptor
					? encode(descriptor.value, depth + 1)
					: opaque('uninspectable'))
			}
			return {
				type: 'array',
				id,
				items,
				truncated: length > limit,
			}
		}

		let prototype: object | null
		let descriptors: Record<PropertyKey, PropertyDescriptor>
		try {
			prototype = Object.getPrototypeOf(objectValue) as object | null
			if (prototype !== Object.prototype && prototype !== null)
				return opaque('class-instance')
			descriptors = Object.getOwnPropertyDescriptors(objectValue)
		}
		catch {
			return opaque('uninspectable')
		}

		const prior = seen.get(objectValue)
		if (prior !== undefined)
			return { type: 'reference', ref: prior }
		const id = nextId++
		seen.set(objectValue, id)

		const keys = Object.keys(descriptors)
			.sort()
		const entries: InspectableObjectEntry[] = []
		for (const key of keys.slice(0, maxEntries)) {
			const descriptor = descriptors[key]
			if (descriptor === undefined)
				continue
			entries.push({
				key,
				value: 'value' in descriptor
					? encode(descriptor.value, depth + 1)
					: opaque('uninspectable'),
			})
		}
		return {
			type: 'object',
			id,
			entries,
			truncated: keys.length > entries.length,
		}
	}

	try {
		return encode(value, 0)
	}
	catch {
		return opaque('uninspectable')
	}
}
