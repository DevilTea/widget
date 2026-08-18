import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

describe('presentation localization boundary', () => {
	it('translates audited Lab chrome including integrated theme/catalog surfaces', () => {
		expect(translatePresentationMessage('zh-TW', 'Applied instance'))
			.toBe('已套用 instance')
		expect(translatePresentationMessage('zh-TW', 'Legend'))
			.toBe('圖例')
		expect(translatePresentationMessage('zh-TW', 'Trip days'))
			.toBe('旅遊天數')
		expect(translatePresentationMessage('zh-TW', 'Theme'))
			.toBe('主題')
		expect(translatePresentationMessage('zh-TW', 'Light'))
			.toBe('亮色')
		expect(translatePresentationMessage('zh-TW', 'Registered plugins'))
			.toBe('已註冊 plugins')
	})

	it('leaves representative semantic/source/core strings verbatim when they are not audited presentation copy', () => {
		for (const value of [
			'Text',
			'Counter',
			'title',
			'count',
			'apps/widget-lab/src/sandbox/plugins.ts',
			'createWidgetPlugin(\'Text\')',
			'[definition] Unknown widget type: UnknownForI18nContract',
		]) {
			expect(translatePresentationMessage('zh-TW', value))
				.toBe(value)
		}
	})
})
