/**
 * The Lab-side zh-TW text of the Quote rules showcase: the Examples menu entries (the showcase and its presets). The
 * tutorial strings are checked against the script in `tutorial/quote-rules-script.unit.test.ts`, and the showcase's own
 * text lives in the showcase (`showcases/quote-rules/messages.ts`). This file lives here, not in the showcase, because
 * it reads the Lab's i18n tables, which a showcase must not import.
 */

import { describe, expect, it } from 'vitest'
import { quoteMessages } from '../showcases/quote-rules/messages'
import { quotePresets } from '../showcases/quote-rules/presets'
import { translateMessage } from './messages'
import { translatePresentationMessage } from './presentation-messages'

describe('quote-rules Examples menu text', () => {
	it('has a zh-TW label and description for every preset (the Examples menu translates them)', () => {
		for (const preset of quotePresets) {
			expect(translatePresentationMessage('zh-TW', preset.label), preset.label)
				.not
				.toBe(preset.label)
			expect(translatePresentationMessage('zh-TW', preset.description), preset.id)
				.not
				.toBe(preset.description)
		}
	})

	it('names the showcase in zh-TW and leaves English as written', () => {
		expect(translatePresentationMessage('zh-TW', 'Quote rules shared by browser and backend'))
			.toBe('報價規則：瀏覽器與後端共用')
		expect(translateMessage('en', 'Quote rules shared by browser and backend'))
			.toBe('Quote rules shared by browser and backend')
	})
})

describe('the showcase\'s own messages', () => {
	it('has every key in both locales, and keeps the same {markers} in each', () => {
		expect(Object.keys(quoteMessages['zh-TW']))
			.toEqual(Object.keys(quoteMessages.en))
		const markers = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]!)
			.sort()
		for (const key of Object.keys(quoteMessages.en) as (keyof typeof quoteMessages.en)[]) {
			expect(markers(quoteMessages['zh-TW'][key]), key)
				.toEqual(markers(quoteMessages.en[key]))
			expect(quoteMessages['zh-TW'][key], key)
				.not
				.toBe('')
		}
	})
})
