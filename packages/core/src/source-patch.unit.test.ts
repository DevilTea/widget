import { describe, expect, it } from 'vitest'
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

	it('rejects final `-` for non-add-like operations while keeping structured `-` ordinary', () => {
		const replace = applySourcePatch({ arr: [1] }, [
			{ op: 'replace', path: '/arr/-', value: 2 },
		])
		const structured = applySourcePatch({ arr: [1] }, [
			{ op: 'add', path: ['arr', '-'], value: 2 },
		])

		expect(replace)
			.toMatchObject({ ok: false, failure: { code: 'invalid-array-index', operationIndex: 0 } })
		expect(structured)
			.toMatchObject({ ok: true, value: { source: { arr: expect.objectContaining({}) } } })
		if (structured.ok) {
			const patched = structured.value.source as { arr: object }
			expect(Object.hasOwn(patched.arr, '-'))
				.toBe(true)
		}
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

		if (!numeric.ok || !named.ok)
			throw new Error('expected both structured paths to succeed')
		const numericSource = numeric.value.source as { arr: (number | string)[] }
		const namedSource = named.value.source as { arr: (number | string)[] }
		expect(Array.from(numericSource.arr))
			.toEqual([20, 10])
		expect(Object.getOwnPropertyDescriptor(numericSource.arr, '01')?.value)
			.toBe('named')
		expect(Array.from(namedSource.arr))
			.toEqual([10])
		expect(Object.getOwnPropertyDescriptor(namedSource.arr, '01')?.value)
			.toBe('renamed')
	})

	it('treats canonical structured string keys as Array indexes while keeping noncanonical strings ordinary', () => {
		const source = { arr: ['zero', 'one', 'two'] }
		Object.defineProperty(source.arr, '01', { value: 'named', enumerable: true, configurable: true, writable: true })

		const canonical = applySourcePatch(source, [{ op: 'remove', path: ['arr', '1'] }])
		const noncanonical = applySourcePatch(source, [{ op: 'replace', path: ['arr', '01'], value: 'renamed' }])

		if (!canonical.ok || !noncanonical.ok)
			throw new Error('expected both structured paths to succeed')
		const canonicalArray = (canonical.value.source as { arr: string[] }).arr
		expect(Array.from(canonicalArray))
			.toEqual(['zero', 'two'])
		const patched = noncanonical.value.source as { arr: string[] }
		expect(Array.from(patched.arr))
			.toEqual(['zero', 'one', 'two'])
		expect(Object.getOwnPropertyDescriptor(patched.arr, '01')?.value)
			.toBe('renamed')
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
			.toMatchObject({ ok: false, failure: { code: 'source-access-failed', operationIndex: 0 } })
	})
})
