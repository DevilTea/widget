/**
 * The induction booking against a real Core Runtime: argument validation from the config, the request/settle/cancel
 * Methods, the ticket that makes a stale answer harmless, the Events each one emits, and the boundary that keeps the
 * waiting out of Core.
 */

import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { createOnboardingRuntime, failureOf, valueOf, widgetsOf } from '../test-support'

function setup() {
	const { runtime } = createOnboardingRuntime()
	const { induction } = widgetsOf(runtime)
	const heard: { name: string, payload: unknown }[] = []
	induction.events.slotRequested.subscribe(payload => heard.push({ name: 'slotRequested', payload }))
	induction.events.slotConfirmed.subscribe(payload => heard.push({ name: 'slotConfirmed', payload }))
	induction.events.slotDeclined.subscribe(payload => heard.push({ name: 'slotDeclined', payload }))
	induction.events.slotCancelled.subscribe(payload => heard.push({ name: 'slotCancelled', payload }))
	return { runtime, induction, heard }
}

describe('inductionStep.requestSlot: arguments are validated against the config', () => {
	it.each([
		[['2026-12-05'], [{ reason: 'wrong-arity' }]],
		[['', '10:00'], [{ reason: 'invalid-date' }]],
		[['2026-02-30', '10:00'], [{ reason: 'invalid-date' }]],
		[['2026-12-06', '10:00'], [{ reason: 'date-not-offered' }]],
		[['2026-12-05', '9am'], [{ reason: 'invalid-time' }]],
		[['2026-12-05', '09:30'], [{ reason: 'time-not-offered' }]],
		[[5, null], [{ reason: 'invalid-date' }, { reason: 'invalid-time' }]],
		[['2026-12-06', '09:30'], [{ reason: 'date-not-offered' }, { reason: 'time-not-offered' }]],
	] as const)('requestSlot(...%j) is invalid-method-arguments with every problem listed', (args, expected) => {
		const { induction, heard } = setup()
		const result = (induction.methods.requestSlot as (...values: unknown[]) => { readonly ok: boolean })(...args)
		expect(result.ok)
			.toBe(false)
		expect(failureOf(induction.methods.requestSlot))
			.toEqual(expected.map(({ reason }) => ({ code: 'invalid-method-arguments', reason })))
		// execute never ran: nothing was written and nothing was emitted.
		expect(induction.state.status.get())
			.toBe('idle')
		expect(induction.state.ticket.get())
			.toBe(0)
		expect(heard)
			.toEqual([])
	})

	it('points at the argument that is wrong, and says which values are offered', () => {
		const { induction } = setup()
		induction.methods.requestSlot('2026-12-06', '09:30')
		expect(induction.methods.requestSlot.getDiagnostics()
			.map(diagnostic => ({ path: (diagnostic as { readonly path?: unknown }).path, message: diagnostic.message })))
			.toEqual([
				{ path: [0], message: 'requestSlot: 2026-12-06 is not a day inductions are offered. Offered: 2026-12-05, 2026-12-12, 2026-12-19.' },
				{ path: [1], message: 'requestSlot: 09:30 is not a start time that is offered. Offered: 10:00, 14:00, 17:00.' },
			])
	})
})

