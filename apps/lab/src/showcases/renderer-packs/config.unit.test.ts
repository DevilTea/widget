/**
 * The config checkers report located, machine-readable diagnostics (path and reason), and a config that failed its own validation
 * is compiled with a recovered fallback. That the generated config schemas list exactly the keys the checkers accept is pinned by
 * `lab/showcase-config-schemas.unit.test.ts`.
 */

import type { ConfigDiagnostic } from './config'
import { describe, expect, it } from 'vitest'
import { checkAppearanceConfig, checkChoiceConfig, checkDangerActionConfig, checkNotifierConfig, checkSectionConfig, checkSettingsPageConfig, checkTextFieldConfig, checkToggleConfig, resolveChoiceConfig, resolveDangerActionConfig } from './config'

function reasons(check: (input: unknown, report: (diagnostic: ConfigDiagnostic) => void) => void, input: unknown): readonly (readonly [string | undefined, string])[] {
	const found: (readonly [string | undefined, string])[] = []
	check(input, diagnostic => found.push([diagnostic.reason, (diagnostic.path ?? []).join('.')]))
	return found
}

describe('config checkers', () => {
	it('report a non-object, unknown keys and missing keys', () => {
		expect(reasons(checkSettingsPageConfig, 'x'))
			.toEqual([['not-an-object', '']])
		expect(reasons(checkSettingsPageConfig, { title: { en: 'T' }, colour: 'red' }))
			.toEqual([['unknown-key', 'colour']])
		expect(reasons(checkSectionConfig, {}))
			.toEqual([['missing-key', 'title']])
	})

	it('report text without an English text, and a language that is not a string', () => {
		expect(reasons(checkSectionConfig, { title: { 'zh-TW': 'x' } }))
			.toEqual([['empty-text', 'title.en']])
		expect(reasons(checkSectionConfig, { title: { 'en': 'x', 'zh-TW': 3 } }))
			.toEqual([['invalid-type', 'title.zh-TW']])
	})

	it('report an unknown density, mode, tone and an unusable limit', () => {
		expect(reasons(checkAppearanceConfig, { density: 'huge', mode: 'sepia' }))
			.toEqual([['unknown-density', 'density'], ['unknown-mode', 'mode']])
		expect(reasons(checkNotifierConfig, { limit: 11 }))
			.toEqual([['invalid-limit', 'limit']])
		expect(reasons(checkNotifierConfig, { limit: 2.5 }))
			.toEqual([['invalid-limit', 'limit']])
		expect(reasons(checkNotifierConfig, {}))
			.toEqual([])
	})

	it('report a text field\'s unusable limit and a toggle that is not a boolean', () => {
		const field = { label: { en: 'L' }, appearance: 'look', maxLength: 0 }
		expect(reasons(checkTextFieldConfig, field))
			.toEqual([['invalid-max-length', 'maxLength']])
		expect(reasons(checkTextFieldConfig, { ...field, maxLength: 5, value: 3 }))
			.toEqual([['invalid-type', 'value']])
		expect(reasons(checkToggleConfig, { label: { en: 'L' }, appearance: 'look', on: 'yes' }))
			.toEqual([['invalid-type', 'on']])
	})

	it('report an id that is not a name, for a provider reference', () => {
		expect(reasons(checkToggleConfig, { label: { en: 'L' }, appearance: '' }))
			.toEqual([['empty-id', 'appearance']])
		expect(reasons(checkToggleConfig, { label: { en: 'L' }, appearance: 4 }))
			.toEqual([['invalid-type', 'appearance']])
	})

	it('report a choice with fewer than two options, a repeated value and an initial value that is no option', () => {
		const choice = { label: { en: 'L' }, appearance: 'look' }
		expect(reasons(checkChoiceConfig, { ...choice, options: [{ value: 'a', label: { en: 'A' } }] }))
			.toEqual([['too-few-options', 'options']])
		expect(reasons(checkChoiceConfig, { ...choice, options: [{ value: 'a', label: { en: 'A' } }, { value: 'a', label: { en: 'B' } }] }))
			.toEqual([['duplicate-option', 'options.1.value']])
		expect(reasons(checkChoiceConfig, { ...choice, value: 'z', options: [{ value: 'a', label: { en: 'A' } }, { value: 'b', label: { en: 'B' } }] }))
			.toEqual([['unknown-option', 'value']])
	})

	it('report a DangerAction without its Notifier or with an unknown tone', () => {
		const action = { label: { en: 'L' }, confirmText: { en: 'C' }, message: { en: 'M' }, notifier: 'n', appearance: 'a' }
		expect(reasons(checkDangerActionConfig, action))
			.toEqual([])
		expect(reasons(checkDangerActionConfig, { ...action, notifier: undefined, tone: 'loud' }))
			.toContainEqual(['unknown-tone', 'tone'])
	})
})

describe('resolve', () => {
	it('marks the fallback of a config that failed validation as recovered, and a good one as not', () => {
		expect(resolveChoiceConfig(null))
			.toMatchObject({ options: [], value: '', recovered: true })
		expect(resolveDangerActionConfig(null))
			.toMatchObject({ tone: 'danger', recovered: true })
		expect(resolveChoiceConfig({ label: { en: 'L' }, appearance: 'a', options: [{ value: 'a', label: { en: 'A' } }, { value: 'b', label: { en: 'B' } }] }))
			.toMatchObject({ value: 'a', recovered: false })
	})
})
