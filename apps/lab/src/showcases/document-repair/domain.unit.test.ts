/**
 * The application's repair policy (`planRepair`) against REAL Core: every step's patch applies to the legacy fixture it was
 * planned for, the steps in order make v1 and v2 valid, v3 has none, a draft with a shape the app has no rule for stays
 * invalid, and a `test` guard makes a step fail atomically once its precondition no longer holds.
 */

import type { SavedWith } from './domain'
import { createWidgetDocument } from '@deviltea/widget-core'
import { describe, expect, it } from 'vitest'
import { boardSystem } from './board/system'
import { epochToDate, fill, formatDate, formatPointer, isIsoDate, localize, planRepair } from './domain'
import { legacyPoll, legacyV1, legacyV2, legacyV3 } from './fixtures'
import { repairByPlan } from './test-support'

function ids(steps: readonly { readonly id: string }[]): string[] {
	return steps.map(step => step.id)
}

describe('helpers', () => {
	it('accepts only real calendar dates, formats them in UTC and converts epoch milliseconds', () => {
		expect(isIsoDate('2026-12-05'))
			.toBe(true)
		expect(isIsoDate('2026-02-30'))
			.toBe(false)
		expect(isIsoDate(20261205))
			.toBe(false)
		expect(formatDate('2026-12-05', 'en'))
			.toBe('Dec 5, 2026')
		expect(epochToDate(Date.UTC(2026, 11, 31)))
			.toBe('2026-12-31')
		expect(epochToDate('1'))
			.toBeNull()
		expect(epochToDate(Number.POSITIVE_INFINITY))
			.toBeNull()
		expect(epochToDate(9e15))
			.toBeNull()
	})

	it('picks text by language, fills markers and writes JSON Pointers', () => {
		expect(localize({ 'en': 'Hi', 'zh-TW': '嗨' }, 'zh-TW'))
			.toBe('嗨')
		expect(localize({ en: 'Hi' }, 'zh-TW'))
			.toBe('Hi')
		expect(fill('{a}/{b}', { a: 1 }))
			.toBe('1/{b}')
		expect(formatPointer([]))
			.toBe('/')
		expect(formatPointer(['slots', 'items', 0, 'a/b', 'c~d']))
			.toBe('/slots/items/0/a~1b/c~0d')
	})
})

describe('the fixtures and what Core says about them', () => {
	it('v1 is invalid in every way the plan knows about; v3 is valid; the others are invalid', () => {
		const codes = (source: unknown): string[] => boardSystem.createBlueprint(source)
			.diagnostics
			.map(diagnostic => diagnostic.code)
		expect(codes(legacyV1))
			.toEqual(expect.arrayContaining(['undeclared-widget-slot', 'unknown-widget-type', 'unexpected-widget-field', 'duplicate-widget-id', 'invalid-widget-id']))
		expect(codes(legacyV2))
			.toEqual(['invalid-widget-config', 'invalid-widget-config'])
		expect(codes(legacyV3))
			.toEqual([])
		expect(codes(legacyPoll))
			.toEqual(expect.arrayContaining(['unknown-widget-type', 'invalid-widget-config']))
	})
})

describe('planRepair', () => {
	it('plans the v1 rules in order, each as a patch that starts with test guards', () => {
		const plan = planRepair(legacyV1, '1.x')
		expect(ids(plan))
			.toEqual(['rename-slot', 'rename-type', 'rename-config-text', 'move-style', 'fix-duplicate-ids', 'rewrite-no-id'])
		for (const step of plan) {
			expect(step.patch[0]?.op, step.id)
				.toBe('test')
			expect((step.title.en ?? '').length, step.id)
				.toBeGreaterThan(5)
			expect(step.title['zh-TW']?.length, step.id)
				.toBeGreaterThan(2)
			expect(step.why['zh-TW']?.length, step.id)
				.toBeGreaterThan(5)
		}
	})

	it('plans v2 as one step and v3 as none, whatever the source holds', () => {
		expect(ids(planRepair(legacyV2, '2.x')))
			.toEqual(['convert-until'])
		expect(planRepair(legacyV3, '3.x'))
			.toEqual([])
		expect(planRepair(legacyV1, '3.x'))
			.toEqual([])
	})

	it('plans nothing for a value that is not a board and never throws', () => {
		for (const source of [null, 1, 'x', [], {}, { slots: 1 }, { slots: {} }, { slots: { notices: 'x' } }, { slots: { notices: [null, 1, 'a', [], {}] } }]) {
			for (const version of ['1.x', '2.x', '3.x'] as const)
				expect(() => planRepair(source, version), `${JSON.stringify(source)} ${version}`).not.toThrow()
		}
		expect(planRepair(null, '1.x'))
			.toEqual([])
		expect(planRepair({ slots: { notices: [null, 1, 'a', [], {}] } }, '1.x'))
			.toEqual([])
	})

	it('is a pure function of the source: it reads without changing it', () => {
		const before = JSON.stringify(legacyV1)
		planRepair(legacyV1, '1.x')
		expect(JSON.stringify(legacyV1))
			.toBe(before)
	})

	it('does not move a style into a meta that already has one or is not an object', () => {
		const withMeta = (meta: unknown) => ({ id: 'board', type: 'Board', slots: { notices: [{ id: 'a', type: 'Notice', style: 'x', meta }] } })
		expect(ids(planRepair(withMeta({ style: 'kept' }), '1.x')))
			.toEqual([])
		expect(ids(planRepair(withMeta('text'), '1.x')))
			.toEqual([])
		expect(ids(planRepair(withMeta({ other: 1 }), '1.x')))
			.toEqual(['move-style'])
	})
})

