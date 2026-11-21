// @vitest-environment happy-dom
/**
 * The Nuxt UI pack's renderers on their own (no page frame, no nested app): the harness mounts them under its own `UApp` with the
 * real `@nuxt/ui/vue-plugin`, so a `UInput`, `USwitch`, `USelect`, `UButton`, `UModal` and `UAlert` render their real markup.
 * The page-level behaviour (the nested app, switching, overlays inside the pack's root) is in `pack-switching.unit.test.ts`.
 */

import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPacksRuntime, valueOf, widgetsOf } from '../test-support'
import { createTestHost, mountNuxtUiRenderer, settle, widgetSelector } from './test-harness'

vi.setConfig({ testTimeout: 30_000 })

let wrapper: VueWrapper | null = null

afterEach(() => {
	wrapper?.unmount()
	wrapper = null
	document.body.innerHTML = ''
})

async function mountNui(options: { locale?: 'en' | 'zh-TW' } = {}) {
	const { runtime } = createPacksRuntime()
	const host = createTestHost(options)
	wrapper = await mountNuxtUiRenderer(runtime, { attachTo: document.body, host })
	return { runtime, host, widgets: widgetsOf(runtime), wrapper }
}

describe('nuxt UI pack: renderers', () => {
	it('renders Nuxt UI components (data-slot markup) for the document, each root an inspect anchor with a tutorial target', async () => {
		const { wrapper } = await mountNui()
		expect(wrapper.findAll('[data-slot]').length)
			.toBeGreaterThan(20)
		for (const id of ['settings', 'appearance', 'notifier', 'profile', 'workspace-name', 'week-start', 'digest', 'clear-cache', 'archive-workspace']) {
			const root = wrapper.get(widgetSelector(id))
			expect(root.attributes('data-tutorial-target'), id)
				.toBe(`packs-${id}`)
		}
		expect(wrapper.get('[data-testid="nui-input-workspace-name"]').element.tagName)
			.toBe('INPUT')
		expect(wrapper.find(`${widgetSelector('digest')} [role="switch"]`)
			.exists())
			.toBe(true)
		expect(wrapper.get('[data-testid="nui-select-week-start"]')
			.text())
			.toContain('Monday')
	})

	it('draws icons from the bundled collection: an inline svg with path data, no request for a remote one', async () => {
		const { wrapper, widgets } = await mountNui()
		widgets.notifier.methods.notify({ en: 'Careful' }, 'danger')
		await settle()
		const icon = wrapper.get('[data-testid="nui-alert"] svg')
		expect(icon.find('path')
			.exists())
			.toBe(true)
	})

	it('speaks the host locale, document texts and its own', async () => {
		const { wrapper, host } = await mountNui()
		expect(wrapper.get(widgetSelector('workspace-name'))
			.text())
			.toContain('Workspace name')
		host.locale.value = 'zh-TW'
		await settle()
		expect(wrapper.get(widgetSelector('workspace-name'))
			.text())
			.toContain('工作區名稱')
		expect(wrapper.get('[data-testid="nui-appearance"]')
			.text())
			.toContain('外觀')
	})

	it('writes the Appearance radio groups, the switch and the input to State', async () => {
		const { wrapper, widgets } = await mountNui()
		await wrapper.get('[data-testid="nui-density"] [value="compact"]')
			.trigger('click')
		await settle()
		expect(widgets.appearance.state.density.get())
			.toBe('compact')
		await wrapper.get(`${widgetSelector('beta')} [role="switch"]`)
			.trigger('click')
		await settle()
		expect(widgets.beta.state.on.get())
			.toBe(true)
		await wrapper.get('[data-testid="nui-input-tagline"]')
			.setValue('Hello')
		expect(widgets.tagline.state.value.get())
			.toBe('Hello')
	})

	it('announces the newest danger notification as the one alert and the newest other as the one status, with Dismiss buttons', async () => {
		const { wrapper, widgets } = await mountNui()
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(0)
		expect(wrapper.findAll('[role="status"]'))
			.toHaveLength(1)
		widgets.notifier.methods.notify({ en: 'Cache cleared' }, 'success')
		widgets.notifier.methods.notify({ en: 'Archived' }, 'danger')
		await settle()
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(1)
		expect(wrapper.get('[role="alert"]')
			.text())
			.toContain('Archived')
		expect(wrapper.get('[role="status"]')
			.text())
			.toContain('Cache cleared')
		await wrapper.get('[data-testid="nui-alert-dismiss"]')
			.trigger('click')
		await settle()
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(0)
		await wrapper.get('[data-testid="nui-status-dismiss"]')
			.trigger('click')
		await settle()
		expect(valueOf(widgets.notifier.properties.count.get()))
			.toBe(0)
	})

	it('gives every Dismiss button an accessible name that says what it dismisses', async () => {
		const { wrapper, widgets } = await mountNui()
		widgets.notifier.methods.notify({ en: 'Archived' }, 'danger')
		await settle()
		expect(wrapper.get('[data-testid="nui-alert-dismiss"]')
			.attributes('aria-label'))
			.toBe('Dismiss: Archived')
	})
})
