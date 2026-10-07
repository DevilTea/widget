import { describe, expect, it } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from './index'
import { applySourcePatch } from './source-patch'

describe('sourcePatch', () => {
	it('uses a final JSON Pointer `-` only as an add-like array destination', () => {
		const result = applySourcePatch({ arr: [1, 2] }, [
			{ op: 'add', path: '/arr/-', value: 3 },
		])

		expect(result)
			.toEqual({
				ok: true,
				value: { changed: true, source: { arr: [1, 2, 3] } },
			})
	})

	it('allows copy and move to append with a final JSON Pointer `-`', () => {
		const copied = applySourcePatch({ arr: [1, 2] }, [
			{ op: 'copy', from: '/arr/0', path: '/arr/-' },
		])
		const moved = applySourcePatch({ arr: [1, 2] }, [
			{ op: 'move', from: '/arr/0', path: '/arr/-' },
		])

		expect(copied)
			.toEqual({ ok: true, value: { changed: true, source: { arr: [1, 2, 1] } } })
		expect(moved)
			.toEqual({ ok: true, value: { changed: true, source: { arr: [2, 1] } } })
	})

	it('rejects final `-` for non-add-like operations and structured `-` on an Array, while keeping structured `-` ordinary on objects', () => {
		const replace = applySourcePatch({ arr: [1] }, [
			{ op: 'replace', path: '/arr/-', value: 2 },
		])
		const structuredArray = applySourcePatch({ arr: [1] }, [
			{ op: 'add', path: ['arr', '-'], value: 2 },
		])
		const structuredObject = applySourcePatch({ obj: {} }, [
			{ op: 'add', path: ['obj', '-'], value: 2 },
		])

		expect(replace)
			.toMatchObject({ ok: false, failure: { code: 'invalid-array-index', operationIndex: 0 } })
		expect(structuredArray)
			.toMatchObject({ ok: false, failure: { code: 'invalid-array-index', operationIndex: 0 } })
		expect(structuredObject)
			.toEqual({ ok: true, value: { changed: true, source: { obj: { '-': 2 } } } })
	})

	it('rejects removing the document root as an atomic invalid-path failure', () => {
		const source = { value: 1 }
		const result = applySourcePatch(source, [{ op: 'remove', path: '' }])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'invalid-path', operationIndex: 0 } })
		expect(source)
			.toEqual({ value: 1 })
	})

	it('removes before adding for a same-array move from index 0 to 2', () => {
		const result = applySourcePatch({ arr: ['zero', 'one', 'two'] }, [
			{ op: 'move', from: '/arr/0', path: '/arr/2' },
		])

		expect(result)
			.toEqual({
				ok: true,
				value: { changed: true, source: { arr: ['one', 'two', 'zero'] } },
			})
	})

	it('removes before adding for a same-array move from index 2 to 0', () => {
		const result = applySourcePatch({ arr: ['zero', 'one', 'two'] }, [
			{ op: 'move', from: '/arr/2', path: '/arr/0' },
		])

		expect(result)
			.toEqual({
				ok: true,
				value: { changed: true, source: { arr: ['two', 'zero', 'one'] } },
			})
	})

	it('reports failures against the original operation index', () => {
		const result = applySourcePatch({ arr: [1, 2] }, [
			{ op: 'add', path: '/arr/-', value: 3 },
			{ op: 'remove', path: '/missing' },
		])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'path-not-found', operationIndex: 1 } })
	})

	it('does not treat a same-path move as a no-op until the source is read', () => {
		const result = applySourcePatch({ arr: [1] }, [
			{ op: 'move', from: '/arr/-', path: '/arr/-' },
		])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'invalid-array-index', operationIndex: 0 } })
	})

	it('allows a real existing same-path move to be a structural no-op', () => {
		const result = applySourcePatch({ arr: [1] }, [
			{ op: 'move', from: '/arr/0', path: '/arr/0' },
		])

		expect(result)
			.toMatchObject({ ok: true, value: { changed: false, source: { arr: [1] } } })
	})

	it('rejects moving a value into its own descendant', () => {
		const result = applySourcePatch({ root: { child: 1 } }, [
			{ op: 'move', from: '/root', path: '/root/child' },
		])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'invalid-move-target', operationIndex: 0 } })
	})

	it('normalizes structured numeric shorthand before move path identity checks', () => {
		const same = applySourcePatch({ obj: { 1: 'value' } }, [
			{ op: 'move', from: ['obj', 1], path: ['obj', '1'] },
		])
		const descendant = applySourcePatch({ obj: { 1: { child: true } } }, [
			{ op: 'move', from: ['obj', 1], path: ['obj', '1', 'child'] },
		])

		expect(same)
			.toMatchObject({ ok: true, value: { changed: false, source: { obj: { 1: 'value' } } } })
		expect(descendant)
			.toMatchObject({ ok: false, failure: { code: 'invalid-move-target', operationIndex: 0 } })
	})

	it('rolls back all preceding operations when a later operation fails', () => {
		const source = { value: 1 }
		const result = applySourcePatch(source, [
			{ op: 'replace', path: '/value', value: 2 },
			{ op: 'remove', path: '/missing' },
		])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'path-not-found', operationIndex: 1 } })
		expect(source)
			.toEqual({ value: 1 })
	})

	it('recovers a malformed root through a root replacement', () => {
		const result = applySourcePatch(Symbol('malformed-root'), [
			{ op: 'replace', path: '', value: { recovered: true } },
		])

		expect(result)
			.toEqual({ ok: true, value: { changed: true, source: { recovered: true } } })
	})

	it('keeps root replacement as the universal repair floor for an uninspectable recovery source', () => {
		const { proxy, revoke } = Proxy.revocable({ stale: true }, {})
		revoke()

		const replaced = applySourcePatch(proxy, [
			{ op: 'replace', path: '', value: { recovered: true } },
		])
		const traversed = applySourcePatch(proxy, [
			{ op: 'replace', path: '/stale', value: false },
		])

		expect(replaced)
			.toEqual({ ok: true, value: { changed: true, source: { recovered: true } } })
		expect(traversed)
			.toMatchObject({ ok: false, failure: { code: 'source-access-failed', operationIndex: 0 } })
	})

	it('decodes RFC6901 escapes without conflating slash and tilde', () => {
		const result = applySourcePatch({ 'a/b': { '~key': 1 } }, [
			{ op: 'replace', path: '/a~1b/~0key', value: 2 },
		])

		expect(result)
			.toEqual({ ok: true, value: { changed: true, source: { 'a/b': { '~key': 2 } } } })
	})

	it('keeps structured numeric segments distinct from numeric-looking string keys', () => {
		const source = { arr: [10] as (number | string)[] }
		Object.defineProperty(source.arr, '01', { value: 'named', enumerable: true, configurable: true, writable: true })

		const numeric = applySourcePatch(source, [{ op: 'add', path: ['arr', 0], value: 20 }])
		const named = applySourcePatch(source, [{ op: 'add', path: ['arr', '01'], value: 'renamed' }])

		if (!numeric.ok)
			throw new Error('expected the structured numeric path to succeed')
		const numericSource = numeric.value.source as { arr: (number | string)[] }
		expect(Array.from(numericSource.arr))
			.toEqual([20, 10])
		expect(Object.getOwnPropertyDescriptor(numericSource.arr, '01')?.value)
			.toBe('named')
		expect(named)
			.toMatchObject({ ok: false, failure: { code: 'invalid-array-index', operationIndex: 0 } })
	})

	it('treats canonical structured string keys as Array indexes and rejects noncanonical strings', () => {
		const source = { arr: ['zero', 'one', 'two'] }
		Object.defineProperty(source.arr, '01', { value: 'named', enumerable: true, configurable: true, writable: true })

		const canonical = applySourcePatch(source, [{ op: 'remove', path: ['arr', '1'] }])
		const noncanonical = applySourcePatch(source, [{ op: 'replace', path: ['arr', '01'], value: 'renamed' }])

		if (!canonical.ok)
			throw new Error('expected the canonical structured path to succeed')
		const canonicalArray = (canonical.value.source as { arr: string[] }).arr
		expect(Array.from(canonicalArray))
			.toEqual(['zero', 'two'])
		expect(noncanonical)
			.toMatchObject({ ok: false, failure: { code: 'invalid-array-index', operationIndex: 0 } })
	})

	it('deep-copies copy operands and compares nested JSON values for test', () => {
		const source = { nested: { value: 1 } }
		const result = applySourcePatch(source, [
			{ op: 'copy', from: '/nested', path: '/copy' },
			{ op: 'test', path: '/copy', value: { value: 1 } },
		])

		if (!result.ok)
			throw new Error('expected copy/test to succeed')
		expect(result.value.source)
			.toEqual({ nested: { value: 1 }, copy: { value: 1 } })
		expect((result.value.source as { nested: object, copy: object }).copy)
			.not.toBe(source.nested)
	})

	it('rejects an RFC6902 test when the expected object has an extra key', () => {
		const result = applySourcePatch({ account: { name: 'Ada' } }, [
			{ op: 'test', path: '/account', value: { name: 'Ada', role: 'admin' } },
		])

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'test-failed', operationIndex: 0 } })
	})

	it('replaces and removes accessor occurrences without invoking accessors, but rejects accessor traversal', () => {
		let reads = 0
		const source: Record<string, unknown> = { value: 1 }
		Object.defineProperty(source, 'accessor', {
			get() {
				reads++
				return { nested: true }
			},
			enumerable: true,
			configurable: true,
		})

		const replaced = applySourcePatch(source, [{ op: 'replace', path: '/accessor', value: { replaced: true } }])
		const removed = applySourcePatch(source, [{ op: 'remove', path: '/accessor' }])
		const traversed = applySourcePatch(source, [{ op: 'replace', path: '/accessor/nested', value: false }])

		expect(replaced.ok)
			.toBe(true)
		expect(removed.ok)
			.toBe(true)
		expect(traversed)
			.toMatchObject({ ok: false, failure: { code: 'path-not-traversable' } })
		expect(reads)
			.toBe(0)
	})

	it('patches frozen, sealed, and non-writable sources through copy-on-write reconstruction', () => {
		const frozen = Object.freeze({ arr: Object.freeze([1, 2]) })
		const sealed = Object.seal({ value: 1 })
		const nonWritable = {}
		Object.defineProperty(nonWritable, 'value', { value: 1, enumerable: true, writable: false, configurable: false })

		const frozenResult = applySourcePatch(frozen, [{ op: 'add', path: '/arr/-', value: 3 }])
		const sealedResult = applySourcePatch(sealed, [{ op: 'replace', path: '/value', value: 2 }])
		const nonWritableResult = applySourcePatch(nonWritable, [{ op: 'replace', path: '/value', value: 2 }])

		expect(frozenResult)
			.toMatchObject({ ok: true, value: { source: { arr: [1, 2, 3] } } })
		expect(sealedResult)
			.toMatchObject({ ok: true, value: { source: { value: 2 } } })
		expect(nonWritableResult)
			.toMatchObject({ ok: true, value: { source: { value: 2 } } })
	})

	it('recognizes an inverse patch as a structural no-op with opaque identity leaves', () => {
		const opaque = () => undefined
		const source = { opaque, nested: { value: 1 } }
		const result = applySourcePatch(source, [
			{ op: 'replace', path: '/nested/value', value: 2 },
			{ op: 'replace', path: '/nested/value', value: 1 },
		])

		expect(result)
			.toMatchObject({ ok: true, value: { changed: false } })
	})

	it('preserves untouched symbol descriptors while repairing an addressable sibling', () => {
		const symbol = Symbol('malformed')
		const source = { value: 1 }
		Object.defineProperty(source, symbol, { value: { opaque: true }, enumerable: false, configurable: false, writable: false })

		const result = applySourcePatch(source, [{ op: 'replace', path: '/value', value: 2 }])

		if (!result.ok)
			throw new Error('expected sibling replacement to succeed')
		expect(Object.getOwnPropertyDescriptor(result.value.source, symbol))
			.toEqual(Object.getOwnPropertyDescriptor(source, symbol))
	})

	it('rejects forged non-JSON operation operands at the patch boundary', () => {
		const forged = [{ op: 'add', path: '/value', value: () => undefined }] as unknown as Parameters<typeof applySourcePatch>[1]
		const result = applySourcePatch({ value: 1 }, forged)

		expect(result)
			.toMatchObject({ ok: false, failure: { code: 'json-incompatible-value', operationIndex: 0 } })
	})
})

