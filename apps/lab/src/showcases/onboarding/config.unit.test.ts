/**
 * The config checkers: every problem is reported (not just the first) at its exact path with a machine-readable
 * reason, unknown keys are rejected, and a valid config reports nothing.
 */

import type { ConfigDiagnostic } from './config'
import { describe, expect, it } from 'vitest'
import { checkAccountConfig, checkInductionConfig, checkInterestsConfig, checkOnboardingConfig, checkSafetyConfig, resolveAccountConfig, resolveInductionConfig, resolveInterestsConfig, resolveOnboardingConfig, resolveSafetyConfig } from './config'

function run(check: (input: unknown, report: (diagnostic: ConfigDiagnostic) => void) => void, input: unknown): { reason: string | undefined, path: string }[] {
	const found: ConfigDiagnostic[] = []
	check(input, diagnostic => found.push(diagnostic))
	return found.map(({ reason, path }) => ({ reason, path: (path ?? []).join('.') }))
}

const title = { en: 'Title' }

describe('checkOnboardingConfig', () => {
	it('accepts a title and a start step, and rejects anything else', () => {
		expect(run(checkOnboardingConfig, { title, startStep: 2 }))
			.toEqual([])
		expect(run(checkOnboardingConfig, { title: { en: ' ' }, startStep: -1, extra: true }))
			.toEqual([{ reason: 'unknown-key', path: 'extra' }, { reason: 'empty-text', path: 'title.en' }, { reason: 'out-of-range', path: 'startStep' }])
		expect(run(checkOnboardingConfig, null))
			.toEqual([{ reason: 'not-an-object', path: '' }])
	})
})

describe('checkAccountConfig', () => {
	it('accepts an optional prefill and reports a bad e-mail address in it', () => {
		expect(run(checkAccountConfig, { title, prefill: { name: 'Sam', email: 'sam@example.org' } }))
			.toEqual([])
		expect(run(checkAccountConfig, { title, prefill: { name: 3, email: 'sam' } }))
			.toEqual([{ reason: 'invalid-type', path: 'prefill.name' }, { reason: 'invalid-email', path: 'prefill.email' }])
	})
})

describe('checkInterestsConfig', () => {
	const options = [{ id: 'a', label: title }, { id: 'b', label: title }]

	it('accepts options, a minimum and preselected ids', () => {
		expect(run(checkInterestsConfig, { title, options, minimum: 2, preselected: ['a'] }))
			.toEqual([])
	})

	it('reports bad and repeated ids, a minimum nobody could reach and unknown or repeated preselected ids, each where it is', () => {
		expect(run(checkInterestsConfig, { title, options: [{ id: 'A', label: title }, { id: 'b', label: title }, { id: 'b', label: title }], minimum: 9 }))
			.toEqual([{ reason: 'invalid-id', path: 'options.0.id' }, { reason: 'duplicate-id', path: 'options.2.id' }, { reason: 'out-of-range', path: 'minimum' }])
		expect(run(checkInterestsConfig, { title, options, preselected: ['a', 'a', 'z', 3] }))
			.toEqual([{ reason: 'duplicate-entry', path: 'preselected.1' }, { reason: 'unknown-id', path: 'preselected.2' }, { reason: 'invalid-type', path: 'preselected.3' }])
		expect(run(checkInterestsConfig, { title, options: [] }))
			.toEqual([{ reason: 'empty-list', path: 'options' }])
	})
})

describe('checkSafetyConfig', () => {
	it('checks rule ids and the acknowledged ids against them', () => {
		const rules = [{ id: 'shoes', text: title }]
		expect(run(checkSafetyConfig, { title, rules, acknowledged: ['shoes'] }))
			.toEqual([])
		expect(run(checkSafetyConfig, { title, rules, acknowledged: ['helmet'] }))
			.toEqual([{ reason: 'unknown-id', path: 'acknowledged.0' }])
		expect(run(checkSafetyConfig, { title, rules: [{ id: 'shoes', text: { en: '' } }] }))
			.toEqual([{ reason: 'empty-text', path: 'rules.0.text.en' }])
	})
})

describe('checkInductionConfig', () => {
	it('needs real dates and times, each listed once', () => {
		expect(run(checkInductionConfig, { title, days: ['2026-12-05'], times: ['10:00'] }))
			.toEqual([])
		expect(run(checkInductionConfig, { title, days: ['2026-02-30', '2026-12-05', '2026-12-05'], times: ['24:00', '9:00'] }))
			.toEqual([
				{ reason: 'invalid-date', path: 'days.0' },
				{ reason: 'duplicate-entry', path: 'days.2' },
				{ reason: 'invalid-time', path: 'times.0' },
				{ reason: 'invalid-time', path: 'times.1' },
			])
		expect(run(checkInductionConfig, { title }))
			.toEqual([{ reason: 'missing-key', path: 'days' }, { reason: 'missing-key', path: 'times' }])
	})
})

describe('resolve', () => {
	it('fills the defaults, and a recovered config is marked and empty', () => {
		expect(resolveOnboardingConfig({ title }))
			.toEqual({ title, startStep: 0, recovered: false })
		expect(resolveAccountConfig({ title }))
			.toEqual({ title, name: '', email: '', recovered: false })
		expect(resolveInterestsConfig({ title, options: [] }))
			.toMatchObject({ minimum: 1, preselected: [], recovered: false })
		expect(resolveSafetyConfig({ title, rules: [] }))
			.toMatchObject({ acknowledged: [], recovered: false })
		for (const recovered of [resolveOnboardingConfig(null), resolveAccountConfig(null), resolveInterestsConfig(null), resolveSafetyConfig(null), resolveInductionConfig(null)]) {
			expect(recovered.recovered)
				.toBe(true)
		}
	})
})
