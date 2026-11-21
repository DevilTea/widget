// @vitest-environment happy-dom
/**
 * The hand-written pack's renderers against a real Runtime and a plain-ref `ShowcaseHost`: every widget stamps an inspect
 * anchor, State is written through the native controls, the Properties are what the page shows, the colour scheme and density
 * follow the Appearance, the confirmation is a native modal `<dialog>`, and the page announces with one alert and one status.
 */

import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createPacksRuntime, valueOf, widgetsOf } from '../test-support'
import { createTestHost, mountPacks, settle, widgetSelector } from './test-harness'

let wrapper: VueWrapper | null = null

afterEach(() => {
	wrapper?.unmount()
	wrapper = null
	document.body.innerHTML = ''
})

async function mountHand(options: { locale?: 'en' | 'zh-TW', theme?: 'light' | 'dark' } = {}) {
	const { runtime } = createPacksRuntime()
	const host = createTestHost(options)
	wrapper = await mountPacks(runtime, { attachTo: document.body, host })
	return { runtime, host, widgets: widgetsOf(runtime), wrapper }
}

describe('hand-written pack: structure', () => {
	it('draws every widget of the document with an inspect anchor on its root, and a tutorial target', async () => {
		const { wrapper } = await mountHand()
		for (const id of ['settings', 'appearance', 'notifier', 'profile', 'workspace-name', 'tagline', 'week-start', 'preferences', 'digest', 'beta', 'danger', 'clear-cache', 'archive-workspace']) {
			const root = wrapper.get(`[data-testid="packs-pane-hand"] ${widgetSelector(id)}`)
			expect(root.attributes('data-widget-id'), id)
				.toBe(id)
			expect(root.attributes('data-tutorial-target'), id)
				.toBe(`packs-${id}`)
		}
		expect(wrapper.get(widgetSelector('workspace-name'))
			.attributes('data-widget-type'))
			.toBe('TextField')
		expect(wrapper.find('[data-testid="packs-pane-nui"]')
			.exists())
			.toBe(false)
	})

	it('shows the document\'s texts in the host locale', async () => {
		const { wrapper, host } = await mountHand()
		expect(wrapper.get('[data-testid="hand-page"]')
			.text())
			.toContain('Workspace settings')
		expect(wrapper.get(`${widgetSelector('workspace-name')} label`)
			.text())
			.toBe('Workspace name')
		host.locale.value = 'zh-TW'
		await settle()
		expect(wrapper.get('[data-testid="hand-page"]')
			.text())
			.toContain('工作區設定')
		expect(wrapper.get(`${widgetSelector('workspace-name')} label`)
			.text())
			.toBe('工作區名稱')
		expect(wrapper.get('[data-testid="packs-chooser"]')
			.text())
			.toContain('手寫')
	})
})

describe('hand-written pack: State and Properties', () => {
	it('writes the typed text to State, counts characters and shows the plugin\'s message when it is too long', async () => {
		const { wrapper, widgets } = await mountHand()
		const input = wrapper.get('[data-testid="hand-input-workspace-name"]')
		expect(wrapper.get('[data-testid="hand-message-workspace-name"]')
			.text())
			.toBe('14 / 24 characters')
		await input.setValue('A workspace name that is far too long')
		expect(widgets.workspaceName.state.value.get())
			.toBe('A workspace name that is far too long')
		expect(wrapper.get('[data-testid="hand-message-workspace-name"]')
			.text())
			.toBe('Too long: 37 of 24 characters allowed.')
		expect(input.attributes('aria-invalid'))
			.toBe('true')
		await input.setValue('Short')
		expect(input.attributes('aria-invalid'))
			.toBeUndefined()
	})

	it('writes a switch and a choice to State, and shows what State holds when it is written from elsewhere', async () => {
		const { wrapper, widgets } = await mountHand()
		await wrapper.get('[data-testid="hand-switch-beta"]')
			.setValue(true)
		expect(widgets.beta.state.on.get())
			.toBe(true)
		await wrapper.get('[data-testid="hand-select-week-start"]')
			.setValue('sunday')
		expect(widgets.weekStart.state.value.get())
			.toBe('sunday')
		widgets.digest.state.on.set(false)
		await settle()
		expect((wrapper.get('[data-testid="hand-switch-digest"]').element as HTMLInputElement).checked)
			.toBe(false)
	})

	it('follows the Appearance: density reaches every field through its own read, and `auto` follows the host theme', async () => {
		const { wrapper, widgets, host } = await mountHand({ theme: 'light' })
		const page = wrapper.get('[data-testid="hand-page"]')
		expect(page.attributes('data-packs-theme'))
			.toBe('light')
		await wrapper.get('[data-testid="hand-density-compact"]')
			.setValue(true)
		expect(widgets.appearance.state.density.get())
			.toBe('compact')
		expect(wrapper.get(widgetSelector('workspace-name'))
			.attributes('data-packs-density'))
			.toBe('compact')
		expect(wrapper.get(widgetSelector('digest'))
			.attributes('data-packs-density'))
			.toBe('compact')
		expect(page.attributes('data-packs-density'))
			.toBe('compact')
		host.theme.value = 'dark'
		await settle()
		expect(page.attributes('data-packs-theme'))
			.toBe('dark')
		await wrapper.get('[data-testid="hand-mode-light"]')
			.setValue(true)
		expect(page.attributes('data-packs-theme'))
			.toBe('light')
		expect(widgets.appearance.state.mode.get())
			.toBe('light')
		expect(document.documentElement.classList.contains('dark'))
			.toBe(false)
	})
})

