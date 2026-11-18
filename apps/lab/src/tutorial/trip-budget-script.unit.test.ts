/**
 * The Trip budget tour's step predicates against a REAL `@deviltea/widget-core` Runtime built from the actual
 * `trip-default` preset, read through the exact passive `TutorialRuntimeReader` the engine uses
 * (`createRuntimeReader`), so a Property only counts once something evaluated it. In the real app the
 * Preview's renderers are that "real consumer"; here `observe()` plays the same part by reading the
 * Properties the page always shows (and, for the laziness step, the one a viewer opens).
 *
 * Every action-gated stage is checked false before and true after the scripted writes, and one test walks the
 * whole script through the real `createTutorialEngine`.
 */

import type { TutorialActions, TutorialStepDefinition } from './types'
import { describe, expect, it, vi } from 'vitest'
import { translatePresentationMessage } from '../i18n/presentation-messages'
import { createTripRuntime, widgetOfType } from '../showcases/trip-budget/test-support'
import { createTutorialEngine } from './engine'
import { createRuntimeReader } from './inspection-reader'
import { TRIP_BUDGET_TOUR_ID, tripBudgetTourScript } from './trip-budget-script'

function setup() {
	const { runtime } = createTripRuntime()
	const reader = createRuntimeReader(runtime)
	const hotel = widgetOfType(runtime, 'hotel', 'Expense')
	const museum = widgetOfType(runtime, 'museum', 'Expense')
	const currency = widgetOfType(runtime, 'currency', 'Currency')
	const settlement = widgetOfType(runtime, 'settlement', 'Settlement')

	/** What the page always reads in Preview. */
	function observe(): void {
		settlement.properties.transfers.get()
	}

	return { runtime, reader, hotel, museum, currency, settlement, observe }
}

