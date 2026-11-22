/**
 * "Is this the same document?" for the Lab's presentation rules (Lab UX phase 2): two source texts are the same when they parse to
 * structurally equal JSON values, so whitespace and object key order do not matter and array order does. Format + Apply on an
 * untouched preset is therefore still that preset. A text that does not parse is compared as text. Used by the Examples menu's
 * "edited" marker (`example.ts`) and the committed-edit protection (`draft-guard.ts`), so both say the same thing.
 */

const parsed = new Map<string, { readonly ok: true, readonly value: unknown } | { readonly ok: false }>()
/** Parsed texts are kept for reuse (presets are compared on every commit); the cache is small and starts over when full. */
const CACHE_LIMIT = 64

function parse(text: string): { readonly ok: true, readonly value: unknown } | { readonly ok: false } {
	let entry = parsed.get(text)
	if (entry === undefined) {
		try {
			entry = { ok: true, value: JSON.parse(text) as unknown }
		}
		catch {
			entry = { ok: false }
		}
		if (parsed.size >= CACHE_LIMIT)
			parsed.clear()
		parsed.set(text, entry)
	}
	return entry
}

/** Structural equality of two JSON values: objects by their own keys whatever the order, arrays item by item. */
export function jsonValuesEqual(a: unknown, b: unknown): boolean {
	if (a === b)
		return true
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
		return false
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
			return false
		return a.every((item, index) => jsonValuesEqual(item, b[index]))
	}
	const aKeys = Object.keys(a)
	const bRecord = b as Record<string, unknown>
	if (aKeys.length !== Object.keys(bRecord).length)
		return false
	const aRecord = a as Record<string, unknown>
	return aKeys.every(key => Object.hasOwn(bRecord, key) && jsonValuesEqual(aRecord[key], bRecord[key]))
}

/** Whether two source texts are the same document: equal JSON values, or, when either does not parse, equal text. */
export function sameJsonDocument(a: string, b: string): boolean {
	if (a === b)
		return true
	const left = parse(a)
	const right = parse(b)
	return left.ok && right.ok && jsonValuesEqual(left.value, right.value)
}
