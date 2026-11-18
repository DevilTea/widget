// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { translatePresentationMessage } from '../../i18n/presentation-messages'
import GraphKey from './GraphKey.vue'

function keyIn(locale: 'en' | 'zh-TW') {
	return mount(GraphKey, {
		global: {
			provide: {
				[LabI18nKey as symbol]: {
					locale: { value: locale },
					locales: ['en', 'zh-TW'],
					setLocale: () => {},
					t: (source: string) => locale === 'en' ? source : translatePresentationMessage(locale, source),
				},
			},
		},
	})
}

describe('graphKey direction', () => {
	it('says first, with an arrow, that an edge points to what its owner depends on', () => {
		const wrapper = keyIn('en')
		const direction = wrapper.get('[data-testid="graph-key-direction"]')
		expect(direction.text())
			.toBe('A → B: A depends on B')
		expect(direction.find('svg')
			.exists())
			.toBe(true)
		// First in the row, ahead of the member badges and the three line styles.
		expect(wrapper.findAll('li')[0]!.attributes('data-testid'))
			.toBe('graph-key-direction')
	})

	it('says it in zh-TW with the Relations view\'s word for it', () => {
		expect(keyIn('zh-TW')
			.get('[data-testid="graph-key-direction"]')
			.text())
			.toBe('A → B：A 依賴於 B')
		expect(translatePresentationMessage('zh-TW', 'Depends on'))
			.toBe('依賴於')
	})
})
