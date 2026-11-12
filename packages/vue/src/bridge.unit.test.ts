/**
 * Direct unit tests for `createLazyKeyedSurface`, the collision-safe lazy keyed-Proxy primitive
 * shared by every `useXxx()` capability accessor.
 */

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
})
