/**
 * `InductionStep`: step 4, booking an induction slot. It is where Core's boundary with asynchronous work shows.
 *
 * Booking takes time and needs a backend, and Core is synchronous: every callback runs to the end before anything
 * else happens, a returned Promise is a contract violation, and the `emit` and `deps` callables of a callback stop
 * working when it returns. So the widget never waits for anything. It records what it knows, in State, and tells the
 * host through Events; the host does the waiting and writes the answer back through a Method:
 *
 * 1. `requestSlot(date, time)` validates its arguments against the config (`invalid-method-arguments`), checks the
 *    booking is free to change (`invalid-method-result`), writes `status: 'requesting'` with a new `ticket` and
 *    emits `slotRequested({ ticket, date, time })`. That is all: it returns the ticket at once.
 * 2. The host listens to `slotRequested`, asks the (simulated) booking office, and, whenever the office answers,
 *    calls `settleBooking(ticket, outcome)`.
 * 3. `settleBooking` applies the answer only if it is still the newest request: the State must say `requesting` and
 *    the ticket must be the current one. Otherwise the answer is stale (the visitor cancelled, or asked again) and
 *    the Method returns `false` and changes and emits nothing.
 * 4. `cancelBooking()` gives the request or the booking up and emits `slotCancelled`; a host that can recall work
 *    does, and one that cannot is protected by the ticket.
 *
 * All three Methods write State and emit Events, so they are not read-only: a Property may not depend on them.
 */

import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InductionConfig, InductionRawConfig } from '../config'
import type { BookingOutcome, BookingStatus, I18nText, InductionAnswers, Slot, SlotCancelled, SlotConfirmation, SlotDeclined, SlotRequest } from '../domain'
import { createWidgetPlugin } from '@deviltea/widget-core'
import { checkInductionConfig, resolveInductionConfig } from '../config'
import { describeValue, isBookingOutcome, isBookingStatus, isBoolean, isIsoDate, isNullableSlot, isNumber, isTime } from '../domain'
import { inductionConfigSchema } from '../schemas'
import { checkInsideOnboarding } from './structure'

export interface InductionInterfaces extends WidgetInterfaces {
	config: { raw: InductionRawConfig, resolved: InductionConfig }
	state: {
		status: BookingStatus
		/** The ticket of the newest request; 0 before any. */
		ticket: number
		slot: Slot | null
		reference: string | null
		reason: string | null
	}
	properties: {
		title: I18nText
		offered: { readonly days: readonly string[], readonly times: readonly string[] }
		missing: readonly string[]
		complete: boolean
		answers: InductionAnswers
	}
	methods: {
		requestSlot: (date: string, time: string) => number
		settleBooking: (ticket: number, outcome: BookingOutcome) => boolean
		cancelBooking: () => number
	}
	events: {
		slotRequested: [request: SlotRequest]
		slotConfirmed: [confirmation: SlotConfirmation]
		slotDeclined: [declined: SlotDeclined]
		slotCancelled: [cancelled: SlotCancelled]
	}
}

