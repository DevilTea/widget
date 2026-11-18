/**
 * The host's side of the async work, against a real Core Runtime and a scheduler the test fires by hand (no timers, no
 * sleeps): the host hears `slotRequested`, waits for the office, writes the answer back through `settleBooking`, recalls
 * a cancelled request when it can, relies on the ticket when it cannot, and delivers nothing once the Runtime is gone.
 */

import type { CancelScheduled, Scheduler } from '../booking-office'
import type { OnboardingRuntime } from '../system'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { OFFICE_DELAY_MS } from '../booking-office'
import { createPresetRuntime, widgetsOf } from '../test-support'
import { createOnboardingHost } from './onboarding-host'

/** A scheduler whose callbacks run only when the test says so. */
function createManualScheduler() {
	const scheduled: { readonly callback: () => void, readonly milliseconds: number, cancelled: boolean, fired: boolean }[] = []
	const scheduler: Scheduler = {
		after: (callback, milliseconds) => {
			const entry = { callback, milliseconds, cancelled: false, fired: false }
			scheduled.push(entry)
			const cancel: CancelScheduled = () => {
				entry.cancelled = true
			}
			return cancel
		},
	}
	return {
		scheduler,
		scheduled,
		/** Fires every callback that is still live, in order, as the passing of time would. */
		fireAll: () => {
			for (const entry of scheduled) {
				if (!entry.cancelled && !entry.fired) {
					entry.fired = true
					entry.callback()
				}
			}
		},
		live: () => scheduled.filter(entry => !entry.cancelled && !entry.fired).length,
	}
}

function setup(preset = 'onboarding-ready-to-book') {
	const { runtime } = createPresetRuntime(preset)
	const widgets = widgetsOf(runtime)
	const timers = createManualScheduler()
	const { host, dispose } = createOnboardingHost(runtime, { scheduler: timers.scheduler })
	return { runtime, ...widgets, timers, host, dispose }
}

const kinds = (host: ReturnType<typeof setup>['host']): string[] => host.activity.value.map(entry => entry.kind)

describe('the host answers a slot request', () => {
	it('asks the office when it hears slotRequested, and writes a confirmed answer back through settleBooking', () => {
		const { induction, timers, host } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		// Core returned at once; the booking is waiting, in State, and the host holds the only timer.
		expect(induction.state.status.get())
			.toBe('requesting')
		expect(host.pending.value)
			.toEqual([{ ticket: 1, date: '2026-12-05', time: '10:00', phase: 'waiting', orphaned: false }])
		expect(timers.scheduled)
			.toHaveLength(1)
		expect(timers.scheduled[0]!.milliseconds)
			.toBe(OFFICE_DELAY_MS)
		timers.fireAll()
		expect(induction.state.status.get())
			.toBe('confirmed')
		expect(induction.state.reference.get())
			.toBe('TM-20261205-1000')
		expect(host.pending.value)
			.toEqual([])
		expect(kinds(host))
			.toEqual(['slot-requested', 'office-answered', 'answer-applied'])
	})

	it('writes a declined answer back for the 17:00 slot, and the visitor can ask for another', () => {
		const { induction, timers, host } = setup()
		induction.methods.requestSlot('2026-12-05', '17:00')
		timers.fireAll()
		expect(induction.state.status.get())
			.toBe('declined')
		expect(induction.state.reason.get())
			.toBe('fully-booked')
		expect(induction.methods.requestSlot('2026-12-05', '14:00').ok)
			.toBe(true)
		expect(host.pending.value.map(entry => entry.ticket))
			.toEqual([2])
	})

	it('holds the answer while "hold" is on and lets it through on answerNow, or when hold is turned off', async () => {
		const { induction, timers, host } = setup()
		host.hold.value = true
		induction.methods.requestSlot('2026-12-05', '10:00')
		expect(timers.scheduled)
			.toHaveLength(0)
		expect(host.pending.value[0]?.phase)
			.toBe('held')
		host.answerNow(1)
		expect(induction.state.status.get())
			.toBe('confirmed')
		expect(host.pending.value)
			.toEqual([])

		induction.methods.cancelBooking()
		induction.methods.requestSlot('2026-12-12', '14:00')
		expect(host.pending.value[0]?.phase)
			.toBe('held')
		host.hold.value = false
		await nextTick()
		expect(timers.live())
			.toBe(1)
		timers.fireAll()
		expect(induction.state.reference.get())
			.toBe('TM-20261212-1400')
	})
})

