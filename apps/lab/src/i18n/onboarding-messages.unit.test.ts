/**
 * The Lab-side zh-TW text of the Onboarding showcase: the Examples menu entries (the showcase and its presets). The
 * tutorial strings are checked against the script in `tutorial/onboarding-script.unit.test.ts`, and the showcase's own
 * text lives in the showcase (`showcases/onboarding/messages.ts`). This file lives here, not in the showcase, because
 * it reads the Lab's i18n tables, which a showcase must not import.
 */

import { describe, expect, it } from 'vitest'
import { onboardingMessages } from '../showcases/onboarding/messages'
import { onboardingPresets } from '../showcases/onboarding/presets'
import { onboardingTourScript } from '../tutorial/onboarding-script'
import { translateMessage } from './messages'
import { translatePresentationMessage } from './presentation-messages'

describe('the tour quotes the Lab\'s own labels', () => {
	it('names the Method row status the way the zh-TW Lab shows it', () => {
		const reveal = onboardingTourScript.steps.find(step => step.id === 'refused-move')!.stages[0].reveal
		const zh = translatePresentationMessage('zh-TW', reveal)
		expect(reveal)
			.toContain('"Last call failed"')
		expect(zh)
			.toContain(`「${translatePresentationMessage('zh-TW', 'Last call failed')}」`)
		expect(zh)
			.not
			.toContain('Last call failed')
	})
})

describe('onboarding Examples menu text', () => {
	it('has a zh-TW label and description for every preset (the Examples menu translates them)', () => {
		for (const preset of onboardingPresets) {
			expect(translatePresentationMessage('zh-TW', preset.label), preset.label)
				.not
				.toBe(preset.label)
			expect(translatePresentationMessage('zh-TW', preset.description), preset.id)
				.not
				.toBe(preset.description)
		}
	})

	it('names the showcase in zh-TW and leaves English as written', () => {
		expect(translatePresentationMessage('zh-TW', 'Onboarding wizard with an Events log'))
			.toBe('新成員引導精靈：Events 與 Method 診斷')
		expect(translateMessage('en', 'Onboarding wizard with an Events log'))
			.toBe('Onboarding wizard with an Events log')
	})
})

describe('the showcase\'s own messages', () => {
	it('has every key in both locales, and keeps the same {markers} in each', () => {
		expect(Object.keys(onboardingMessages['zh-TW']))
			.toEqual(Object.keys(onboardingMessages.en))
		const markers = (value: string): string[] => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]!)
			.sort()
		for (const key of Object.keys(onboardingMessages.en) as (keyof typeof onboardingMessages.en)[]) {
			expect(markers(onboardingMessages['zh-TW'][key]), key)
				.toEqual(markers(onboardingMessages.en[key]))
			expect(onboardingMessages['zh-TW'][key], key)
				.not
				.toBe('')
		}
	})
})
