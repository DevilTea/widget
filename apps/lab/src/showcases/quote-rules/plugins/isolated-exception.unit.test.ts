/**
 * The deliberate defect of `VolumeDiscount` and how Core routes it, against a REAL Runtime built from the actual
 * `quote-buggy-rule` preset (volume tiers start at 100; flyers 120 + poster 2 = 122 pieces, so it prices fine).
 *
 * Core's contract (guide, "Receiving isolated errors"): a Property `compute` that throws while a *subscription*
 * recomputes it never breaks the writer, the other subscribers are still notified, and the exception is handed to
 * the host's isolated-error handler exactly once, or rethrown in a microtask when there is none. A direct `get()`
 * rethrows. Nothing here mocks Core; the default route is observed by capturing the `queueMicrotask` call.
 */

import { setIsolatedErrorHandler } from '@deviltea/widget-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findThrowingMember, readQuoteOutcome } from '../evaluate'
import { createQuoteRuntime, presetText, valueOf, widgetOfType } from '../test-support'

afterEach(() => {
	setIsolatedErrorHandler(null)
	vi.restoreAllMocks()
})

function setup() {
	const { runtime } = createQuoteRuntime(presetText('quote-buggy-rule'))
	return {
		runtime,
		quote: widgetOfType(runtime, 'quote', 'Quote'),
		flyers: widgetOfType(runtime, 'flyers', 'Item'),
		volume: widgetOfType(runtime, 'volume', 'VolumeDiscount'),
	}
}

describe('a rule that throws while a subscription recomputes it', () => {
	it('prices fine while the total quantity reaches the first tier (122 >= 100)', () => {
		const { quote } = setup()
		// 120 x 9 + 2 x 1450 = 3980; 5% = 199 off; taxable 3781; tax 21% = 794.01 -> 794; total 4575
		expect(valueOf(quote.properties.quote.get()))
			.toMatchObject({ subtotalCents: 3980, totalCents: 4575 })
	})

	it('hands exactly one exception to the handler, and the write that caused it still succeeds', () => {
		const { quote, flyers, volume } = setup()
		const reported: unknown[] = []
		setIsolatedErrorHandler(error => reported.push(error))
		const quoteNotifications: unknown[] = []
		const answersNotifications: unknown[] = []
		quote.properties.quote.subscribe(result => quoteNotifications.push(result))
		volume.properties.adjustment.subscribe(() => {})
		quote.properties.answers.subscribe(result => answersNotifications.push(result))

		const write = flyers.state.quantity.set(50)

		expect(write.ok)
			.toBe(true)
		expect(flyers.state.quantity.get())
			.toBe(50)
		// Two subscriptions re-read the same cached exception (the rule's own and its dependent's): one report.
		expect(reported)
			.toHaveLength(1)
		expect(reported[0])
			.toBeInstanceOf(TypeError)
		expect((reported[0] as TypeError).message)
			.toContain('percent')
		// The subscriptions that threw are skipped for this recompute; the one that did not is still notified.
		expect(quoteNotifications)
			.toHaveLength(0)
		expect(answersNotifications)
			.toHaveLength(1)
	})

	it('rethrows from a direct get() (the same object the handler received), and says which widget it was', () => {
		const { runtime, quote, flyers, volume } = setup()
		const reported: unknown[] = []
		setIsolatedErrorHandler(error => reported.push(error))
		volume.properties.adjustment.subscribe(() => {})
		flyers.state.quantity.set(50)

		let thrown: unknown
		try {
			quote.properties.quote.get()
		}
		catch (error) {
			thrown = error
		}
		expect(thrown)
			.toBe(reported[0])
		// The handler is given only the exception: the widget is found by reading each rule again.
		expect(findThrowingMember(runtime, reported[0]))
			.toEqual({ widgetId: 'volume', member: 'adjustment' })
		expect(findThrowingMember(runtime, new Error('not ours')))
			.toBeNull()
	})

	it('reports the exception as an outcome, not as a throw', () => {
		const { runtime, flyers } = setup()
		flyers.state.quantity.set(50)
		const outcome = readQuoteOutcome(runtime)
		expect(outcome.ok)
			.toBe(false)
		expect(!outcome.ok && outcome.failure)
			.toMatchObject({ kind: 'exception', widgetId: 'volume', member: 'adjustment', name: 'TypeError' })
	})

	it('resumes when a later recompute succeeds, without a second report', () => {
		const { quote, flyers, volume } = setup()
		const reported: unknown[] = []
		setIsolatedErrorHandler(error => reported.push(error))
		const seen: unknown[] = []
		quote.properties.quote.subscribe(result => seen.push(result))
		volume.properties.adjustment.subscribe(() => {})

		flyers.state.quantity.set(50)
		expect(seen)
			.toHaveLength(0)
		flyers.state.quantity.set(300)

		expect(reported)
			.toHaveLength(1)
		expect(seen)
			.toHaveLength(1)
		// 300 x 9 + 2 x 1450 = 5600; 5% = 280 off
		expect(valueOf(quote.properties.quote.get()).adjustments[0])
			.toMatchObject({ id: 'volume', cents: -280 })
	})

	it('is reported when the subscription is made, if the document already starts below the first tier', () => {
		const { runtime } = createQuoteRuntime(presetText('quote-buggy-rule')
			.replace('"quantity": 120', '"quantity": 10'))
		const reported: unknown[] = []
		setIsolatedErrorHandler(error => reported.push(error))
		widgetOfType(runtime, 'volume', 'VolumeDiscount').properties.adjustment.subscribe(() => {})
		expect(reported)
			.toHaveLength(1)
	})

	it('goes to a queued microtask, an uncaught error on the page, when no handler is installed', () => {
		const queued: (() => void)[] = []
		vi.spyOn(globalThis, 'queueMicrotask')
			.mockImplementation((callback) => {
				queued.push(callback)
			})
		const { flyers, volume } = setup()
		volume.properties.adjustment.subscribe(() => {})
		expect(flyers.state.quantity.set(50).ok)
			.toBe(true)
		expect(queued)
			.toHaveLength(1)
	})

	it('puts back the handler it replaced', () => {
		const first = (): void => {}
		setIsolatedErrorHandler(first)
		const second = (): void => {}
		expect(setIsolatedErrorHandler(second))
			.toBe(first)
		expect(setIsolatedErrorHandler(first))
			.toBe(second)
	})
})
