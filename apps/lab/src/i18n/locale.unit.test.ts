import { describe, expect, it } from 'vitest'
import { localeFromBrowserLanguages, parseLabLocale, resolveLabLocale } from './locale'

describe('lab locale resolution', () => {
	it('accepts only the two supported URL/storage locale ids', () => {
		expect(parseLabLocale('en'))
			.toBe('en')
		expect(parseLabLocale('zh-TW'))
			.toBe('zh-TW')
		expect(parseLabLocale('zh'))
			.toBeNull()
		expect(parseLabLocale('zh-CN'))
			.toBeNull()
		expect(parseLabLocale('en-US'))
			.toBeNull()
	})

	it('maps Taiwan/Hant browser languages to zh-TW and English variants to en', () => {
		expect(localeFromBrowserLanguages(['zh-Hant-HK']))
			.toBe('zh-TW')
		expect(localeFromBrowserLanguages(['zh-TW']))
			.toBe('zh-TW')
		expect(localeFromBrowserLanguages(['en-US']))
			.toBe('en')
		expect(localeFromBrowserLanguages(['ja-JP', 'fr-FR']))
			.toBeNull()
	})

	it('uses query > storage > browser > English fallback', () => {
		expect(resolveLabLocale({ queryLocale: 'zh-TW', storedLocale: 'en', browserLanguages: ['en-US'] }))
			.toBe('zh-TW')
		expect(resolveLabLocale({ queryLocale: 'bad', storedLocale: 'zh-TW', browserLanguages: ['en-US'] }))
			.toBe('zh-TW')
		expect(resolveLabLocale({ storedLocale: 'bad', browserLanguages: ['zh-Hant'] }))
			.toBe('zh-TW')
		expect(resolveLabLocale({ browserLanguages: ['ja-JP'] }))
			.toBe('en')
	})
})
