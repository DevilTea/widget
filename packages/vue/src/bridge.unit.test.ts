/**
 * Direct unit tests for `createLazyKeyedSurface`, the collision-safe lazy keyed-surface primitive
 * shared by every `useXxx()` capability accessor.
 */

import { types } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { createLazyKeyedSurface } from './bridge'

function membersOf(...keys: string[]): object {
	const members = Object.create(null)
	for (const key of keys)
		Object.defineProperty(members, key, { value: true, enumerable: true })
	return members
}

describe('createLazyKeyedSurface', () => {
	it('materializes a declared key exactly once and caches the result by identity', () => {
		const materialize = vi.fn((key: string) => ({ key }))
		const surface = createLazyKeyedSurface(membersOf('foo'), materialize)

		const first = surface.foo
		const second = surface.foo
		expect(first)
			.toBe(second)
		expect(materialize)
			.toHaveBeenCalledTimes(1)
		expect(materialize)
			.toHaveBeenCalledWith('foo')
	})

	it('never materializes or caches a key that is not declared, matching plain-object "unknown property" behavior', () => {
		const materialize = vi.fn(() => undefined)
		const surface = createLazyKeyedSurface(membersOf('present'), materialize)

		expect(surface.missing)
			.toBeUndefined()
		expect(surface.missing)
			.toBeUndefined()
		expect(materialize).not.toHaveBeenCalled()
	})

	it('does not cache a declared key whose materialization yields undefined', () => {
		const materialize = vi.fn(() => undefined)
		const surface = createLazyKeyedSurface(membersOf('ghost'), materialize)

		expect(surface.ghost)
			.toBeUndefined()
		expect(surface.ghost)
			.toBeUndefined()
		expect(materialize)
			.toHaveBeenCalledTimes(2)
	})

	it('ignores symbol-keyed access entirely, never calling materialize', () => {
		const materialize = vi.fn((key: string) => key)
		const surface = createLazyKeyedSurface(membersOf('a'), materialize)
		const symbolKey = Symbol('probe')

		expect((surface as unknown as Record<symbol, unknown>)[symbolKey])
			.toBeUndefined()
		expect(symbolKey in surface)
			.toBe(false)
		expect(materialize).not.toHaveBeenCalled()
	})

	it('reports only declared keys through `in`, `Object.keys` and spread', () => {
		const surface = createLazyKeyedSurface(membersOf('a', 'b'), (key: string) => key.toUpperCase())

		expect('a' in surface)
			.toBe(true)
		expect('anything' in surface)
			.toBe(false)
		expect('__proto__' in surface)
			.toBe(false)
		expect(Object.keys(surface))
			.toEqual(['a', 'b'])
		expect({ ...surface })
			.toEqual({ a: 'A', b: 'B' })
	})

	it('lists keys without materializing anything', () => {
		const materialize = vi.fn((key: string) => key)
		const surface = createLazyKeyedSurface(membersOf('a', 'b'), materialize)

		void Object.keys(surface)
		void ('a' in surface)

		expect(materialize).not.toHaveBeenCalled()
	})

	it('stays collision-safe for `__proto__` and `constructor` keys', () => {
		const materialize = vi.fn((key: string) => key.toUpperCase())
		const surface = createLazyKeyedSurface(membersOf('__proto__', 'constructor'), materialize)
		const protoKey = '__proto__' as const
		const ctorKey = 'constructor' as const

		expect(surface[protoKey])
			.toBe('__PROTO__')
		expect(surface[ctorKey])
			.toBe('CONSTRUCTOR')
		expect(Object.keys(surface))
			.toEqual(['__proto__', 'constructor'])
	})

	describe('as an ordinary frozen object', () => {
		const protoKey = '__proto__' as const

		it('is a null-prototype object whose own enumerable properties are exactly the declared members', () => {
			const materialize = vi.fn((key: string) => ({ key }))
			const surface = createLazyKeyedSurface(membersOf('a', 'b', '__proto__'), materialize)

			expect(Object.getPrototypeOf(surface))
				.toBeNull()
			expect(types.isProxy(surface))
				.toBe(false)
			expect(Reflect.ownKeys(surface))
				.toEqual(['a', 'b', '__proto__'])
			expect(Object.keys(surface))
				.toEqual(['a', 'b', '__proto__'])
			expect(Object.hasOwn(surface, 'a'))
				.toBe(true)
			expect(Object.hasOwn(surface, 'zzz'))
				.toBe(false)
			expect(Object.entries(Object.getOwnPropertyDescriptors(surface))
				.every(([, descriptor]) => descriptor.enumerable === true))
				.toBe(true)
			expect(materialize).not.toHaveBeenCalled()
		})

		it('freezes, seals and prevents extensions without throwing, and stays enumerable and readable afterwards', () => {
			const materialize = vi.fn((key: string) => ({ key }))
			const surface = createLazyKeyedSurface(membersOf('a', 'b'), materialize)

			expect(() => Object.freeze(surface)).not.toThrow()
			expect(() => Object.seal(surface)).not.toThrow()
			expect(() => Object.preventExtensions(surface)).not.toThrow()
			expect(Object.isFrozen(surface))
				.toBe(true)
			expect(Object.keys(surface))
				.toEqual(['a', 'b'])
			expect(Object.keys(surface))
				.toEqual(['a', 'b'])
			expect(materialize).not.toHaveBeenCalled()
			expect(surface.a)
				.toBe(surface.a)
			expect(materialize)
				.toHaveBeenCalledTimes(1)
		})

		it('keeps enumeration working on a surface that had extensions prevented after a member was read', () => {
			const surface = createLazyKeyedSurface(membersOf('a', 'b'), (key: string) => ({ key }))
			const a = surface.a

			Object.preventExtensions(surface)

			expect(Object.keys(surface))
				.toEqual(['a', 'b'])
			expect({ ...surface }.a)
				.toBe(a)
		})

		it('fails loudly instead of writing somewhere hidden: assigning, adding, deleting and defining all throw', () => {
			const surface = createLazyKeyedSurface(membersOf('a'), (key: string) => ({ key })) as Record<string, unknown>

			expect(() => {
				surface.a = 1
			})
				.toThrow(TypeError)
			expect(() => {
				surface.q = 1
			})
				.toThrow(TypeError)
			expect(() => delete surface.a)
				.toThrow(TypeError)
			expect(() => Object.defineProperty(surface, 'q', { value: 1 }))
				.toThrow(TypeError)
			expect(() => Object.defineProperty(surface, 'a', { value: 1 }))
				.toThrow(TypeError)
			expect(() => Object.setPrototypeOf(surface, {}))
				.toThrow(TypeError)
			expect(Object.keys(surface))
				.toEqual(['a'])
			expect('q' in surface)
				.toBe(false)
			expect(surface.a)
				.toEqual({ key: 'a' })
		})

		it('materializes on first read only, by identity, even when read through a descriptor getter', () => {
			const materialize = vi.fn((key: string) => ({ key }))
			const surface = createLazyKeyedSurface(membersOf('a'), materialize)

			const descriptor = Object.getOwnPropertyDescriptor(surface, 'a')!
			expect(materialize).not.toHaveBeenCalled()
			expect(descriptor.get!())
				.toBe(surface.a)
			expect(materialize)
				.toHaveBeenCalledTimes(1)
		})

		it('behaves sanely for JSON.stringify, Object.assign, spread and structuredClone', () => {
			const surface = createLazyKeyedSurface(membersOf('a', 'b'), (key: string) => key.toUpperCase())

			expect(JSON.stringify(surface))
				.toBe('{"a":"A","b":"B"}')
			expect(Object.assign({}, surface))
				.toEqual({ a: 'A', b: 'B' })
			expect({ ...surface })
				.toEqual({ a: 'A', b: 'B' })
			expect(structuredClone({ ...surface }))
				.toEqual({ a: 'A', b: 'B' })
			// A surface itself is not structured-cloneable payload: accessors are read, then the result is a
			// plain object, never a hidden proxy target.
			expect(structuredClone(surface))
				.toEqual({ a: 'A', b: 'B' })
		})

		it('handles special member names: declared ones are members, undeclared ones are absent and the surface is not thenable', () => {
			const surface = createLazyKeyedSurface(membersOf('constructor', 'then', protoKey), (key: string) => `m:${key}`)
			const plain = createLazyKeyedSurface(membersOf('a'), (key: string) => key) as Record<string, unknown>

			expect(surface.constructor)
				.toBe('m:constructor')
			expect(surface.then)
				.toBe('m:then')
			expect(surface[protoKey])
				.toBe('m:__proto__')
			expect(Object.getPrototypeOf(surface))
				.toBeNull()
			expect(Object.keys(surface))
				.toEqual(['constructor', 'then', '__proto__'])

			for (const name of ['constructor', 'then', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'toJSON']) {
				expect(plain[name])
					.toBeUndefined()
				expect(name in plain)
					.toBe(false)
			}
		})
	})
})
