import { beforeEach, describe, expect, it } from 'vitest'
import {
	isTourCompleted,
	isWelcomeDismissed,
	markTourCompleted,
	markWelcomeDismissed,
} from './session-flags'

/**
 * A tiny in-memory `Storage` fake — isolates each test from the real global `sessionStorage` (which
 * would otherwise leak state across test files/runs in the same happy-dom instance).
 */
function createFakeStorage(): Storage {
	const values = new Map<string, string>()
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => { values.set(key, value) },
		removeItem: (key) => { values.delete(key) },
		clear: () => values.clear(),
		key: index => Array.from(values.keys())[index] ?? null,
		get length() { return values.size },
	}
}

describe('tutorial session flags', () => {
	let storage: Storage

	beforeEach(() => {
		storage = createFakeStorage()
	})

	it('welcome starts undismissed', () => {
		expect(isWelcomeDismissed(storage))
			.toBe(false)
	})

	it('markWelcomeDismissed() makes isWelcomeDismissed() true, and it never reverts on its own', () => {
		markWelcomeDismissed(storage)
		expect(isWelcomeDismissed(storage))
			.toBe(true)
		expect(isWelcomeDismissed(storage))
			.toBe(true)
	})

	it('a tour starts uncompleted', () => {
		expect(isTourCompleted('survey', storage))
			.toBe(false)
		expect(isTourCompleted('crm', storage))
			.toBe(false)
	})

	it('markTourCompleted(tourId) makes isTourCompleted(tourId) true', () => {
		markTourCompleted('survey', storage)
		expect(isTourCompleted('survey', storage))
			.toBe(true)
	})

	it('each tour id has its own independent completed flag', () => {
		markTourCompleted('survey', storage)
		expect(isTourCompleted('survey', storage))
			.toBe(true)
		expect(isTourCompleted('crm', storage))
			.toBe(false)

		markTourCompleted('crm', storage)
		expect(isTourCompleted('survey', storage))
			.toBe(true)
		expect(isTourCompleted('crm', storage))
			.toBe(true)
	})

	it('welcome-dismissed and tour-completed are independent flags', () => {
		markTourCompleted('survey', storage)
		expect(isWelcomeDismissed(storage))
			.toBe(false)

		markWelcomeDismissed(storage)
		expect(isTourCompleted('survey', storage))
			.toBe(true)
	})

	it('a fresh storage (simulating a new browser session) reports every flag unset', () => {
		markWelcomeDismissed(storage)
		markTourCompleted('survey', storage)
		markTourCompleted('crm', storage)

		const freshSessionStorage = createFakeStorage()
		expect(isWelcomeDismissed(freshSessionStorage))
			.toBe(false)
		expect(isTourCompleted('survey', freshSessionStorage))
			.toBe(false)
		expect(isTourCompleted('crm', freshSessionStorage))
			.toBe(false)
	})
})
