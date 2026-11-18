/**
 * The simulated booking office: the "backend" the page asks to book an induction slot.
 *
 * It is a stand-in for a network request and is deliberately deterministic and clock-free:
 * - what it answers is a pure function of the request (`officeAnswer`): the 17:00 slot is always fully booked, every
 *   other slot is confirmed with a reference made from the slot;
 * - when it answers is decided by whoever drives it, through a `Scheduler`. The Preview uses `realScheduler`
 *   (`setTimeout`), a test provides a scheduler it fires by hand, so no test sleeps.
 *
 * Nothing here knows Core. The office belongs to the host (the page), never to a widget: a widget cannot wait for it.
 */

import type { BookingOutcome, SlotRequest } from './domain'

/** Cancels a scheduled callback; safe to call more than once. */
export type CancelScheduled = () => void

/** How the host waits: `after(callback, milliseconds)` runs `callback` later, once, unless cancelled. */
export interface Scheduler {
	readonly after: (callback: () => void, milliseconds: number) => CancelScheduled
}

export const realScheduler: Scheduler = {
	after: (callback, milliseconds) => {
		const handle = setTimeout(callback, milliseconds)
		return () => clearTimeout(handle)
	},
}

/** How long the office takes to answer when it is not held: long enough to see the request wait. */
export const OFFICE_DELAY_MS = 1500

/** The start time at which the office is always fully booked. */
export const OFFICE_FULL_TIME = '17:00'

/** The reason the office gives when a slot is full. */
export const OFFICE_FULL_REASON = 'fully-booked'

/** The booking reference of a confirmed slot, e.g. `TM-20261205-1000`. */
export function bookingReference(date: string, time: string): string {
	return `TM-${date.replaceAll('-', '')}-${time.replace(':', '')}`
}

/** What the office answers for `request`. */
export function officeAnswer(request: SlotRequest): BookingOutcome {
	return request.time === OFFICE_FULL_TIME
		? { status: 'declined', reason: OFFICE_FULL_REASON }
		: { status: 'confirmed', reference: bookingReference(request.date, request.time) }
}