type Patch = Parameters<typeof applySourcePatch>[1]

function patchOf(...operations: readonly Record<string, unknown>[]): Patch {
	return operations as unknown as Patch
}

describe('sourcePatch Array members are indexes only', () => {
	const arraySource = (): { items: unknown[] } => ({ items: [{ a: 1 }, 2] })
	const segments = ['length', 'foo', '01'] as const

	function invalidArrayIndex(operationIndex = 0) {
		return { ok: false, failure: { code: 'invalid-array-index', operationIndex } }
	}

	describe.each(segments)('segment %j', (segment) => {
		const pointer = `/items/${segment}`
		const forms = [
			['JSON Pointer', pointer, `${pointer}/a`],
			['structured', ['items', segment], ['items', segment, 'a']],
		] as const

		describe.each(forms)('%s', (_label, target, deep) => {
			it('fails every operation at the target position', () => {
				const patches: Patch[] = [
					patchOf({ op: 'add', path: target, value: 1 }),
					patchOf({ op: 'replace', path: target, value: 1 }),
					patchOf({ op: 'remove', path: target }),
					patchOf({ op: 'test', path: target, value: 2 }),
					patchOf({ op: 'copy', from: '/items/0', path: target }),
					patchOf({ op: 'move', from: '/items/0', path: target }),
				]
				for (const patch of patches) {
					expect(applySourcePatch(arraySource(), patch))
						.toMatchObject(invalidArrayIndex())
				}
			})

			it('fails every operation at the traversal position', () => {
				const patches: Patch[] = [
					patchOf({ op: 'add', path: deep, value: 1 }),
					patchOf({ op: 'replace', path: deep, value: 1 }),
					patchOf({ op: 'remove', path: deep }),
					patchOf({ op: 'test', path: deep, value: 1 }),
					patchOf({ op: 'copy', from: '/items/1', path: deep }),
					patchOf({ op: 'move', from: '/items/1', path: deep }),
				]
				for (const patch of patches) {
					expect(applySourcePatch(arraySource(), patch))
						.toMatchObject(invalidArrayIndex())
				}
			})

			it('fails copy and move at the from position', () => {
				for (const op of ['copy', 'move']) {
					expect(applySourcePatch(arraySource(), patchOf({ op, from: target, path: '/other' })))
						.toMatchObject(invalidArrayIndex())
					expect(applySourcePatch(arraySource(), patchOf({ op, from: deep, path: '/other' })))
						.toMatchObject(invalidArrayIndex())
				}
			})

			it('reports the failing operation index and leaves the source untouched', () => {
				const source = arraySource()
				const result = applySourcePatch(source, patchOf(
					{ op: 'add', path: '/ok', value: 1 },
					{ op: 'replace', path: target, value: 1 },
				))

				expect(result)
					.toMatchObject(invalidArrayIndex(1))
				expect(source)
					.toEqual(arraySource())
			})
		})
	})

	it('fails a structured `-` at every position on an Array', () => {
		const patches: Patch[] = [
			patchOf({ op: 'add', path: ['items', '-'], value: 1 }),
			patchOf({ op: 'replace', path: ['items', '-'], value: 1 }),
			patchOf({ op: 'remove', path: ['items', '-'] }),
			patchOf({ op: 'test', path: ['items', '-'], value: 1 }),
			patchOf({ op: 'copy', from: ['items', '-'], path: '/other' }),
			patchOf({ op: 'move', from: ['items', '-'], path: '/other' }),
			patchOf({ op: 'copy', from: '/items/0', path: ['items', '-'] }),
			patchOf({ op: 'move', from: '/items/0', path: ['items', '-'] }),
			patchOf({ op: 'add', path: ['items', '-', 'a'], value: 1 }),
		]
		for (const patch of patches) {
			expect(applySourcePatch(arraySource(), patch))
				.toMatchObject(invalidArrayIndex())
		}
	})

	it('does not read or create non-index members through length-like segments', () => {
		const source = arraySource()
		expect(applySourcePatch(source, patchOf({ op: 'test', path: '/items/length', value: 2 })))
			.toMatchObject(invalidArrayIndex())
		expect(applySourcePatch(source, patchOf({ op: 'copy', from: '/items/length', path: '/copied' })))
			.toMatchObject(invalidArrayIndex())
		expect(applySourcePatch(source, patchOf({ op: 'move', from: '/items/0', path: ['items', 'foo'] })))
			.toMatchObject(invalidArrayIndex())
		expect(source)
			.toEqual(arraySource())
	})

	it('rejects non-index segments on a recovery Array carrying an extra property, so repair goes through an ancestor', () => {
		const items: unknown[] = [1]
		Object.defineProperty(items, 'extra', { value: 'x', enumerable: true, configurable: true, writable: true })

		expect(applySourcePatch({ items }, patchOf({ op: 'remove', path: '/items/extra' })))
			.toMatchObject(invalidArrayIndex())
		const repaired = applySourcePatch({ items }, patchOf({ op: 'replace', path: '/items', value: [1] }))
		expect(repaired)
			.toEqual({ ok: true, value: { changed: true, source: { items: [1] } } })
	})

	it('keeps append JSON-Pointer-only, structured `-` an ordinary key on objects, and bounds checks unchanged', () => {
		expect(applySourcePatch(arraySource(), patchOf({ op: 'add', path: '/items/-', value: 3 })))
			.toMatchObject({ ok: true, value: { source: { items: [{ a: 1 }, 2, 3] } } })
		expect(applySourcePatch({ obj: { '-': 1 } }, patchOf({ op: 'replace', path: ['obj', '-'], value: 2 })))
			.toEqual({ ok: true, value: { changed: true, source: { obj: { '-': 2 } } } })
		expect(applySourcePatch({ obj: { '-': 1 } }, patchOf({ op: 'test', path: '/obj/-', value: 1 })))
			.toMatchObject({ ok: true, value: { changed: false } })
		expect(applySourcePatch(arraySource(), patchOf({ op: 'add', path: ['items', 2], value: 3 })))
			.toMatchObject({ ok: true, value: { source: { items: [{ a: 1 }, 2, 3] } } })
		expect(applySourcePatch(arraySource(), patchOf({ op: 'add', path: ['items', 3], value: 3 })))
			.toMatchObject(invalidArrayIndex())
		expect(applySourcePatch(arraySource(), patchOf({ op: 'replace', path: '/items/2', value: 3 })))
			.toMatchObject(invalidArrayIndex())
		expect(applySourcePatch(arraySource(), patchOf({ op: 'remove', path: ['items', 1.5] })))
			.toMatchObject(invalidArrayIndex())
	})
})

