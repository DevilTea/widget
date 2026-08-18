// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createLabI18nStore } from './use-lab-i18n'

const STORAGE_KEY = 'widget-lab:locale'

describe('lab i18n store', () => {
	beforeEach(() => {
		localStorage.clear()
		history.replaceState({}, '', '/')
		document.documentElement.lang = ''
	})

	it('makes an explicit query authoritative, persists it, and preserves unrelated URL state', () => {
		localStorage.setItem(STORAGE_KEY, 'en')
		history.replaceState({}, '', '/?probe=keep&lang=zh-TW#anchor')

		const store = createLabI18nStore()

		expect(store.locale.value).toBe('zh-TW')
		expect(localStorage.getItem(STORAGE_KEY)).toBe('zh-TW')
		expect(document.documentElement.lang).toBe('zh-TW')
		expect(location.search).toBe('?probe=keep&lang=zh-TW')
		expect(location.hash).toBe('#anchor')
	})

	it('reactively changes only the presentation preference and canonical URL', () => {
		history.replaceState({}, '', '/?probe=keep#anchor')
		localStorage.setItem(STORAGE_KEY, 'zh-TW')
		const store = createLabI18nStore()

		expect(store.t('Apply')).toBe('套用')
		expect(location.search).toBe('?probe=keep&lang=zh-TW')

		store.setLocale('en')

		expect(store.locale.value).toBe('en')
		expect(store.t('Apply')).toBe('Apply')
		expect(localStorage.getItem(STORAGE_KEY)).toBe('en')
		expect(document.documentElement.lang).toBe('en')
		expect(location.search).toBe('?probe=keep&lang=en')
		expect(location.hash).toBe('#anchor')
	})

	it('falls back to the English source string when zh-TW has no presentation translation', () => {
		history.replaceState({}, '', '/?lang=zh-TW')
		const store = createLabI18nStore()
		expect(store.t('semantic-id-that-must-not-be-inferred')).toBe('semantic-id-that-must-not-be-inferred')
	})
})
