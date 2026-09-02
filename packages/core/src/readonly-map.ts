/** Creates a map-shaped, runtime immutable projection without exposing mutating Map methods. */
export function createReadonlyMap<Key, Value>(entries: Iterable<readonly [Key, Value]>): ReadonlyMap<Key, Value> {
	const map = new Map(entries)
	const result: ReadonlyMap<Key, Value> = {
		get size() {
			return map.size
		},
		get(key) {
			return map.get(key)
		},
		has(key) {
			return map.has(key)
		},
		keys() {
			return map.keys()
		},
		values() {
			return map.values()
		},
		entries() {
			return map.entries()
		},
		forEach(callbackfn, thisArg) {
			map.forEach((value, key) => callbackfn.call(thisArg, value, key, result))
		},
		[Symbol.iterator]() {
			return map[Symbol.iterator]()
		},
	}
	return Object.freeze(result)
}