describe('sourcePatch SameValueZero numbers', () => {
	it('treats replacing 0 with -0 as a no-op that leaves the source untouched', () => {
		const source = { a: 0 }
		const result = applySourcePatch(source, patchOf({ op: 'replace', path: '/a', value: -0 }))

		expect(result)
			.toMatchObject({ ok: true, value: { changed: false } })
		expect(Object.is(source.a, 0))
			.toBe(true)
	})

	it('treats replacing a pre-existing -0 with 0 as a no-op that keeps the -0', () => {
		const source = { a: -0 }
		const result = applySourcePatch(source, patchOf({ op: 'replace', path: '/a', value: 0 }))

		expect(result)
			.toMatchObject({ ok: true, value: { changed: false } })
		expect(Object.is(source.a, -0))
			.toBe(true)
	})

	it('passes test for 0 against -0 in either direction', () => {
		expect(applySourcePatch({ a: 0 }, patchOf({ op: 'test', path: '/a', value: -0 })))
			.toMatchObject({ ok: true, value: { changed: false } })
		expect(applySourcePatch({ a: -0 }, patchOf({ op: 'test', path: '/a', value: 0 })))
			.toMatchObject({ ok: true, value: { changed: false } })
		expect(applySourcePatch({ a: [{ b: -0 }] }, patchOf({ op: 'test', path: '/a', value: [{ b: 0 }] })))
			.toMatchObject({ ok: true })
		expect(applySourcePatch({ a: 0 }, patchOf({ op: 'test', path: '/a', value: 1 })))
			.toMatchObject({ ok: false, failure: { code: 'test-failed', operationIndex: 0 } })
	})

	it('writes +0 when a multi-op patch commits an explicit -0 operand', () => {
		const result = applySourcePatch({ a: 0, b: 1 }, patchOf(
			{ op: 'replace', path: '/a', value: -0 },
			{ op: 'replace', path: '/b', value: 2 },
			{ op: 'add', path: '/c', value: -0 },
		))

		if (!result.ok)
			throw new Error('expected the patch to succeed')
		const patched = result.value.source as { a: number, b: number, c: number }
		expect(result.value.changed)
			.toBe(true)
		expect(patched.b)
			.toBe(2)
		expect(Object.is(patched.a, 0))
			.toBe(true)
		expect(Object.is(patched.c, 0))
			.toBe(true)
	})

	it('writes +0 when an explicit 0 replaces an existing -0 in a committing patch', () => {
		const result = applySourcePatch({ a: -0, b: 1 }, patchOf(
			{ op: 'replace', path: '/a', value: 0 },
			{ op: 'replace', path: '/b', value: 2 },
		))

		if (!result.ok)
			throw new Error('expected the patch to succeed')
		expect(result.value.changed)
			.toBe(true)
		expect(Object.is((result.value.source as { a: number }).a, 0))
			.toBe(true)
	})

	it('canonicalizes -0 at every depth of an explicit operand without mutating the operand', () => {
		const operand = { x: [-0, { y: -0 }], z: -0 }
		const result = applySourcePatch({}, patchOf({ op: 'add', path: '/n', value: operand }))

		if (!result.ok)
			throw new Error('expected the patch to succeed')
		const patched = (result.value.source as { n: { x: [number, { y: number }], z: number } }).n
		expect(Object.is(patched.x[0], 0))
			.toBe(true)
		expect(Object.is(patched.x[1].y, 0))
			.toBe(true)
		expect(Object.is(patched.z, 0))
			.toBe(true)
		expect(Object.is(operand.z, -0))
			.toBe(true)
		expect(Object.is(operand.x[0], -0))
			.toBe(true)
	})

	it('detects a nested -0 operand over a nested 0 as a no-op', () => {
		const source = { n: { x: [0, { y: 0 }] } }
		const result = applySourcePatch(source, patchOf({ op: 'replace', path: '/n', value: { x: [-0, { y: -0 }] } }))

		expect(result)
			.toMatchObject({ ok: true, value: { changed: false } })
	})

	it('relocates an existing -0 unchanged with copy and move', () => {
		const copied = applySourcePatch({ a: -0, nested: [-0] }, patchOf(
			{ op: 'copy', from: '/a', path: '/b' },
			{ op: 'copy', from: '/nested', path: '/nestedCopy' },
		))
		const moved = applySourcePatch({ a: -0 }, patchOf({ op: 'move', from: '/a', path: '/b' }))

		if (!copied.ok || !moved.ok)
			throw new Error('expected both patches to succeed')
		const copiedSource = copied.value.source as { a: number, b: number, nestedCopy: number[] }
		expect(Object.is(copiedSource.b, -0))
			.toBe(true)
		expect(Object.is(copiedSource.nestedCopy[0], -0))
			.toBe(true)
		expect(Object.is((moved.value.source as { b: number }).b, -0))
			.toBe(true)
	})

	it('keeps Document revision and source unchanged for a +0/-0-only replace', () => {
		const plugin = createWidgetPlugin('panel')
			.description('A panel')
			.interfaces<Record<never, never>>()
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const source = { type: 'panel', config: { a: -0 } }
		const document = createWidgetDocument({ system, source })

		const result = document.applyPatch([{ op: 'replace', path: '/config/a', value: 0 }])

		expect(result)
			.toEqual({ ok: true, changed: false })
		expect(document.getSnapshot().revision)
			.toBe(0)
		expect(Object.is((document.getSnapshot().blueprint.source as typeof source).config.a, -0))
			.toBe(true)
	})
})

