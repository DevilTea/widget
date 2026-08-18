// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLabThemeStore } from './use-lab-theme'

const STORAGE_KEY = 'widget-lab:theme'

describe('lab theme store', () => {
	beforeEach(() => {
		localStorage.clear()
		document.documentElement.removeAttribute('data-lab-theme')
		document.documentElement.removeAttribute('style')
	})

	it('uses system preference only when no explicit stored theme exists', () => {
		vi.stubGlobal('matchMedia', vi.fn()
			.mockReturnValue({ matches: true }))
		const systemStore = createLabThemeStore()
		expect(systemStore.theme.value)
			.toBe('dark')
		expect(localStorage.getItem(STORAGE_KEY))
			.toBeNull()

		localStorage.setItem(STORAGE_KEY, 'light')
		const storedStore = createLabThemeStore()
		expect(storedStore.theme.value)
			.toBe('light')
	})

	it('persists explicit choices and applies document theme without reload state', () => {
		vi.stubGlobal('matchMedia', vi.fn()
			.mockReturnValue({ matches: false }))
		const store = createLabThemeStore()
		store.setTheme('dark')

		expect(store.theme.value)
			.toBe('dark')
		expect(localStorage.getItem(STORAGE_KEY))
			.toBe('dark')
		expect(document.documentElement.dataset.labTheme)
			.toBe('dark')
		expect(document.documentElement.style.colorScheme)
			.toBe('dark')
	})
})
