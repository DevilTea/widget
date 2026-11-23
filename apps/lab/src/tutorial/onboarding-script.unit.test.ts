/**
 * The Onboarding tour's step predicates against REAL `@deviltea/widget-core` Runtimes built from the actual
 * `onboarding-default`, `onboarding-deep-link` and `onboarding-ready-to-book` presets, read through the exact passive
 * `TutorialRuntimeReader` the engine uses (`createRuntimeReader`). Every action-gated stage is checked false before and
 * true after the scripted writes, and one test walks the whole script through the real `createTutorialEngine`.
 */

import type { TutorialActions, TutorialStepDefinition } from './types'
import { describe, expect, it, vi } from 'vitest'
import { translatePresentationMessage } from '../i18n/presentation-messages'
import { createOnboardingRuntime, createPresetRuntime, widgetsOf } from '../showcases/onboarding/test-support'
import { createTutorialEngine } from './engine'
import { createRuntimeReader } from './inspection-reader'
import { ONBOARDING_TOUR_ID, onboardingTourScript } from './onboarding-script'

function setup(preset?: string) {
	const { runtime } = preset === undefined ? createOnboardingRuntime() : createPresetRuntime(preset)
	return { runtime, widgets: widgetsOf(runtime), reader: createRuntimeReader(runtime) }
}

function step(id: string): TutorialStepDefinition {
	const found = onboardingTourScript.steps.find(candidate => candidate.id === id)
	if (found === undefined)
		throw new Error(`No step "${id}"`)
	return found
}

function stage(id: string, index = 0) {
	const predicate = step(id).stages[index]?.isComplete
	if (predicate === undefined)
		throw new Error(`Step "${id}" stage ${index} has no predicate`)
	return predicate
}

