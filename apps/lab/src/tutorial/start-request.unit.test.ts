import { describe, expect, it } from 'vitest'
import { createStartRequestGuard } from './start-request'

describe('createStartRequestGuard', () => {
	it('starts idle', () => {
		const guard = createStartRequestGuard()
		expect(guard.getPhase())
			.toBe('idle')
	})

	it('a non-dirty request (no confirmation needed) goes straight to loading', () => {
		const guard = createStartRequestGuard()
		expect(guard.request(false))
			.toBe(true)
		expect(guard.getPhase())
			.toBe('loading')
	})

	it('a dirty request (confirmation needed) goes to confirming, not loading', () => {
		const guard = createStartRequestGuard()
		expect(guard.request(true))
			.toBe(true)
		expect(guard.getPhase())
			.toBe('confirming')
	})

	it('a second request while loading is a no-op — coalesced, not a second transaction', () => {
		const guard = createStartRequestGuard()
		expect(guard.request(false))
			.toBe(true)
		expect(guard.request(false))
			.toBe(false)
		expect(guard.request(true))
			.toBe(false)
		expect(guard.getPhase())
			.toBe('loading')
	})

	it('a second request while confirming is a no-op — a rapid double-click cannot open two confirmations', () => {
		const guard = createStartRequestGuard()
		expect(guard.request(true))
			.toBe(true)
		expect(guard.request(false))
			.toBe(false)
		expect(guard.getPhase())
			.toBe('confirming')
	})

	it('confirm() moves confirming -> loading, and is a no-op from any other phase', () => {
		const guard = createStartRequestGuard()
		expect(guard.confirm())
			.toBe(false)
		expect(guard.getPhase())
			.toBe('idle')

		guard.request(true)
		expect(guard.confirm())
			.toBe(true)
		expect(guard.getPhase())
			.toBe('loading')

		// Already loading — a stray second confirm() (e.g. a duplicate event) must not do anything odd.
		expect(guard.confirm())
			.toBe(false)
		expect(guard.getPhase())
			.toBe('loading')
	})

	it('cancel() moves confirming -> idle, releasing the guard for a fresh request', () => {
		const guard = createStartRequestGuard()
		guard.request(true)
		guard.cancel()
		expect(guard.getPhase())
			.toBe('idle')

		// Released: a fresh request is accepted, not coalesced.
		expect(guard.request(false))
			.toBe(true)
	})

	it('cancel() is a no-op while idle or loading — it never interrupts an in-flight load', () => {
		const guard = createStartRequestGuard()
		guard.cancel()
		expect(guard.getPhase())
			.toBe('idle')

		guard.request(false)
		guard.cancel()
		expect(guard.getPhase())
			.toBe('loading')
	})

	it('settle() returns to idle from loading, allowing a fresh request afterward', () => {
		const guard = createStartRequestGuard()
		guard.request(false)
		guard.settle()
		expect(guard.getPhase())
			.toBe('idle')
		expect(guard.request(false))
			.toBe(true)
	})

	it('settle() is safe to call defensively from any phase', () => {
		const guard = createStartRequestGuard()
		guard.settle()
		expect(guard.getPhase())
			.toBe('idle')

		guard.request(true)
		guard.settle()
		expect(guard.getPhase())
			.toBe('idle')
	})

	it('the full confirm-then-load-then-settle lifecycle allows exactly one request through at a time', () => {
		const guard = createStartRequestGuard()

		expect(guard.request(true))
			.toBe(true)
		// Rapid re-clicks during confirmation are all coalesced.
		expect(guard.request(true))
			.toBe(false)
		expect(guard.request(false))
			.toBe(false)

		expect(guard.confirm())
			.toBe(true)
		// Re-clicks during the async load are also coalesced.
		expect(guard.request(false))
			.toBe(false)

		guard.settle()
		expect(guard.getPhase())
			.toBe('idle')
		// Only now is a fresh request accepted.
		expect(guard.request(false))
			.toBe(true)
	})
})
