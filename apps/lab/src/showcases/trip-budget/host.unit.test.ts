// @vitest-environment happy-dom
/**
 * `host.ts`, the showcase's one contact with the Lab: it adapts the Lab's locale and theme stores to two refs, and
 * falls back to English and light when it is not inside the Lab.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { LabThemeKey } from '../../composables/use-lab-theme'
import { useTripShowcaseHost } from './host'

function hostIn(provide: Record<symbol, unknown>) {
	let host!: ReturnType<typeof useTripShowcaseHost>
	mount(defineComponent({
		setup() {
			host = useTripShowcaseHost()
			return () => h('div')
		},
	}), { global: { provide } })
	return host
}

describe('useTripShowcaseHost', () => {
	it('falls back to English and light outside the Lab', () => {
		const host = hostIn({})
		expect(host.locale.value)
			.toBe('en')
		expect(host.theme.value)
			.toBe('light')
	})

	it('follows the Lab\'s locale and theme as they change', () => {
		const locale = shallowRef('zh-TW')
		const theme = shallowRef<'light' | 'dark'>('dark')
		const host = hostIn({
			[LabI18nKey as symbol]: { locale },
			[LabThemeKey as symbol]: { theme },
		})
		expect(host.locale.value)
			.toBe('zh-TW')
		expect(host.theme.value)
			.toBe('dark')
		locale.value = 'en'
		theme.value = 'light'
		expect(host.locale.value)
			.toBe('en')
		expect(host.theme.value)
			.toBe('light')
	})
})