function step(id: string): TutorialStepDefinition {
	const found = tripBudgetTourScript.steps.find(candidate => candidate.id === id)
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

describe('tripBudgetTourScript shape', () => {
	it('has the nine steps under the tour id the showcase shares', () => {
		expect(tripBudgetTourScript.id)
			.toBe(TRIP_BUDGET_TOUR_ID)
		expect(TRIP_BUDGET_TOUR_ID)
			.toBe('trip-budget')
		expect(tripBudgetTourScript.steps.map(candidate => candidate.id))
			.toEqual(['orient', 'chain', 'read-only-method', 'rounding', 'laziness', 'reset-state', 'diagnostics', 'map-the-views', 'hand-back'])
	})

	it('observes exactly the members its predicates read', () => {
		expect(tripBudgetTourScript.observationTargets)
			.toEqual([
				{ widgetId: 'hotel', member: { type: 'state', key: 'amount' } },
				{ widgetId: 'hotel', member: { type: 'property', key: 'breakdown' } },
				{ widgetId: 'museum', member: { type: 'state', key: 'currency' } },
				{ widgetId: 'currency', member: { type: 'state', key: 'roundStep' } },
			])
	})

	it('only names widgets and members that exist in trip-default', () => {
		const { reader } = setup()
		for (const { widgetId, member } of tripBudgetTourScript.observationTargets) {
			if (member.type === 'state') {
				expect(reader.readState(widgetId, member.key), `${widgetId}.${member.key}`).not.toBeUndefined()
			}
			else {
				expect(reader.readProperty(widgetId, member.key), `${widgetId}.${member.key}`)
					.toEqual({ status: 'never-evaluated' })
			}
		}
	})

	it('spotlights only targets the renderers stamp (`trip-<widget id>`) and widgets that exist', () => {
		const { runtime } = setup()
		for (const candidate of tripBudgetTourScript.steps) {
			if (candidate.target === null || candidate.target === 'preview')
				continue
			expect(candidate.target)
				.toMatch(/^trip-[a-z-]+$/)
			expect(runtime.getWidget(candidate.target.replace(/^trip-/, '')), candidate.id)
				.not
				.toBeNull()
		}
	})

	it('has a zh-TW translation for every title, prompt, reveal and action link label', () => {
		const sources = new Set<string>()
		for (const candidate of tripBudgetTourScript.steps) {
			sources.add(candidate.title)
			for (const { prompt, reveal } of candidate.stages) {
				sources.add(prompt)
				sources.add(reveal)
			}
			// The view-name links (Events, Dependencies, ...) are proper names that read the same in zh-TW.
			for (const link of (candidate.links ?? []).filter(({ id }) => !id.startsWith('view-')))
				sources.add(link.label)
		}
		const untranslated = [...sources].filter(source => translatePresentationMessage('zh-TW', source) === source)
		expect(untranslated)
			.toEqual([])
	})
})

describe('step "chain"', () => {
	it('is false until the hotel amount is a number other than the authored 420', () => {
		const { hotel, reader, observe } = setup()
		const complete = stage('chain')
		observe()
		expect(complete(reader))
			.toBe(false)
		hotel.state.amount.set(420)
		expect(complete(reader))
			.toBe(false)
		hotel.state.amount.set(null)
		expect(complete(reader))
			.toBe(false)
		hotel.state.amount.set(520)
		expect(complete(reader))
			.toBe(true)
	})
})

describe('steps "read-only-method" and "rounding"', () => {
	it('complete on the museum currency GBP and on a whole-unit step', () => {
		const { museum, currency, reader } = setup()
		expect(stage('read-only-method')(reader))
			.toBe(false)
		museum.state.currency.set('EUR')
		expect(stage('read-only-method')(reader))
			.toBe(false)
		museum.state.currency.set('GBP')
		expect(stage('read-only-method')(reader))
			.toBe(true)

		expect(stage('rounding')(reader))
			.toBe(false)
		currency.state.roundStep.set(500)
		expect(stage('rounding')(reader))
			.toBe(false)
		currency.state.roundStep.set(100)
		expect(stage('rounding')(reader))
			.toBe(true)
	})
})

describe('step "laziness"', () => {
	it('narrates first (no predicate), then waits for breakdown to be evaluated by a reader', () => {
		expect(step('laziness').stages[0].isComplete)
			.toBeUndefined()
		const { hotel, reader, observe } = setup()
		const complete = stage('laziness', 1)
		observe()
		// The page's own Properties are evaluated; the breakdown is not, so it does not count.
		expect(reader.readProperty('hotel', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })
		expect(complete(reader))
			.toBe(false)
		hotel.properties.breakdown.get()
		expect(complete(reader))
			.toBe(true)
	})

	it('does not force the evaluation it observes: reading through the reader leaves it never evaluated', () => {
		const { reader } = setup()
		for (let i = 0; i < 3; i++)
			stage('laziness', 1)(reader)
		expect(reader.readProperty('hotel', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })
	})
})

describe('step "reset-state"', () => {
	it('needs a changed amount first, then the authored 420 back', () => {
		const { hotel, reader } = setup()
		const changed = stage('reset-state', 0)
		const reset = stage('reset-state', 1)
		expect(changed(reader))
			.toBe(false)
		expect(reset(reader))
			.toBe(true)
		hotel.state.amount.set(999)
		expect(changed(reader))
			.toBe(true)
		expect(reset(reader))
			.toBe(false)
		hotel.resetState()
		expect(changed(reader))
			.toBe(false)
		expect(reset(reader))
			.toBe(true)
	})
})

describe('the whole script on a real Runtime', () => {
	it('walks nine steps with the scripted interactions, each revealing before Next enables', () => {
		const { hotel, museum, currency, reader, observe } = setup()
		const engine = createTutorialEngine(tripBudgetTourScript)
		const actions: TutorialActions = {
			setFocus: vi.fn(),
			activateTab: vi.fn(),
			openImplementation: vi.fn(),
		}
		const settle = (): void => {
			observe()
			engine.recheck(reader)
		}
		const expectStep = (id: string, canAdvance: boolean): void => {
			expect(engine.getSnapshot().step?.id)
				.toBe(id)
			expect(engine.getSnapshot().canAdvance, `${id} canAdvance`)
				.toBe(canAdvance)
		}

		engine.start(actions)
		settle()
		expectStep('orient', true)
		engine.next(actions)

		settle()
		expectStep('chain', false)
		hotel.state.amount.set(520)
		settle()
		expectStep('chain', true)
		engine.next(actions)

		settle()
		expectStep('read-only-method', false)
		museum.state.currency.set('GBP')
		settle()
		expectStep('read-only-method', true)
		engine.next(actions)

		settle()
		expectStep('rounding', false)
		currency.state.roundStep.set(100)
		settle()
		expectStep('rounding', true)
		engine.next(actions)

		// Laziness: the first stage reveals at once, the second waits for the breakdown to be read.
		settle()
		expectStep('laziness', false)
		expect(engine.getSnapshot().revealed)
			.toHaveLength(1)
		hotel.properties.breakdown.get()
		settle()
		expectStep('laziness', true)
		engine.next(actions)

		// The hotel is still at 520 from step 2, so the first stage is already satisfied.
		settle()
		expectStep('reset-state', false)
		expect(engine.getSnapshot().revealed)
			.toHaveLength(1)
		hotel.resetState()
		settle()
		expectStep('reset-state', true)
		engine.next(actions)

		for (const id of ['diagnostics', 'map-the-views', 'hand-back']) {
			settle()
			expectStep(id, true)
			engine.next(actions)
		}
		expect(engine.getSnapshot().status)
			.toBe('completed')
	})
})