describe('inductionStep: request, settle and cancel', () => {
	it('requesting writes the request into State, emits slotRequested with a ticket and returns at once', () => {
		const { induction, heard } = setup()
		expect(valueOf(induction.methods.requestSlot('2026-12-05', '10:00')))
			.toBe(1)
		expect(induction.state.status.get())
			.toBe('requesting')
		expect(induction.state.ticket.get())
			.toBe(1)
		expect(induction.state.slot.get())
			.toEqual({ date: '2026-12-05', time: '10:00' })
		expect(valueOf(induction.properties.complete.get()))
			.toBe(false)
		expect(valueOf(induction.properties.missing.get()))
			.toEqual(['booking-pending'])
		expect(heard)
			.toEqual([{ name: 'slotRequested', payload: { ticket: 1, date: '2026-12-05', time: '10:00' } }])
	})

	it('refuses a second request while one is waiting, and a request while a slot is booked (invalid-method-result)', () => {
		const { induction, heard } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		expect(induction.methods.requestSlot('2026-12-12', '14:00').ok)
			.toBe(false)
		expect(failureOf(induction.methods.requestSlot))
			.toEqual([{ code: 'invalid-method-result', reason: 'booking-in-progress' }])
		induction.methods.settleBooking(1, { status: 'confirmed', reference: 'TM-1' })
		expect(induction.methods.requestSlot('2026-12-12', '14:00').ok)
			.toBe(false)
		expect(failureOf(induction.methods.requestSlot))
			.toEqual([{ code: 'invalid-method-result', reason: 'already-booked' }])
		expect(induction.state.ticket.get())
			.toBe(1)
		expect(heard.map(entry => entry.name))
			.toEqual(['slotRequested', 'slotConfirmed'])
	})

	it('settling a confirmed answer completes the step, emits slotConfirmed with the reference and clears the earlier failure', () => {
		const { induction, heard } = setup()
		induction.methods.requestSlot('2026-12-06', '10:00')
		expect(induction.methods.requestSlot.getDiagnostics())
			.toHaveLength(1)
		induction.methods.requestSlot('2026-12-05', '10:00')
		expect(induction.methods.requestSlot.getDiagnostics())
			.toEqual([])
		expect(valueOf(induction.methods.settleBooking(1, { status: 'confirmed', reference: 'TM-20261205-1000' })))
			.toBe(true)
		expect(induction.state.status.get())
			.toBe('confirmed')
		expect(induction.state.reference.get())
			.toBe('TM-20261205-1000')
		expect(valueOf(induction.properties.complete.get()))
			.toBe(true)
		expect(valueOf(induction.properties.answers.get()))
			.toEqual({ slot: { date: '2026-12-05', time: '10:00' }, reference: 'TM-20261205-1000' })
		expect(heard.at(-1))
			.toEqual({ name: 'slotConfirmed', payload: { ticket: 1, date: '2026-12-05', time: '10:00', reference: 'TM-20261205-1000' } })
	})

	it('settling a declined answer keeps the slot and the reason, emits slotDeclined and allows another request', () => {
		const { induction, heard } = setup()
		induction.methods.requestSlot('2026-12-05', '17:00')
		induction.methods.settleBooking(1, { status: 'declined', reason: 'fully-booked' })
		expect(induction.state.status.get())
			.toBe('declined')
		expect(induction.state.reason.get())
			.toBe('fully-booked')
		expect(valueOf(induction.properties.missing.get()))
			.toEqual(['booking'])
		expect(heard.at(-1))
			.toEqual({ name: 'slotDeclined', payload: { ticket: 1, date: '2026-12-05', time: '17:00', reason: 'fully-booked' } })
		expect(valueOf(induction.methods.requestSlot('2026-12-05', '10:00')))
			.toBe(2)
		expect(induction.state.reason.get())
			.toBeNull()
	})

	it.each([
		['no request is waiting', () => {}],
		['the ticket is not the newest', (induction: ReturnType<typeof setup>['induction']) => {
			induction.methods.requestSlot('2026-12-05', '10:00')
			induction.methods.cancelBooking()
			induction.methods.requestSlot('2026-12-12', '14:00')
		}],
		['the request was cancelled', (induction: ReturnType<typeof setup>['induction']) => {
			induction.methods.requestSlot('2026-12-05', '10:00')
			induction.methods.cancelBooking()
		}],
	])('ignores a stale answer when %s: the Method succeeds with false, writes nothing and emits nothing', (_name, arrange) => {
		const { induction, heard } = setup()
		arrange(induction)
		const before = { status: induction.state.status.get(), ticket: induction.state.ticket.get(), slot: induction.state.slot.get(), reference: induction.state.reference.get() }
		const eventsBefore = heard.length
		const stale = induction.methods.settleBooking(1, { status: 'confirmed', reference: 'TM-stale' })
		expect(stale)
			.toMatchObject({ ok: true, value: false })
		expect(induction.methods.settleBooking.getDiagnostics())
			.toEqual([])
		expect({ status: induction.state.status.get(), ticket: induction.state.ticket.get(), slot: induction.state.slot.get(), reference: induction.state.reference.get() })
			.toEqual(before)
		expect(heard)
			.toHaveLength(eventsBefore)
		expect(induction.state.reference.get())
			.not
			.toBe('TM-stale')
	})

	it('validates what the host hands back (invalid-method-arguments), so a malformed answer changes nothing', () => {
		const { induction, heard } = setup()
		induction.methods.requestSlot('2026-12-05', '10:00')
		const settle = induction.methods.settleBooking as (...values: unknown[]) => { readonly ok: boolean }
		expect(settle(0, { status: 'confirmed', reference: 'x' }).ok)
			.toBe(false)
		expect(failureOf(induction.methods.settleBooking))
			.toEqual([{ code: 'invalid-method-arguments', reason: 'invalid-ticket' }])
		expect(settle(1, { status: 'maybe' }).ok)
			.toBe(false)
		expect(failureOf(induction.methods.settleBooking))
			.toEqual([{ code: 'invalid-method-arguments', reason: 'invalid-outcome' }])
		expect(induction.state.status.get())
			.toBe('requesting')
		expect(heard)
			.toHaveLength(1)
	})

	it('cancels a waiting request or a confirmed booking with slotCancelled, and has nothing to cancel otherwise', () => {
		const { induction, heard } = setup()
		expect(induction.methods.cancelBooking().ok)
			.toBe(false)
		expect(failureOf(induction.methods.cancelBooking))
			.toEqual([{ code: 'invalid-method-result', reason: 'nothing-to-cancel' }])
		induction.methods.requestSlot('2026-12-05', '10:00')
		expect(valueOf(induction.methods.cancelBooking()))
			.toBe(1)
		expect(induction.methods.cancelBooking.getDiagnostics())
			.toEqual([])
		expect(induction.state.status.get())
			.toBe('idle')
		expect(induction.state.slot.get())
			.toBeNull()
		expect(heard.at(-1))
			.toEqual({ name: 'slotCancelled', payload: { ticket: 1, date: '2026-12-05', time: '10:00', wasConfirmed: false } })
		induction.methods.requestSlot('2026-12-12', '14:00')
		induction.methods.settleBooking(2, { status: 'confirmed', reference: 'TM-2' })
		induction.methods.cancelBooking()
		expect(heard.at(-1))
			.toEqual({ name: 'slotCancelled', payload: { ticket: 2, date: '2026-12-12', time: '14:00', wasConfirmed: true } })
		expect(induction.state.ticket.get())
			.toBe(2)
	})
})

describe('why the waiting is not in Core', () => {
	it('a Method\'s emit stops working when the Method returns, so an async tail could never emit', async () => {
		let later: () => void = () => {}
		const plugin = createWidgetPlugin('Waiter')
			.interfaces<{ methods: { start: () => null }, events: { done: [] } }>()
			.methods(methods => methods.start({
				validateArgs: (args): args is [] => args.length === 0,
				emits: ['done'],
				execute: ({ emit }) => {
					later = () => emit.done()
					return null
				},
			}))
			.events(['done'])
			.done()
		const blueprint = createWidgetSystem({ plugins: [plugin] })
			.createBlueprint({ id: 'waiter', type: 'Waiter' })
		if (blueprint.status !== 'valid')
			throw new Error('invalid')
		const widget = blueprint.createRuntime()
			.getWidget('waiter')
		if (widget?.type !== 'Waiter')
			throw new Error('missing')
		const heard: string[] = []
		widget.events.done.subscribe(() => heard.push('done'))
		widget.methods.start()
		await Promise.resolve()
		expect(later)
			.toThrow(TypeError)
		expect(heard)
			.toEqual([])
	})
})
