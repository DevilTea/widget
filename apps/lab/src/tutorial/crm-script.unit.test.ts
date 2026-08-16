/**
 * Regression coverage for merge-gate review round 2, blocker 1: the CRM tour's "search" step must not
 * accept a valid, narrowing search that filters `deal-1` (Aurora Systems) OUT of the table — the very
 * next step ("select-row") is hard-pinned to selecting exactly that row, so a query like "Borealis"
 * (equally legitimate under `DealQuery`'s real case-insensitive substring filter) would otherwise
 * dead-end the tour.
 *
 * Against a REAL `@deviltea/widget-core` Runtime built from the actual `crm-default` preset (via
 * `showcases/crm/test-support.ts`, the same fixture `deal-query.unit.test.ts` uses) — never a mock —
 * writing State directly through the widget's own `state.value.set()` and forcing Property evaluation
 * through the widget's own `.get()` (the same "real evaluating consumer" pattern
 * `inspection-reader.unit.test.ts` established), then reading the step's predicate through the exact
 * passive `TutorialRuntimeReader` the engine itself uses.
 */

import { describe, expect, it } from 'vitest'
import { createCrmRuntime, widgetOfType } from '../showcases/crm/test-support'
import { crmTourScript } from './crm-script'
import { createRuntimeReader } from './inspection-reader'

const searchStep = crmTourScript.steps.find(step => step.id === 'search')!
const searchIsComplete = searchStep.stages[0].isComplete!

/**
 * Forces evaluation of BOTH `filteredDeals` and `count` — mirroring the real app, where `deal-table`'s
 * `rows` (via `filteredDeals`) and `visible-deal-count`'s `value` (via `count`) are simultaneously
 * always-mounted real consumers in Preview. Deliberately forcing both (not just whichever the CURRENT
 * predicate implementation happens to read) is what makes this regression test meaningful regardless of
 * which property a given predicate version depends on — see the pre-fix verification note in this PR's
 * own report for why a test that only forces one property can silently pass for the wrong reason.
 */
function forceRealEvaluation(query: ReturnType<typeof widgetOfType<'DealQuery'>>): void {
	query.properties.filteredDeals.get()
	query.properties.count.get()
}

describe('crmTourScript "search" step predicate', () => {
	it('does NOT complete for a different valid narrowing query that filters Aurora Systems out ("Borealis")', () => {
		const { runtime } = createCrmRuntime()
		const search = widgetOfType(runtime, 'deal-search', 'TextInput')
		const query = widgetOfType(runtime, 'deal-query', 'DealQuery')

		search.state.value.set('Borealis')
		const filtered = query.properties.filteredDeals.get()
		forceRealEvaluation(query)
		expect(filtered.success && filtered.value.map(deal => deal.id))
			.toEqual(['deal-2']) // Borealis Retail only — a genuinely narrowing, otherwise-legitimate search.

		const reader = createRuntimeReader(runtime)
		expect(searchIsComplete(reader))
			.toBe(false)
	})

	it('does NOT complete for a query that matches nothing at all', () => {
		const { runtime } = createCrmRuntime()
		const search = widgetOfType(runtime, 'deal-search', 'TextInput')
		const query = widgetOfType(runtime, 'deal-query', 'DealQuery')

		search.state.value.set('no-such-deal-exists')
		forceRealEvaluation(query)

		const reader = createRuntimeReader(runtime)
		expect(searchIsComplete(reader))
			.toBe(false)
	})

	it('does NOT complete before any search is typed (the unfiltered 8-deal set, deal-1 included but nothing narrowed)', () => {
		const { runtime } = createCrmRuntime()
		const query = widgetOfType(runtime, 'deal-query', 'DealQuery')
		forceRealEvaluation(query)

		const reader = createRuntimeReader(runtime)
		expect(searchIsComplete(reader))
			.toBe(false)
	})

	it('completes for "Aurora", which narrows the table AND leaves deal-1 (Aurora Systems) selectable', () => {
		const { runtime } = createCrmRuntime()
		const search = widgetOfType(runtime, 'deal-search', 'TextInput')
		const query = widgetOfType(runtime, 'deal-query', 'DealQuery')

		search.state.value.set('Aurora')
		const filtered = query.properties.filteredDeals.get()
		forceRealEvaluation(query)
		expect(filtered.success && filtered.value.map(deal => deal.id))
			.toEqual(['deal-1'])

		const reader = createRuntimeReader(runtime)
		expect(searchIsComplete(reader))
			.toBe(true)

		// The very next step's own precondition, proven directly: deal-1 is still selectable.
		const selectRowStep = crmTourScript.steps.find(step => step.id === 'select-row')!
		expect(selectRowStep.stages[0].isComplete)
			.toBeDefined()
		expect(filtered.success && filtered.value.some(deal => deal.id === 'deal-1'))
			.toBe(true)
	})

	it('also completes for a case-insensitive/whole-name variant that still leaves deal-1 visible ("aurora systems")', () => {
		const { runtime } = createCrmRuntime()
		const search = widgetOfType(runtime, 'deal-search', 'TextInput')
		const query = widgetOfType(runtime, 'deal-query', 'DealQuery')

		search.state.value.set('aurora systems')
		forceRealEvaluation(query)

		const reader = createRuntimeReader(runtime)
		expect(searchIsComplete(reader))
			.toBe(true)
	})
})