describe('onboardingTourScript shape', () => {
	it('has the ten steps under the tour id the showcase shares', () => {
		expect(onboardingTourScript.id)
			.toBe(ONBOARDING_TOUR_ID)
		expect(ONBOARDING_TOUR_ID)
			.toBe('onboarding')
		expect(onboardingTourScript.steps.map(candidate => candidate.id))
			.toEqual(['orient', 'declared-events', 'first-move', 'refused-move', 'arguments', 'load-booking', 'async-booking', 'stale-answers', 'map-the-views', 'hand-back'])
	})

	it('observes exactly the members its predicates read, and they exist in the default preset', () => {
		expect(onboardingTourScript.observationTargets)
			.toEqual([
				{ widgetId: 'onboarding', member: { type: 'state', key: 'current' } },
				{ widgetId: 'account', member: { type: 'state', key: 'name' } },
				{ widgetId: 'account', member: { type: 'state', key: 'email' } },
				{ widgetId: 'induction', member: { type: 'state', key: 'status' } },
			])
		const { reader } = setup()
		for (const { widgetId, member } of onboardingTourScript.observationTargets) {
			expect(reader.readState(widgetId, member.key), `${widgetId}.${member.key}`)
				.not
				.toBeUndefined()
		}
	})

	it('spotlights only targets the renderers stamp (`onboarding-<widget id>` or one of the named panels)', () => {
		const { runtime } = setup()
		const panels = new Set(['onboarding-steps', 'onboarding-actions', 'onboarding-jump', 'onboarding-problem', 'onboarding-induction-status', 'onboarding-office', 'onboarding-host-activity'])
		for (const candidate of onboardingTourScript.steps) {
			if (candidate.target === null || panels.has(candidate.target))
				continue
			expect(candidate.target)
				.toMatch(/^onboarding-[a-z-]+$/)
			expect(runtime.getWidget(candidate.target.replace(/^onboarding-/, '')), candidate.id)
				.not
				.toBeNull()
		}
	})

	it('has a zh-TW translation for every title, prompt, reveal and action link label', () => {
		const sources = new Set<string>()
		for (const candidate of onboardingTourScript.steps) {
			sources.add(candidate.title)
			for (const { prompt, reveal } of candidate.stages) {
				sources.add(prompt)
				sources.add(reveal)
			}
			for (const link of (candidate.links ?? []).filter(({ id }) => !id.startsWith('view-')))
				sources.add(link.label)
		}
		const untranslated = [...sources].filter(source => translatePresentationMessage('zh-TW', source) === source)
		expect(untranslated)
			.toEqual([])
	})

	it('names only Methods and Events the plugins really declare', () => {
		const text = onboardingTourScript.steps.flatMap(candidate => [candidate.title, ...candidate.stages.flatMap(({ prompt, reveal }) => [prompt, reveal])])
			.join('\n')
		const declared = new Set(['next', 'back', 'goTo', 'finish', 'canEnter', 'requestSlot', 'settleBooking', 'cancelBooking', 'validateArgs', 'execute', 'subscribe', 'getWidget'])
		for (const [, name] of text.matchAll(/\b(\w+)\(/g)) {
			expect(declared.has(name!) || ['id', 'ticket', 'outcome', 'index'].includes(name!), name)
				.toBe(true)
		}
		for (const event of ['stepChanged', 'completed', 'slotRequested', 'slotConfirmed', 'slotDeclined', 'slotCancelled']) {
			expect(text)
				.toContain(event)
		}
	})
})

describe('step "first-move"', () => {
	it('is false until the wizard has moved past the first step', () => {
		const { widgets, reader } = setup()
		const complete = stage('first-move')
		expect(complete(reader))
			.toBe(false)
		widgets.account.state.name.set('Sam')
		widgets.account.state.email.set('sam@example.org')
		expect(complete(reader))
			.toBe(false)
		widgets.root.methods.next()
		expect(complete(reader))
			.toBe(true)
	})
})

describe('step "refused-move"', () => {
	const complete = stage('refused-move')

	it('is false in the default wizard and true in the deep-link one (the last step, nothing filled in)', () => {
		expect(complete(setup().reader))
			.toBe(false)
		expect(complete(setup('onboarding-deep-link').reader))
			.toBe(true)
	})

	it('is false in ready-to-book, which also opens on the last step but has a name', () => {
		expect(complete(setup('onboarding-ready-to-book').reader))
			.toBe(false)
	})
})

describe('steps "load-booking", "async-booking" and "stale-answers"', () => {
	it('"load-booking" is true only in the ready-to-book wizard', () => {
		const complete = stage('load-booking')
		expect(complete(setup().reader))
			.toBe(false)
		expect(complete(setup('onboarding-deep-link').reader))
			.toBe(false)
		expect(complete(setup('onboarding-ready-to-book').reader))
			.toBe(true)
	})

	it('"async-booking" waits for the host\'s answer: requesting is not enough, confirmed is', () => {
		const { widgets, reader } = setup('onboarding-ready-to-book')
		const complete = stage('async-booking')
		widgets.induction.methods.requestSlot('2026-12-05', '10:00')
		expect(complete(reader))
			.toBe(false)
		widgets.induction.methods.settleBooking(1, { status: 'confirmed', reference: 'TM-1' })
		expect(complete(reader))
			.toBe(true)
	})

	it('"stale-answers" is not complete on entry however the previous step was done (even after a declined 17:00 first, which already makes ticket 2), and completes when the booking is cancelled', () => {
		const { widgets, reader } = setup('onboarding-ready-to-book')
		const complete = stage('stale-answers')
		// The previous step's other suggestion: ask for 17:00 (declined), then for a slot that is confirmed: ticket 2.
		widgets.induction.methods.requestSlot('2026-12-05', '17:00')
		widgets.induction.methods.settleBooking(1, { status: 'declined', reason: 'fully-booked' })
		widgets.induction.methods.requestSlot('2026-12-05', '10:00')
		widgets.induction.methods.settleBooking(2, { status: 'confirmed', reference: 'TM-1' })
		expect(widgets.induction.state.ticket.get())
			.toBe(2)
		expect(complete(reader))
			.toBe(false)
		widgets.induction.methods.cancelBooking()
		expect(complete(reader))
			.toBe(true)
	})

	it('says nothing a reader could take for a promise: the reveal names the host as the one that waits', () => {
		expect(step('async-booking').stages[0].reveal)
			.toContain('Nothing inside Core waited')
		expect(step('load-booking').stages[0].reveal)
			.toContain('the page, as the host, does the waiting')
	})
})

describe('step "arguments", in the state the previous step leaves (the deep-link preset)', () => {
	it('names a step that really is locked there: 1.5, 9 and 2 give the codes the text says, and 3 (where the visitor is) is not an error', () => {
		const { widgets } = setup('onboarding-deep-link')
		const { root } = widgets
		const codes = (): { code: string, reason?: string }[] => root.methods.goTo.getDiagnostics()
			.map(diagnostic => ({ code: diagnostic.code, reason: (diagnostic as { readonly reason?: string }).reason }))
		root.methods.goTo(1.5)
		expect(codes())
			.toEqual([{ code: 'invalid-method-arguments', reason: 'not-a-whole-number' }])
		root.methods.goTo(9)
		expect(codes())
			.toEqual([{ code: 'invalid-method-result', reason: 'no-such-step' }])
		root.methods.goTo(2)
		expect(codes())
			.toEqual([{ code: 'invalid-method-result', reason: 'step-locked' }])
		// The step the visitor is on is never locked and clears the failure: the text must not send them there.
		expect(root.methods.goTo(3).ok)
			.toBe(true)
		expect(codes())
			.toEqual([])
		const { prompt, reveal } = step('arguments').stages[0]
		expect(prompt)
			.toContain('then 9, then 2.')
		expect(reveal)
			.toContain('Type 2 while the steps before it are incomplete: step-locked')
		expect(reveal)
			.not
			.toContain('Type 3')
	})
})

describe('the whole script on real Runtimes', () => {
	it('walks ten steps with the scripted interactions, each revealing before Next enables', () => {
		const first = setup()
		const engine = createTutorialEngine(onboardingTourScript)
		const actions: TutorialActions = {
			setFocus: vi.fn(),
			activateTab: vi.fn(),
			openTool: vi.fn(),
		}
		let reader = first.reader
		const settle = (): void => {
			engine.recheck(reader)
		}
		const expectStep = (id: string, canAdvance: boolean): void => {
			expect(engine.getSnapshot().step?.id)
				.toBe(id)
			expect(engine.getSnapshot().canAdvance, `${id} canAdvance`)
				.toBe(canAdvance)
		}

		engine.start(actions)
		for (const id of ['orient', 'declared-events']) {
			settle()
			expectStep(id, true)
			engine.next(actions)
		}

		settle()
		expectStep('first-move', false)
		first.widgets.account.state.name.set('Sam Rivera')
		first.widgets.account.state.email.set('sam@example.org')
		first.widgets.root.methods.next()
		settle()
		expectStep('first-move', true)
		engine.next(actions)

		// The visitor loads the deep-link preset: a different Runtime, read by the same script.
		settle()
		expectStep('refused-move', false)
		reader = setup('onboarding-deep-link').reader
		settle()
		expectStep('refused-move', true)
		engine.next(actions)

		settle()
		expectStep('arguments', true)
		engine.next(actions)

		settle()
		expectStep('load-booking', false)
		const ready = setup('onboarding-ready-to-book')
		reader = ready.reader
		settle()
		expectStep('load-booking', true)
		engine.next(actions)

		settle()
		expectStep('async-booking', false)
		ready.widgets.induction.methods.requestSlot('2026-12-05', '10:00')
		ready.widgets.induction.methods.settleBooking(1, { status: 'confirmed', reference: 'TM-20261205-1000' })
		settle()
		expectStep('async-booking', true)
		engine.next(actions)

		settle()
		expectStep('stale-answers', false)
		ready.widgets.induction.methods.cancelBooking()
		settle()
		expectStep('stale-answers', true)
		engine.next(actions)

		for (const id of ['map-the-views', 'hand-back']) {
			settle()
			expectStep(id, true)
			engine.next(actions)
		}
		expect(engine.getSnapshot().status)
			.toBe('completed')
	})
})
