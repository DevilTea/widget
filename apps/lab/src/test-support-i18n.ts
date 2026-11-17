/**
 * A real-translation `LabI18nStore` for unit tests that mount components calling `useLabI18n()`: English or zh-TW
 * strings come from the actual catalogs, so a test pins the copy a user would see and a missing translation shows.
 *
 * Usage: `mount(Component, { global: { provide: labI18nProvide('zh-TW') } })`.
 */
import { shallowRef } from 'vue'
import { LabI18nKey } from './composables/use-lab-i18n'
import { translatePresentationMessage } from './i18n/presentation-messages'

export function labI18nProvide(locale: 'en' | 'zh-TW' = 'en'): Record<symbol, unknown> {
	return {
		[LabI18nKey as symbol]: {
			locale: shallowRef(locale),
			locales: ['en', 'zh-TW'],
			setLocale: () => {},
			t: (source: string, params?: Readonly<Record<string, string | number>>) => translatePresentationMessage(locale, source)
				.replace(/\{(\w+)\}/g, (match, key: string) => params?.[key] === undefined ? match : String(params[key])),
		},
	}
}
