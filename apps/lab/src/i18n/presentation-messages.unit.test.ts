import { describe, expect, it } from 'vitest'
import { translatePresentationMessage } from './presentation-messages'

describe('presentation localization boundary', () => {
	it('translates audited Lab chrome including integrated theme/catalog surfaces', () => {
		expect(translatePresentationMessage('zh-TW', 'Applied instance'))
			.toBe('已套用 instance')
		expect(translatePresentationMessage('zh-TW', 'Legend'))
			.toBe('圖例')
		expect(translatePresentationMessage('zh-TW', 'Response — what a backend reads'))
			.toBe('回應——後端讀取的內容')
		expect(translatePresentationMessage('zh-TW', 'Theme'))
			.toBe('主題')
		expect(translatePresentationMessage('zh-TW', 'Light'))
			.toBe('亮色')
		expect(translatePresentationMessage('zh-TW', 'Registered plugins'))
			.toBe('已註冊 plugins')
	})

	it('translates the Method emits marker copy in zh-TW and leaves English verbatim', () => {
		expect(translatePresentationMessage('zh-TW', 'Emits an Event directly or through the Methods it invokes'))
			.toBe('直接或透過它所呼叫的 Methods 發出 Event')
		expect(translatePresentationMessage('zh-TW', 'Method — an "E" badge means it transitively emits an Event'))
			.toBe('Method——「E」標記表示它會 transitively 發出 Event')
		expect(translatePresentationMessage('en', 'Emits an Event directly or through the Methods it invokes'))
			.toBe('Emits an Event directly or through the Methods it invokes')
	})

	it('leaves representative semantic/source/core strings verbatim when they are not audited presentation copy', () => {
		for (const value of [
			'Text',
			'Counter',
			'title',
			'count',
			'apps/lab/src/sandbox/plugins.ts',
			'createWidgetPlugin(\'Text\')',
			'[definition] Unknown widget type: UnknownForI18nContract',
		]) {
			expect(translatePresentationMessage('zh-TW', value))
				.toBe(value)
		}
	})
})