describe('the host and a cancelled request', () => {
	it('recalls the request when the office can: the timer is cancelled and no answer is ever written', () => {
		const { induction, timers, host } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		induction.methods.cancelBooking()
		expect(timers.live())
			.toBe(0)
		expect(host.pending.value)
			.toEqual([])
		timers.fireAll()
		expect(induction.state.status.get())
			.toBe('idle')
		expect(kinds(host))
			.toEqual(['slot-requested', 'recalled'])
	})

	it('ignores the late answer when the office cannot recall: the ticket is no longer the newest', () => {
		const { induction, timers, host } = setup()
		host.recall.value = false
		induction.methods.requestSlot('2026-12-05', '10:00')
		induction.methods.cancelBooking()
		expect(host.pending.value)
			.toEqual([{ ticket: 1, date: '2026-12-05', time: '10:00', phase: 'waiting', orphaned: true }])
		induction.methods.requestSlot('2026-12-12', '14:00')
		// The answer to request 1 arrives while request 2 is the one that matters.
		timers.scheduled[0]!.fired = true
		timers.scheduled[0]!.callback()
		expect(induction.state.status.get())
			.toBe('requesting')
		expect(induction.state.reference.get())
			.toBeNull()
		expect(induction.state.ticket.get())
			.toBe(2)
		expect(kinds(host))
			.toEqual(['slot-requested', 'not-recalled', 'slot-requested', 'office-answered', 'answer-ignored'])
		// Request 2 still completes normally.
		timers.fireAll()
		expect(induction.state.status.get())
			.toBe('confirmed')
		expect(induction.state.reference.get())
			.toBe('TM-20261212-1400')
	})

	it('records that a confirmed booking was released, without waiting for anything', () => {
		const { induction, timers, host } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		timers.fireAll()
		induction.methods.cancelBooking()
		expect(kinds(host)
			.at(-1))
			.toBe('slot-released')
		expect(timers.live())
			.toBe(0)
	})
})

describe('the host and the end of the Runtime', () => {
	it('cancels every pending request when the Runtime is disposed and never writes to it afterwards', () => {
		const { runtime, induction, timers, host } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		expect(timers.live())
			.toBe(1)
		runtime.dispose()
		expect(timers.live())
			.toBe(0)
		expect(host.pending.value)
			.toEqual([])
		// Even a callback that could not be cancelled (a promise that takes no signal) does nothing.
		expect(() => timers.scheduled[0]!.callback())
			.not
			.toThrow()
		expect(kinds(host))
			.toEqual(['slot-requested'])
	})

	it('cancels every pending request on dispose() (the component unmounting) and stops listening', () => {
		const { runtime, induction, timers, host, dispose } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		dispose()
		expect(timers.live())
			.toBe(0)
		expect(() => timers.scheduled[0]!.callback())
			.not
			.toThrow()
		expect(induction.state.status.get())
			.toBe('requesting')
		// Events after the host is gone are not heard.
		induction.methods.cancelBooking()
		expect(kinds(host))
			.toEqual(['slot-requested'])
		expect(runtime.isDisposed)
			.toBe(false)
		dispose()
	})

	it('does not throw when the uncancellable answer arrives after the Runtime was disposed', () => {
		const { runtime, induction, timers, host } = setup()
		host.recall.value = false
		induction.methods.requestSlot('2026-12-05', '10:00')
		const [entry] = timers.scheduled
		// An office that ignores cancellation: the callback is kept alive even though the host cancelled its handle.
		runtime.dispose()
		expect(() => entry!.callback())
			.not
			.toThrow()
		expect(kinds(host))
			.toEqual(['slot-requested'])
	})

	it('resetAll forgets every request in flight before the tickets start again from 0', () => {
		const { runtime, induction, timers, host } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		host.resetAll()
		expect(timers.live())
			.toBe(0)
		expect(host.pending.value)
			.toEqual([])
		expect(induction.state.ticket.get())
			.toBe(0)
		expect(runtime.isDisposed)
			.toBe(false)
	})
})

describe('the host and the other Events', () => {
	it('tells the renderer which step was entered, with a nonce that changes on every move, and queues the welcome message', () => {
		const { runtime, root, induction, timers, host } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		timers.fireAll()
		root.methods.goTo(0)
		const first = host.lastStepChange.value
		expect(first?.change)
			.toMatchObject({ from: 'induction', to: 'account', by: 'back' })
		root.methods.goTo(3)
		expect(host.lastStepChange.value?.nonce)
			.toBeGreaterThan(first!.nonce)
		root.methods.finish()
		expect(kinds(host)
			.at(-1))
			.toBe('welcome-queued')
		expect(host.activity.value.at(-1)?.values)
			.toEqual({ email: 'sam@example.org' })
		expect(runtime.isDisposed)
			.toBe(false)
	})
})

describe('a runtime that is already gone', () => {
	it('creates a host that does nothing', () => {
		const { runtime } = createPresetRuntime('onboarding-default') as { runtime: OnboardingRuntime }
		runtime.dispose()
		const { host } = createOnboardingHost(runtime)
		expect(host.pending.value)
			.toEqual([])
	})
})