export const InductionStepPlugin = createWidgetPlugin('InductionStep')
	.description('Step 4 of the onboarding wizard: booking an induction slot, with the work kept at the host. Methods: `requestSlot(date, time)` (validated against the config; writes the request into State and emits `slotRequested` with a ticket), `settleBooking(ticket, outcome)` (the host\'s answer; applied only if the ticket is still the newest, otherwise ignored) and `cancelBooking()` (emits `slotCancelled`); `requestSlot` and `cancelBooking` are refused once the wizard is finished. Events: `slotRequested`, `slotConfirmed`, `slotDeclined`, `slotCancelled`. State: `status`, `ticket`, `slot`, `reference`, `reason`.')
	.interfaces<InductionInterfaces>()
	.config({
		description: 'The step title and the days and start times offered. Whether the booking office still has room is not known here: the host asks it.',
		schema: inductionConfigSchema,
		validate: (input, ctx): input is InductionRawConfig => {
			checkInductionConfig(input, diagnostic => ctx.addDiagnostic(diagnostic))
			return !ctx.hasAnyDiagnostic()
		},
		resolve: resolveInductionConfig,
	})
	.structure((ctx) => {
		checkInsideOnboarding(ctx, 'InductionStep')
		const root = ctx.blueprint.root
		if (!root.resolved || root.type !== 'Onboarding')
			return
		const inductions = ctx.blueprint.getChildrenAt(root, 'steps')
			.filter(child => child.resolved && child.type === 'InductionStep')
		if (inductions.length > 1 && inductions[0]?.resolved && ctx.widget.id !== inductions[0].id)
			ctx.addDiagnostic({ message: 'A wizard has at most one InductionStep: the booking is the State of one widget.', reason: 'at-most-one-induction' })
	})
	.state(state => state
		.status({
			validate: (input): input is BookingStatus => isBookingStatus(input),
			default: () => 'idle',
		})
		.ticket({
			validate: (input): input is number => isNumber(input) && Number.isInteger(input) && input >= 0,
			default: () => 0,
		})
		.slot({
			validate: (input): input is Slot | null => isNullableSlot(input),
			default: () => null,
		})
		.reference({
			validate: (input): input is string | null => input === null || typeof input === 'string',
			default: () => null,
		})
		.reason({
			validate: (input): input is string | null => input === null || typeof input === 'string',
			default: () => null,
		}))
	.properties(properties => properties
		.title({ compute: ({ config }) => config.title })
		.offered({ compute: ({ config }) => ({ days: config.days, times: config.times }) })
		.missing({
			registerDeps: ({ dep }) => ({ status: dep.self.state.get('status') }),
			compute: ({ deps }) => {
				const status = deps.status()
				if (status.ok && status.value === 'confirmed')
					return []
				return [status.ok && status.value === 'requesting' ? 'booking-pending' : 'booking']
			},
		})
		.complete({
			registerDeps: ({ dep }) => ({ status: dep.self.state.get('status') }),
			compute: ({ deps }) => {
				const status = deps.status()
				return status.ok && status.value === 'confirmed'
			},
		})
		.answers({
			registerDeps: ({ dep }) => ({
				status: dep.self.state.get('status'),
				slot: dep.self.state.get('slot'),
				reference: dep.self.state.get('reference'),
			}),
			compute: ({ deps }) => {
				const status = deps.status()
				const slot = deps.slot()
				const reference = deps.reference()
				const confirmed = status.ok && status.value === 'confirmed'
				return { slot: confirmed && slot.ok ? slot.value : null, reference: confirmed && reference.ok ? reference.value : null }
			},
		}))
	.methods(methods => methods
		.requestSlot({
			validateArgs: (args, { config, addDiagnostic, hasAnyDiagnostic }): args is [string, string] => {
				if (args.length !== 2) {
					addDiagnostic({ message: `requestSlot(date, time) takes exactly two arguments, got ${args.length}.`, reason: 'wrong-arity' })
					return false
				}
				const [date, time] = args
				if (!isIsoDate(date))
					addDiagnostic({ message: `requestSlot: date must be a real date written YYYY-MM-DD, got ${typeof date === 'string' ? JSON.stringify(date) : describeValue(date)}.`, path: [0], reason: 'invalid-date' })
				else if (!config.days.includes(date))
					addDiagnostic({ message: `requestSlot: ${date} is not a day inductions are offered. Offered: ${config.days.join(', ')}.`, path: [0], reason: 'date-not-offered' })
				if (!isTime(time))
					addDiagnostic({ message: `requestSlot: time must be a time written HH:MM, got ${typeof time === 'string' ? JSON.stringify(time) : describeValue(time)}.`, path: [1], reason: 'invalid-time' })
				else if (!config.times.includes(time))
					addDiagnostic({ message: `requestSlot: ${time} is not a start time that is offered. Offered: ${config.times.join(', ')}.`, path: [1], reason: 'time-not-offered' })
				return !hasAnyDiagnostic()
			},
			registerDeps: ({ dep }) => ({
				status: dep.self.state.get('status'),
				ticket: dep.self.state.get('ticket'),
				setStatus: dep.self.state.set('status'),
				setTicket: dep.self.state.set('ticket'),
				setSlot: dep.self.state.set('slot'),
				setReference: dep.self.state.set('reference'),
				setReason: dep.self.state.set('reason'),
				// Once the wizard is finished its booking is part of what was completed, so it is not changed any more.
				finished: dep.root.state.get('finished')
					.validate(isBoolean),
			}),
			emits: ['slotRequested'],
			execute: ({ args: [date, time], deps, emit, addDiagnostic }) => {
				const status = deps.status()
				const current = deps.ticket()
				const finished = deps.finished()
				if (!status.ok || !current.ok || !finished.ok)
					return 0 // the dependency failure is already recorded: the Method fails
				if (finished.value === true) {
					addDiagnostic({ message: 'The wizard is finished: the booking can no longer be changed.', reason: 'already-finished' })
					return current.value ?? 0
				}
				if (status.value === 'requesting') {
					addDiagnostic({ message: 'A request is still waiting for an answer: cancel it or wait for the answer before asking for another slot.', reason: 'booking-in-progress' })
					return current.value ?? 0
				}
				if (status.value === 'confirmed') {
					addDiagnostic({ message: 'A slot is already booked: cancel it before asking for another.', reason: 'already-booked' })
					return current.value ?? 0
				}
				const ticket = (current.value ?? 0) + 1
				deps.setTicket(ticket)
				deps.setStatus('requesting')
				deps.setSlot({ date, time })
				deps.setReference(null)
				deps.setReason(null)
				emit.slotRequested({ ticket, date, time })
				return ticket
			},
		})
		.settleBooking({
			validateArgs: (args, { addDiagnostic, hasAnyDiagnostic }): args is [number, BookingOutcome] => {
				if (args.length !== 2) {
					addDiagnostic({ message: `settleBooking(ticket, outcome) takes exactly two arguments, got ${args.length}.`, reason: 'wrong-arity' })
					return false
				}
				const [ticket, outcome] = args
				if (typeof ticket !== 'number' || !Number.isInteger(ticket) || ticket < 1)
					addDiagnostic({ message: `settleBooking: ticket must be a whole number from 1, got ${describeValue(ticket)}.`, path: [0], reason: 'invalid-ticket' })
				if (!isBookingOutcome(outcome))
					addDiagnostic({ message: 'settleBooking: outcome must be { status: "confirmed", reference } or { status: "declined", reason }.', path: [1], reason: 'invalid-outcome' })
				return !hasAnyDiagnostic()
			},
			registerDeps: ({ dep }) => ({
				status: dep.self.state.get('status'),
				ticket: dep.self.state.get('ticket'),
				slot: dep.self.state.get('slot'),
				setStatus: dep.self.state.set('status'),
				setReference: dep.self.state.set('reference'),
				setReason: dep.self.state.set('reason'),
			}),
			emits: ['slotConfirmed', 'slotDeclined'],
			execute: ({ args: [ticket, outcome], deps, emit }) => {
				const status = deps.status()
				const current = deps.ticket()
				const slot = deps.slot()
				if (!status.ok || !current.ok || !slot.ok)
					return false
				// A stale answer is not an error: the request it answers is no longer the one that matters.
				if (status.value !== 'requesting' || current.value !== ticket || slot.value === null)
					return false
				if (outcome.status === 'confirmed') {
					deps.setReference(outcome.reference)
					deps.setReason(null)
					deps.setStatus('confirmed')
					emit.slotConfirmed({ ticket, ...slot.value, reference: outcome.reference })
				}
				else {
					deps.setReference(null)
					deps.setReason(outcome.reason)
					deps.setStatus('declined')
					emit.slotDeclined({ ticket, ...slot.value, reason: outcome.reason })
				}
				return true
			},
		})
		.cancelBooking({
			validateArgs: (args): args is [] => args.length === 0,
			registerDeps: ({ dep }) => ({
				status: dep.self.state.get('status'),
				ticket: dep.self.state.get('ticket'),
				slot: dep.self.state.get('slot'),
				setStatus: dep.self.state.set('status'),
				setSlot: dep.self.state.set('slot'),
				setReference: dep.self.state.set('reference'),
				setReason: dep.self.state.set('reason'),
				// Once the wizard is finished its booking is part of what was completed, so it is not changed any more.
				finished: dep.root.state.get('finished')
					.validate(isBoolean),
			}),
			emits: ['slotCancelled'],
			execute: ({ deps, emit, addDiagnostic }) => {
				const status = deps.status()
				const ticket = deps.ticket()
				const slot = deps.slot()
				const finished = deps.finished()
				if (!status.ok || !ticket.ok || !slot.ok || !finished.ok)
					return 0
				if (finished.value === true) {
					addDiagnostic({ message: 'The wizard is finished: the booking can no longer be changed.', reason: 'already-finished' })
					return ticket.value ?? 0
				}
				if ((status.value !== 'requesting' && status.value !== 'confirmed') || slot.value === null) {
					addDiagnostic({ message: 'There is no request waiting and no slot booked: nothing to cancel.', reason: 'nothing-to-cancel' })
					return ticket.value ?? 0
				}
				deps.setStatus('idle')
				deps.setSlot(null)
				deps.setReference(null)
				deps.setReason(null)
				emit.slotCancelled({ ticket: ticket.value ?? 0, ...slot.value, wasConfirmed: status.value === 'confirmed' })
				return ticket.value ?? 0
			},
		}))
	.events(events => events
		.slotRequested({ description: 'The visitor asked for an induction slot. Carries the request, with the ticket the host must hand back with its answer.' })
		.slotConfirmed({ description: 'The booking office confirmed the slot of the newest request. Carries the request and the booking reference.' })
		.slotDeclined({ description: 'The booking office declined the slot of the newest request. Carries the request and the reason.' })
		.slotCancelled({ description: 'The visitor cancelled a request that was waiting, or a booking that was confirmed. Carries the request and whether it had been confirmed.' }))
	.done()