describe('sourcePatch non-JSON operands', () => {
	function throwingProxy(): unknown {
		return new Proxy({}, {
			getPrototypeOf() {
				throw new Error('boom')
			},
		})
	}

	function cyclic(): unknown {
		const value: Record<string, unknown> = {}
		value.self = value
		return value
	}

	function accessor(): unknown {
		return Object.defineProperty({}, 'x', { get: () => 1, enumerable: true })
	}

	function sparse(): unknown {
		// eslint-disable-next-line no-sparse-arrays
		return [1, , 3]
	}

	function arrayWithExtra(): unknown {
		return Object.assign([1], { extra: true })
	}

	function symbolKeyed(): unknown {
		return { [Symbol('k')]: 1 }
	}

	const kinds: readonly (readonly [string, unknown])[] = [
		['undefined', undefined],
		['function', () => undefined],
		['bigint', 1n],
		['symbol', Symbol('s')],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['-Infinity', Number.NEGATIVE_INFINITY],
		['cycle', cyclic()],
		['Date', new Date(0)],
		['Map', new Map()],
		['class instance', new (class Foo {})()],
		['sparse Array', sparse()],
		['Array with extra property', arrayWithExtra()],
		['accessor', accessor()],
		['symbol key', symbolKeyed()],
		['throwing reflection', throwingProxy()],
		['nested NaN', { deep: [{ n: Number.NaN }] }],
	]

	describe.each(kinds)('%s operand', (_label, operand) => {
		it.each(['add', 'replace', 'test'])('fails %s with json-incompatible-value', (op) => {
			const source = { a: 1 }
			const result = applySourcePatch(source, patchOf(
				{ op: 'test', path: '/a', value: 1 },
				{ op, path: '/a', value: operand },
			))

			expect(result)
				.toMatchObject({ ok: false, failure: { code: 'json-incompatible-value', operationIndex: 1 } })
			expect(source)
				.toEqual({ a: 1 })
		})
	})

	it.each(['add', 'replace', 'test'])('fails %s with a missing value', (op) => {
		expect(applySourcePatch({ a: 1 }, patchOf({ op, path: '/a' })))
			.toMatchObject({ ok: false, failure: { code: 'json-incompatible-value', operationIndex: 0 } })
	})

	it('checks operands before evaluating the operation', () => {
		expect(applySourcePatch({}, patchOf({ op: 'replace', path: '/missing/deep', value: Number.NaN })))
			.toMatchObject({ ok: false, failure: { code: 'json-incompatible-value', operationIndex: 0 } })
		expect(applySourcePatch({ a: 1 }, patchOf({ op: 'test', path: '/missing', value: undefined })))
			.toMatchObject({ ok: false, failure: { code: 'json-incompatible-value', operationIndex: 0 } })
	})

	it('still reports path-shape failures before operand inspection', () => {
		expect(applySourcePatch({}, patchOf({ op: 'add', path: 'no-slash', value: Number.NaN })))
			.toMatchObject({ ok: false, failure: { code: 'invalid-path', operationIndex: 0 } })
	})

	it('keeps source-access-failed for unsafe access to source material', () => {
		const source = new Proxy({}, {
			getPrototypeOf() {
				throw new Error('boom')
			},
		})

		expect(applySourcePatch(source, patchOf({ op: 'replace', path: '/a', value: 1 })))
			.toMatchObject({ ok: false, failure: { code: 'source-access-failed', operationIndex: 0 } })
	})

	it('keeps malformed operation shapes as invalid-path', () => {
		expect(applySourcePatch({}, patchOf({ op: 'bogus', path: '/a' })))
			.toMatchObject({ ok: false, failure: { code: 'invalid-path', operationIndex: 0 } })
		expect(applySourcePatch({}, patchOf({ path: '/a' })))
			.toMatchObject({ ok: false, failure: { code: 'invalid-path', operationIndex: 0 } })
		expect(applySourcePatch({}, patchOf({ op: 'add', value: 1 })))
			.toMatchObject({ ok: false, failure: { code: 'invalid-path', operationIndex: 0 } })
	})
})