describe('hand-written pack: the confirmation and the announcements', () => {
	it('opens a native modal dialog on ask, closes it on cancel (the Esc key too), and confirm notifies and closes', async () => {
		const { wrapper, widgets } = await mountHand()
		const dialog = wrapper.get('[data-testid="hand-dialog-archive-workspace"]').element as HTMLDialogElement
		expect(dialog.open)
			.toBe(false)
		await wrapper.get('[data-testid="hand-ask-archive-workspace"]')
			.trigger('click')
		expect(widgets.archive.state.confirming.get())
			.toBe(true)
		expect(dialog.open)
			.toBe(true)
		expect(dialog.textContent)
			.toContain('Archive this workspace?')
		await wrapper.get('[data-testid="hand-cancel-archive-workspace"]')
			.trigger('click')
		expect(widgets.archive.state.confirming.get())
			.toBe(false)
		expect(dialog.open)
			.toBe(false)

		await wrapper.get('[data-testid="hand-ask-archive-workspace"]')
			.trigger('click')
		await wrapper.get('[data-testid="hand-dialog-archive-workspace"]')
			.trigger('cancel')
		expect(widgets.archive.state.confirming.get())
			.toBe(false)
		expect(dialog.open)
			.toBe(false)

		await wrapper.get('[data-testid="hand-ask-archive-workspace"]')
			.trigger('click')
		await wrapper.get('[data-testid="hand-confirm-archive-workspace"]')
			.trigger('click')
		expect(dialog.open)
			.toBe(false)
		expect(widgets.notifier.state.items.get()!.map(item => item.message.en))
			.toEqual(['Workspace archived.'])
	})

	it('announces the newest danger notification as the one alert and the newest other one as the one status, and Dismiss removes them', async () => {
		const { wrapper, widgets } = await mountHand()
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(0)
		expect(wrapper.findAll('[role="status"]'))
			.toHaveLength(1)
		widgets.notifier.methods.notify({ 'en': 'Cache cleared', 'zh-TW': '快取已清除' }, 'success')
		widgets.notifier.methods.notify({ en: 'First warning' }, 'danger')
		widgets.notifier.methods.notify({ en: 'Second warning' }, 'danger')
		await settle()
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(1)
		expect(wrapper.get('[role="alert"]')
			.text())
			.toContain('Second warning')
		expect(wrapper.findAll('[role="status"]'))
			.toHaveLength(1)
		expect(wrapper.get('[role="status"]')
			.text())
			.toContain('Cache cleared')
		await wrapper.get('[data-testid="hand-alert-dismiss"]')
			.trigger('click')
		expect(wrapper.get('[role="alert"]')
			.text())
			.toContain('First warning')
		await wrapper.get('[data-testid="hand-alert-dismiss"]')
			.trigger('click')
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(0)
		await wrapper.get('[data-testid="hand-status-dismiss"]')
			.trigger('click')
		expect(valueOf(widgets.notifier.properties.count.get()))
			.toBe(0)
		expect(wrapper.text())
			.toContain('Nothing has been reported yet.')
	})
})
