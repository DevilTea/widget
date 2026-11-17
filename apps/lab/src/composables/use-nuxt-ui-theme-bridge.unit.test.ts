// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'
import { createLabThemeStore } from './use-lab-theme'
import { applyNuxtUiThemeClass, NUXT_UI_DARK_CLASS, useNuxtUiThemeBridge } from './use-nuxt-ui-theme-bridge'

afterEach(() => {
	document.documentElement.className = ''
	document.documentElement.removeAttribute('data-lab-theme')
	localStorage.clear()
})

describe('nuxt ui theme bridge', () => {
	it('toggles only the dark class on the given root', () => {
		const root = document.createElement('html')
		root.className = 'keep'
		applyNuxtUiThemeClass(root, 'dark')
		expect(root.classList.contains(NUXT_UI_DARK_CLASS))
			.toBe(true)
		expect(root.classList.contains('keep'))
			.toBe(true)
		applyNuxtUiThemeClass(root, 'light')
		expect(root.classList.contains(NUXT_UI_DARK_CLASS))
			.toBe(false)
		expect(root.classList.contains('keep'))
			.toBe(true)
	})

	it('follows the Lab theme store in the same task, from the first value on', () => {
		localStorage.setItem('widget-lab:theme', 'dark')
		const scope = effectScope()
		scope.run(() => {
			const store = createLabThemeStore()
			useNuxtUiThemeBridge(store.theme)
			expect(document.documentElement.dataset.labTheme)
				.toBe('dark')
			expect(document.documentElement.classList.contains('dark'))
				.toBe(true)

			store.setTheme('light')
			expect(document.documentElement.dataset.labTheme)
				.toBe('light')
			expect(document.documentElement.classList.contains('dark'))
				.toBe(false)

			store.setTheme('dark')
			expect(document.documentElement.classList.contains('dark'))
				.toBe(true)
		})
		scope.stop()
	})

	it('stops following once its scope is disposed', async () => {
		const theme = shallowRef<'light' | 'dark'>('light')
		const root = document.createElement('html')
		const scope = effectScope()
		scope.run(() => useNuxtUiThemeBridge(theme, root))
		scope.stop()
		theme.value = 'dark'
		await nextTick()
		expect(root.classList.contains('dark'))
			.toBe(false)
	})
})
