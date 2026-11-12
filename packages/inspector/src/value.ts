export interface InspectableValueEncodingOptions {
	/** Maximum nesting depth of containers; deeper values encode as `{ type: 'truncated' }`. Default 4. */
	readonly maxDepth?: number
	/** Maximum entries/items emitted per array or object. Default 50. */
	readonly maxEntries?: number
	/** Maximum length of any string value or object key (UTF-16 code units). Default 500. */
	readonly maxStringLength?: number
	/**
	 * Total budget of encoded values (every emitted node counts, leaves included) across the whole encoding,
	 * on top of the per-level limits. Once spent, remaining entries/items are left out and their container
	 * reports `truncated: true`. The root is always emitted. Default 1000.
	 */
	readonly maxNodes?: number
	/**
	 * Cut object keys longer than `maxStringLength` and mark the entry with `keyTruncated: true`. Default true.
	 * When false, keys are emitted in full and never cut: the Agent turns it off for peers negotiated below
	 * protocol 0.4, which predate the marker and must see the same shapes as before.
	 */
	readonly markTruncatedKeys?: boolean
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
	/** Present (and `true`) only when `key` was cut to the string limit. Added in protocol 0.4. */
	readonly keyTruncated?: boolean
	readonly value: InspectableValue
}

export const DEFAULT_INSPECTABLE_VALUE_LIMITS: Readonly<Required<Omit<InspectableValueEncodingOptions, 'markTruncatedKeys'>>> = Object.freeze({
	maxDepth: 4,
	maxEntries: 50,
	maxStringLength: 500,
	maxNodes: 1000,
})

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

/**
 * The `limit` smallest keys in code-unit order, without sorting (or copying) the whole key list: one pass
 * with a bounded sorted window, so the work beyond listing the keys is proportional to the keys emitted.
 */
function smallestKeys(keys: readonly string[], limit: number): string[] {
	const selected: string[] = []
	if (limit <= 0)
		return selected
	for (const key of keys) {
		if (selected.length === limit && key >= selected[limit - 1]!)
			continue
		let low = 0
		let high = selected.length
		while (low < high) {
			const middle = (low + high) >>> 1
			if (selected[middle]! < key)
				low = middle + 1
			else
				high = middle
		}
		selected.splice(low, 0, key)
		if (selected.length > limit)
			selected.pop()
	}
	return selected
}

export function encodeInspectableValue(
	value: unknown,
	options: InspectableValueEncodingOptions = {},
): InspectableValue {
	const maxDepth = options.maxDepth ?? DEFAULT_INSPECTABLE_VALUE_LIMITS.maxDepth
	const maxEntries = options.maxEntries ?? DEFAULT_INSPECTABLE_VALUE_LIMITS.maxEntries
	const maxStringLength = options.maxStringLength ?? DEFAULT_INSPECTABLE_VALUE_LIMITS.maxStringLength
	const maxNodes = options.maxNodes ?? DEFAULT_INSPECTABLE_VALUE_LIMITS.maxNodes
	const markTruncatedKeys = options.markTruncatedKeys ?? true
	const seen = new WeakMap<object, number>()
	let nextId = 1
	// Every value this encoding emits, leaves and placeholders included, spends one unit of `maxNodes`.
	let nodes = 0

	function encode(current: unknown, depth: number): InspectableValue {
		nodes++
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
			for (let index = 0; index < limit && nodes < maxNodes; index++) {
				let descriptor: PropertyDescriptor | undefined
				try {
					descriptor = Object.getOwnPropertyDescriptor(objectValue, String(index))
				}
				catch {
					nodes++
					items.push(opaque('uninspectable'))
					continue
				}
				if (descriptor !== undefined && 'value' in descriptor) {
					items.push(encode(descriptor.value, depth + 1))
				}
				else {
					nodes++
					items.push(opaque('uninspectable'))
				}
			}
			return {
				type: 'array',
				id,
				items,
				truncated: length > items.length,
			}
		}

		let keys: string[]
		try {
			const prototype = Object.getPrototypeOf(objectValue) as object | null
			if (prototype !== Object.prototype && prototype !== null)
				return opaque('class-instance')
			// One linear listing of the own enumerable string keys; no per-key descriptor objects and no
			// full sort, so a huge object costs far less than the entries it actually emits.
			keys = Object.keys(objectValue)
		}
		catch {
			return opaque('uninspectable')
		}

		const prior = seen.get(objectValue)
		if (prior !== undefined)
			return { type: 'reference', ref: prior }
		const id = nextId++
		seen.set(objectValue, id)

		const entries: InspectableObjectEntry[] = []
		for (const key of smallestKeys(keys, maxEntries)) {
			if (nodes >= maxNodes)
				break
			let descriptor: PropertyDescriptor | undefined
			try {
				descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
			}
			catch {
				descriptor = undefined
			}
			if (descriptor === undefined)
				continue
			// Without the marker (peers below 0.4) a cut key would be indistinguishable from a real one and two
			// distinct long keys could collide, so such peers keep receiving keys in full, as before 0.4.
			const keyTruncated = markTruncatedKeys && key.length > maxStringLength
			let entryValue: InspectableValue
			if ('value' in descriptor) {
				entryValue = encode(descriptor.value, depth + 1)
			}
			else {
				nodes++
				entryValue = opaque('uninspectable')
			}
			entries.push({
				key: keyTruncated ? key.slice(0, maxStringLength) : key,
				...(keyTruncated ? { keyTruncated: true } : {}),
				value: entryValue,
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
