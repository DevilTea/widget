import { describe, expect, it } from 'vitest'
import { encodeInspectableValue } from './value'

/** The previous selection: a sorted window of at most `limit` keys kept with binary search and `splice`. */
function referenceSmallestKeys(keys: readonly string[], limit: number): string[] {
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

/** A deterministic PRNG, so a failure reproduces. */
function createRandom(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6D2B79F5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
	const random = createRandom(seed)
	const copy = [...items]
	for (let index = copy.length - 1; index > 0; index--) {
		const other = Math.floor(random() * (index + 1));
		[copy[index], copy[other]] = [copy[other]!, copy[index]!]
	}
	return copy
}

/** The keys the encoder emits for an object whose own keys are `keys`, in emission order. */
function emittedKeys(keys: readonly string[], maxEntries: number): string[] {
	// `fromEntries` defines own data properties, so even `__proto__` is a plain key here.
	const object = Object.fromEntries(keys.map(key => [key, 0]))
	const encoded = encodeInspectableValue(object, { maxEntries, maxNodes: Number.MAX_SAFE_INTEGER, maxStringLength: 10_000 })
	if (encoded.type !== 'object')
		throw new Error('Expected object encoding.')
	return encoded.entries.map(entry => entry.key)
}

function expectedKeys(keys: readonly string[], maxEntries: number): string[] {
	return referenceSmallestKeys(Object.keys(Object.fromEntries(keys.map(key => [key, 0]))), maxEntries)
}

const ordered = Array.from({ length: 300 }, (_, index) => `key-${String(index)
	.padStart(4, '0')}`)

describe('encodeInspectableValue key selection', () => {
	const arrivals: Array<[string, readonly string[]]> = [
		['ascending', ordered],
		['descending', [...ordered].reverse()],
		['shuffled', shuffled(ordered, 1)],
		['shuffled again', shuffled(ordered, 2)],
	]
	const limits = [0, 1, 2, 49, 50, 51, 255, 256, 257, 299, 300, 301, 10_000, Number.POSITIVE_INFINITY]

	it.each(arrivals)('emits the smallest keys in code-unit order for %s keys at every limit', (_name, keys) => {
		for (const limit of limits) {
			expect(emittedKeys(keys, limit), `limit ${limit}`)
				.toStrictEqual(expectedKeys(keys, limit))
			expect(emittedKeys(keys, limit), `limit ${limit} against sort`)
				.toStrictEqual([...ordered].sort()
					.slice(0, limit))
		}
	})

	it('compares keys by UTF-16 code unit, not by code point, locale or numeric value', () => {
		const keys = [
			'',
			' ',
			'10',
			'9',
			'2',
			'a',
			'B',
			'ab',
			'a\u0000',
			'￿',
			'😀', // U+1F600: a surrogate pair sorts below U+FFFF in code units
			'퟿',
			'',
			'é',
			'é',
			'z',
			'Z',
			'__proto__',
			'constructor',
			'-0',
			'1e3',
			'ǅ',
		]
		for (const arrival of [keys, [...keys].reverse(), shuffled(keys, 3), shuffled(keys, 4)]) {
			for (const limit of [0, 1, 2, 3, 5, 10, 21, 22, 23, 100]) {
				expect(emittedKeys(arrival, limit), `limit ${limit}`)
					.toStrictEqual(expectedKeys(arrival, limit))
			}
		}
	})

	it('selects exactly like the previous implementation for random keys, limits and duplicates', () => {
		const random = createRandom(42)
		const alphabet = ['a', 'b', 'B', '0', '9', '_', '\uD83D', '\uDE00', '￿', '~']
		for (let round = 0; round < 200; round++) {
			const count = Math.floor(random() * 120)
			const keys = Array.from({ length: count }, () => Array.from({ length: Math.floor(random() * 5) }, () => alphabet[Math.floor(random() * alphabet.length)]!)
				.join(''))
			const limit = Math.floor(random() * (count + 3))
			// Object keys are unique, so duplicates collapse here exactly as they do for the encoder.
			expect(emittedKeys(keys, limit), `round ${round}, ${count} keys, limit ${limit}`)
				.toStrictEqual(expectedKeys(keys, limit))
		}
	})

	it('treats a fractional, negative or non-numeric limit as the previous implementation did', () => {
		const keys = shuffled(ordered, 5)
		for (const limit of [-1, -0.5, 0.5, 1.5, 2.5, 50.9, Number.NaN]) {
			expect(emittedKeys(keys, limit), `limit ${limit}`)
				.toStrictEqual(expectedKeys(keys, limit))
		}
	})

	it('selects from a very large object in descending order without a quadratic cost', () => {
		const keys = Array.from({ length: 100_000 }, (_, index) => `k${String(99_999 - index)
			.padStart(6, '0')}`)
		const started = performance.now()
		const all = emittedKeys(keys, Number.POSITIVE_INFINITY)
		const some = emittedKeys(keys, 10_000)
		const elapsed = performance.now() - started
		expect(all)
			.toHaveLength(100_000)
		expect(all[0])
			.toBe('k000000')
		expect(all[99_999])
			.toBe('k099999')
		expect(some)
			.toStrictEqual(all.slice(0, 10_000))
		// The previous implementation needed about 800 ms for the unbounded case alone.
		expect(elapsed)
			.toBeLessThan(5000)
	})
})