describe('applying the plan', () => {
	it.each([
		['v1', legacyV1, '1.x', ['rename-slot', 'rename-type', 'rename-config-text', 'move-style', 'fix-duplicate-ids', 'rewrite-no-id']],
		['v2', legacyV2, '2.x', ['convert-until']],
	] as const)('every step of the %s plan applies in order and the end result is a valid Blueprint', (_name, source, savedWith, expected) => {
		const { document, applied } = repairByPlan(source, savedWith as SavedWith)
		expect(applied)
			.toEqual(expected)
		const snapshot = document.getSnapshot()
		expect(snapshot.revision)
			.toBe(expected.length)
		expect(snapshot.blueprint.status)
			.toBe('valid')
		expect(snapshot.blueprint.diagnostics)
			.toEqual([])
		expect(planRepair(snapshot.blueprint.source, savedWith as SavedWith))
			.toEqual([])
	})

	it('repairs v1 into the document the app now writes: the notices in order, one id each, the style in meta, the whole element replaced', () => {
		const { document } = repairByPlan(legacyV1, '1.x')
		expect(document.getSnapshot().blueprint.source)
			.toEqual({
				id: 'board',
				type: 'Board',
				config: legacyV1.config,
				slots: {
					notices: [
						{ id: 'welcome', type: 'Notice', meta: { style: 'highlight' }, config: { title: 'Welcome back', body: 'The workshop reopens on Monday.', until: '2026-12-31', tone: 'info' } },
						{ id: 'closure', type: 'Notice', config: { title: 'Closed on Friday', body: 'The laser cutter is being serviced.', until: '2026-12-04', tone: 'warning' } },
						{ id: 'closure-2', type: 'Notice', config: { title: 'Closed on Saturday', body: 'No induction this week.', until: '2026-12-05', tone: 'warning' } },
						{ id: 'notice-1', type: 'Notice', config: { title: 'Lost property', body: 'A grey scarf is waiting at the desk.', until: '2026-12-18', tone: 'info' } },
					],
				},
			})
	})

	it('repairs v2 by replacing only the epoch values with their UTC dates', () => {
		const { document } = repairByPlan(legacyV2, '2.x')
		const notices = (document.getSnapshot().blueprint.source as { slots: { notices: { config: { until: string } }[] } }).slots.notices
		expect(notices.map(notice => notice.config.until))
			.toEqual(['2026-12-31', '2026-12-04', '2027-01-31'])
	})

	it('leaves the stored fixture untouched: the document works on a copy', () => {
		const before = JSON.stringify(legacyV1)
		repairByPlan(legacyV1, '1.x')
		expect(JSON.stringify(legacyV1))
			.toBe(before)
	})

	it('addresses each step\'s targets with paths that match what Core says (the diagnostics\' node paths)', () => {
		const blueprint = boardSystem.createBlueprint(structuredClone(legacyV1))
		const paths = blueprint.diagnostics.flatMap(diagnostic => 'node' in diagnostic.location ? [blueprint.getSourcePath(diagnostic.location.node)] : [])
		// The undeclared slot is reported on the root; the Banner nodes are the children of the raw slot `items`.
		expect(paths)
			.toContainEqual([])
		expect(paths)
			.toContainEqual(['slots', 'items', 3])
	})

	it('the draft the app has no rule for stays invalid after its only step: Core still creates no Runtime for it', () => {
		const { document, applied } = repairByPlan(legacyPoll, '2.x')
		expect(applied)
			.toEqual(['convert-until'])
		const blueprint = document.getSnapshot().blueprint
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics.map(diagnostic => diagnostic.code))
			.toEqual(['unknown-widget-type'])
		expect(planRepair(blueprint.source, '2.x'))
			.toEqual([])
		expect('createRuntime' in blueprint && typeof (blueprint as { createRuntime?: unknown }).createRuntime)
			.not
			.toBe('function')
	})
})

describe('the test guards', () => {
	it('make a step fail atomically with test-failed when its precondition no longer holds', () => {
		const document = createWidgetDocument({ system: boardSystem, source: structuredClone(legacyV2) })
		const [step] = planRepair(document.getSnapshot().blueprint.source, '2.x')
		// Another writer changed the value the step was planned against.
		expect(document.applyPatch([{ op: 'replace', path: ['slots', 'notices', 1, 'config', 'until'], value: Date.UTC(2027, 0, 1) }]).ok)
			.toBe(true)
		const before = document.getSnapshot()
		const result = document.applyPatch(step!.patch)
		expect(result.ok)
			.toBe(false)
		if (!result.ok) {
			expect(result.failure.code)
				.toBe('test-failed')
			// The failing guard is the second test of the patch (operations 0 and 1 are the first notice's test and replace).
			expect((result.failure as { operationIndex?: number }).operationIndex)
				.toBe(2)
		}
		// Atomic: the replace of the first notice that came before the failing guard was not kept.
		expect(document.getSnapshot())
			.toBe(before)
		expect((document.getSnapshot().blueprint.source as { slots: { notices: { config: { until: unknown } }[] } }).slots.notices[0]!.config.until)
			.toBe(Date.UTC(2026, 11, 31))
	})

	it('guard the slot move on the exact array that was planned against', () => {
		const document = createWidgetDocument({ system: boardSystem, source: structuredClone(legacyV1) })
		const [move] = planRepair(document.getSnapshot().blueprint.source, '1.x')
		expect(document.applyPatch([{ op: 'remove', path: ['slots', 'items', 0] }]).ok)
			.toBe(true)
		const result = document.applyPatch(move!.patch)
		expect(result.ok)
			.toBe(false)
		if (!result.ok) {
			expect(result.failure.code)
				.toBe('test-failed')
		}
	})
})
