/**
 * Comparison of a widget's authored (`rawConfig`) and resolved (`config`) values for the Blueprint inspector
 * (audit U25), so the two are not printed twice when they say the same thing. Both come from Core's inspection
 * node; this only decides whether they are structurally equal and, when they are not, which top-level fields
 * differ. Values are JSON-shaped authored data (or what a plugin's `resolve` returned), compared structurally.
 */

export type ConfigComparison
	= | { readonly kind: 'same' }
		| { readonly kind: 'different', readonly changedKeys: readonly string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right))
		return true
	if (Array.isArray(left) && Array.isArray(right))
		return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
	if (isRecord(left) && isRecord(right)) {
		const keys = new Set([...Object.keys(left), ...Object.keys(right)])
		for (const key of keys) {
			if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key) || !deepEqual(left[key], right[key]))
				return false
		}
		return true
	}
	return false
}

/** `changedKeys` is empty when the values differ but are not both objects (the whole value changed). */
export function compareConfig(raw: unknown, resolved: unknown): ConfigComparison {
	if (deepEqual(raw, resolved))
		return { kind: 'same' }
	if (!isRecord(raw) || !isRecord(resolved))
		return { kind: 'different', changedKeys: [] }
	const keys = [...new Set([...Object.keys(raw), ...Object.keys(resolved)])]
	return { kind: 'different', changedKeys: keys.filter(key => !Object.hasOwn(raw, key) || !Object.hasOwn(resolved, key) || !deepEqual(raw[key], resolved[key])) }
}
