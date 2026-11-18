/**
 * `next` and `goTo` apply the same locking rule, because both ask the read-only Method `canEnter`; and once the wizard
 * is finished the induction's booking can no longer be changed.
 */

import { describe, expect, it } from 'vitest'
import { defaultOnboardingPreset } from '../presets'
import { createPresetRuntime, createRuntimeFor, failureOf, valueOf, widgetsOf } from '../test-support'

function openedOnInterests() {
	const document = JSON.parse(defaultOnboardingPreset.sourceText)
	document.config.startStep = 1
	const { runtime } = createRuntimeFor(document)
	const widgets = widgetsOf(runtime)
	// The current step is complete, but an earlier one (the account) is not: the way a deep link leaves a wizard.
	widgets.interests.state.selected.set(['woodwork'])
	widgets.safety.state.acknowledged.set(['shoes', 'machines', 'exits'])
	return widgets
}

describe('onboarding: next and goTo apply the same locking rule', () => {
	it('canEnter, goTo and next all say no to the step after an incomplete earlier one', () => {
		const { root } = openedOnInterests()
		const heard: unknown[] = []
		root.events.stepChanged.subscribe(change => heard.push(change))
		expect(valueOf(root.methods.canEnter(2)))
			.toBe(false)
		expect(root.methods.goTo(2).ok)
			.toBe(false)
		expect(failureOf(root.methods.goTo))
			.toEqual([{ code: 'invalid-method-result', reason: 'step-locked' }])
		expect(root.methods.next().ok)
			.toBe(false)
		expect(failureOf(root.methods.next))
			.toEqual([{ code: 'invalid-method-result', reason: 'step-locked' }])
		expect(root.methods.next.getDiagnostics()[0]?.message)
			.toBe('Step 2 ("safety") is locked: finish the steps before it first.')
		expect(root.state.current.get())
			.toBe(1)
		expect(heard)
			.toEqual([])
	})

	it('both let the visitor through once the earlier step is complete, and next still names an incomplete current step first', () => {
		const { root, account } = openedOnInterests()
		account.state.name.set('Sam')
		account.state.email.set('sam@example.org')
		expect(valueOf(root.methods.canEnter(2)))
			.toBe(true)
		expect(valueOf(root.methods.next()))
			.toBe(2)

		const second = openedOnInterests()
		second.interests.state.selected.set([])
		expect(second.root.methods.next().ok)
			.toBe(false)
		expect(failureOf(second.root.methods.next))
			.toEqual([{ code: 'invalid-method-result', reason: 'step-incomplete' }])
	})
})

describe('inductionStep once the wizard is finished', () => {
	it('refuses to request or cancel: the booking is part of what was completed', () => {
		const { runtime } = createPresetRuntime('onboarding-ready-to-book')
		const { root, induction } = widgetsOf(runtime)
		const heard: string[] = []
		induction.events.slotRequested.subscribe(() => heard.push('slotRequested'))
		induction.events.slotCancelled.subscribe(() => heard.push('slotCancelled'))
		induction.methods.requestSlot('2026-12-05', '10:00')
		induction.methods.settleBooking(1, { status: 'confirmed', reference: 'TM-20261205-1000' })
		root.methods.finish()
		expect(root.state.finished.get())
			.toBe(true)
		heard.length = 0

		expect(induction.methods.cancelBooking().ok)
			.toBe(false)
		expect(failureOf(induction.methods.cancelBooking))
			.toEqual([{ code: 'invalid-method-result', reason: 'already-finished' }])
		expect(induction.methods.requestSlot('2026-12-12', '14:00').ok)
			.toBe(false)
		expect(failureOf(induction.methods.requestSlot))
			.toEqual([{ code: 'invalid-method-result', reason: 'already-finished' }])
		expect(induction.state.status.get())
			.toBe('confirmed')
		expect(induction.state.reference.get())
			.toBe('TM-20261205-1000')
		expect(heard)
			.toEqual([])

		// Start over (resetState) opens the wizard again, and the booking can be changed.
		runtime.resetState()
		expect(valueOf(induction.methods.requestSlot('2026-12-12', '14:00')))
			.toBe(1)
	})
})
