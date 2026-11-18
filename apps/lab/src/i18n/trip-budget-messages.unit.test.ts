/**
 * The Lab-side zh-TW text of the Trip budget showcase: the Examples menu entries (the showcase and its presets). The
 * tutorial strings are checked against the script in `tutorial/trip-budget-script.unit.test.ts`, and the showcase's own
 * text lives in the showcase (`showcases/trip-budget/domain.ts`). This file lives here, not in the showcase, because it
 * reads the Lab's i18n tables, which a showcase must not import.
 */

import { describe, expect, it } from 'vitest'
import { tripBudgetPresets } from '../showcases/trip-budget/presets'
import { translateMessage } from './messages'
import { translatePresentationMessage } from './presentation-messages'

describe('trip-budget Examples menu text', () => {
	it('has a zh-TW label and description for every preset (the Examples menu translates them)', () => {
		for (const preset of tripBudgetPresets) {
			expect(translatePresentationMessage('zh-TW', preset.label), preset.label)
				.not
				.toBe(preset.label)
			expect(translatePresentationMessage('zh-TW', preset.description), preset.id)
				.not
				.toBe(preset.description)
		}
	})

	it('names the showcase in zh-TW and leaves English as written', () => {
		expect(translatePresentationMessage('zh-TW', 'Trip budget splitter'))
			.toBe('旅行分帳')
		expect(translateMessage('en', 'Trip budget splitter'))
			.toBe('Trip budget splitter')
	})
})
