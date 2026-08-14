/**
 * Direct unit tests for `createLazyKeyedSurface`, the collision-safe lazy keyed-Proxy primitive
 * shared by every `useXxx()` capability accessor.
 */

import { describe, expect, it, vi } from 'vitest'
import { createLazyKeyedSurface } from './bridge'

describe('createLazyKeyedSurface', () => {
	it('materializes a string key exactly once and caches the result by identity', () => {
		const materialize = vi.fn((key: string) => ({ key }))
		const surface = createLazyKeyedSurface(materialize)

		const first = surface.foo
		const second = surface.foo
		expect(first)
			.toBe(second)
		expect(materialize)
			.toHaveBeenCalledTimes(1)
		expect(materialize)
			.toHaveBeenCalledWith('foo')
	})

	it('never caches a key with no backing member, matching plain-object "unknown property" behavior', () => {
		const materialize = vi.fn(() => undefined)
		const surface = createLazyKeyedSurface(materialize)

		expect(surface.missing)
			.toBeUndefined()
		expect(surface.missing)
			.toBeUndefined()
		expect(materialize)
			.toHaveBeenCalledTimes(2)
	})

	it('ignores symbol-keyed access entirely, never calling materialize', () => {
		const materialize = vi.fn((key: string) => key)
		const surface = createLazyKeyedSurface(materialize)
		const symbolKey = Symbol('probe')

		expect((surface as unknown as Record<symbol, unknown>)[symbolKey])
			.toBeUndefined()
		expect(materialize).not.toHaveBeenCalled()
	})

	it('reports every string key as present via the `has` trap, independent of materialize', () => {
		const surface = createLazyKeyedSurface(() => undefined)

		expect('anything' in surface)
			.toBe(true)
		expect('__proto__' in surface)
			.toBe(true)
	})

	it('stays collision-safe for `__proto__` and `constructor` keys', () => {
		const materialize = vi.fn((key: string) => key.toUpperCase())
		const surface = createLazyKeyedSurface(materialize)
		const protoKey = '__proto__' as const
		const ctorKey = 'constructor' as const

		expect(surface[protoKey])
			.toBe('__PROTO__')
		expect(surface[ctorKey])
			.toBe('CONSTRUCTOR')
	})
})
