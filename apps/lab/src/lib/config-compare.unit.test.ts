import { describe, expect, it } from 'vitest'
import { compareConfig, deepEqual } from './config-compare'

describe('deepEqual', () => {
	it('compares JSON-shaped values structurally, ignoring key order', () => {
		expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }))
			.toBe(true)
		expect(deepEqual([1, 2], [1, 2, 3]))
			.toBe(false)
		expect(deepEqual({ a: 1 }, { a: 1, b: undefined }))
			.toBe(false)
		expect(deepEqual({ a: undefined }, { b: undefined }))
			.toBe(false)
		expect(deepEqual(null, {}))
			.toBe(false)
		expect(deepEqual([], {}))
			.toBe(false)
		expect(deepEqual(undefined, undefined))
			.toBe(true)
	})
})

describe('compareConfig', () => {
	it('is "same" when the resolved config equals what was authored', () => {
		expect(compareConfig({ label: { en: 'x' }, required: true }, { required: true, label: { en: 'x' } }))
			.toEqual({ kind: 'same' })
	})

	it('names the top-level fields that differ, including added and removed ones', () => {
		expect(compareConfig(
			{ title: 'T', languages: ['en'], gone: 1 },
			{ title: 'T', languages: ['en', 'zh-TW'], recovered: false },
		))
			.toEqual({ kind: 'different', changedKeys: ['languages', 'gone', 'recovered'] })
	})

	it('treats a config that was not authored at all as different from a resolved one', () => {
		expect(compareConfig(undefined, { size: 3 }))
			.toEqual({ kind: 'different', changedKeys: [] })
		expect(compareConfig(undefined, undefined))
			.toEqual({ kind: 'same' })
	})
})
