// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { defineShowcaseMessages, ShowcaseHostKey, translateShowcaseMessage, useShowcaseHost, useShowcaseMessages } from './index'

const messages = defineShowcaseMessages({
	'en': { greeting: 'Hello' },
	'zh-TW': { greeting: '哈囉' },
})

describe('showcase host contract', () => {
	it('selects a showcase message by locale', () => {
		expect(translateShowcaseMessage(messages, 'en', 'greeting'))
			.toBe('Hello')
		expect(translateShowcaseMessage(messages, 'zh-TW', 'greeting'))
			.toBe('哈囉')
	})

	it('re-renders a showcase component when the host locale and theme change', async () => {
		const locale = shallowRef<'en' | 'zh-TW'>('en')
		const theme = shallowRef<'light' | 'dark'>('dark')
		const Probe = defineComponent({
			setup() {
				const host = useShowcaseHost()
				const { t } = useShowcaseMessages(messages)
				return () => h('p', { 'data-theme': host.theme.value }, t('greeting'))
			},
		})
		const wrapper = mount(Probe, { global: { provide: { [ShowcaseHostKey as symbol]: { locale, theme } } } })
		expect([wrapper.text(), wrapper.attributes('data-theme')])
			.toEqual(['Hello', 'dark'])

		locale.value = 'zh-TW'
		theme.value = 'light'
		await nextTick()
		expect([wrapper.text(), wrapper.attributes('data-theme')])
			.toEqual(['哈囉', 'light'])
		wrapper.unmount()
	})

	it('fails loudly outside a host provider', () => {
		const Probe = defineComponent({
			setup() {
				useShowcaseHost()
				return () => null
			},
		})
		const warn = vi.spyOn(console, 'warn')
			.mockImplementation(() => {})
		expect(() => mount(Probe))
			.toThrow('useShowcaseHost() was called outside a ShowcaseHost provider')
		warn.mockRestore()
	})
})
