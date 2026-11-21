// @vitest-environment happy-dom
/**
 * Host-level pack switching and the Nuxt UI pack's own nested Vue app: switching the pack mounts the other pack's renderers over
 * the SAME Runtime (never disposed, State kept), the nested Nuxt UI app is created once per mount of the pack and unmounted when
 * the pack is switched away or the page unmounts (no app is left behind), the Nuxt UI overlays stay inside the pack's root, and
 * `dark` is a class of the pack's root only. Side by side, the page still has one alert, one status and one open confirmation.
 */

import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPacksRuntime, widgetsOf } from '../test-support'
import { createdNuxtUiApps, liveNuxtUiApps } from './nuxt-ui/nested-app'
import { forgetPackStyles } from './nuxt-ui/pack-styles'
import { createTestHost, mountPacks, settle, waitForNuxtUi, widgetSelector } from './test-harness'

vi.setConfig({ testTimeout: 30_000 })

let wrapper: VueWrapper | null = null

afterEach(() => {
	wrapper?.unmount()
	wrapper = null
	document.body.innerHTML = ''
})

async function mountPage(pack: 'hand' | 'nui' | 'both' = 'hand', options: { theme?: 'light' | 'dark' } = {}) {
	const { runtime } = createPacksRuntime()
	const host = createTestHost(options)
	wrapper = await mountPacks(runtime, { attachTo: document.body, host, pack })
	return { runtime, host, widgets: widgetsOf(runtime), wrapper }
}

async function choose(pack: 'hand' | 'nui' | 'both'): Promise<void> {
	await wrapper!.get(`[data-testid="packs-choice-${pack}"]`)
		.setValue(true)
	await waitForNuxtUi(wrapper!)
}

describe('switching the pack keeps one Runtime', () => {
	it('mounts the hand-written pack first, with no Nuxt UI app and no Nuxt UI pane', async () => {
		const live = liveNuxtUiApps()
		const { wrapper } = await mountPage()
		expect(wrapper.find('[data-testid="packs-pane-hand"]')
			.exists())
			.toBe(true)
		expect(wrapper.find('[data-testid="packs-pane-nui"]')
			.exists())
			.toBe(false)
		expect(liveNuxtUiApps())
			.toBe(live)
	})

	it('shows what was typed in the other pack, both ways, and never disposes or replaces the Runtime', async () => {
		const { runtime, widgets, wrapper } = await mountPage()
		const disposed: string[] = []
		runtime.subscribeDisposal(() => disposed.push('disposed'))
		await wrapper.get('[data-testid="hand-input-workspace-name"]')
			.setValue('Typed by hand')
		await choose('nui')
		expect((wrapper.get('[data-testid="nui-input-workspace-name"]').element as HTMLInputElement).value)
			.toBe('Typed by hand')
		expect(wrapper.find('[data-testid="hand-page"]')
			.exists())
			.toBe(false)

		await wrapper.get('[data-testid="nui-input-workspace-name"]')
			.setValue('Typed in Nuxt UI')
		expect(widgets.workspaceName.state.value.get())
			.toBe('Typed in Nuxt UI')
		await choose('hand')
		expect((wrapper.get('[data-testid="hand-input-workspace-name"]').element as HTMLInputElement).value)
			.toBe('Typed in Nuxt UI')
		expect(runtime.isDisposed)
			.toBe(false)
		expect(disposed)
			.toEqual([])
	})

	it('creates the nested Nuxt UI app once per mount of the pack and unmounts it when the pack is switched away or the page unmounts', async () => {
		const createdBefore = createdNuxtUiApps()
		const liveBefore = liveNuxtUiApps()
		const { wrapper } = await mountPage('nui')
		expect(createdNuxtUiApps())
			.toBe(createdBefore + 1)
		expect(liveNuxtUiApps())
			.toBe(liveBefore + 1)
		// Re-rendering the page does not create another app.
		await wrapper.get(`${widgetSelector('digest')} [role="switch"]`)
			.trigger('click')
		await settle()
		expect(createdNuxtUiApps())
			.toBe(createdBefore + 1)

		await choose('hand')
		expect(liveNuxtUiApps())
			.toBe(liveBefore)
		await choose('both')
		expect(createdNuxtUiApps())
			.toBe(createdBefore + 2)
		expect(liveNuxtUiApps())
			.toBe(liveBefore + 1)
		await choose('nui')
		expect(createdNuxtUiApps())
			.toBe(createdBefore + 2)
		expect(liveNuxtUiApps())
			.toBe(liveBefore + 1)

		wrapper.unmount()
		expect(liveNuxtUiApps())
			.toBe(liveBefore)
		expect(document.querySelectorAll('[data-widget-id]'))
			.toHaveLength(0)
	})

	it('takes the pack\'s stylesheet out of the document when the pack goes away and puts the same element back before it mounts again', async () => {
		// Stands for the `<link>` (build) or `<style>` (dev server) of `packs-ui.css`: found by its marker rule.
		const style = document.createElement('style')
		style.textContent = '.packs-ui { color: red }\n.packs-ui-pack-marker { --packs-ui-pack: 1 }'
		document.head.append(style)
		try {
			const { wrapper } = await mountPage('nui')
			expect(style.isConnected)
				.toBe(true)

			await choose('hand')
			expect(style.isConnected)
				.toBe(false)

			await choose('nui')
			expect(style.isConnected)
				.toBe(true)
			expect(wrapper.find('[data-testid="nui-page"]')
				.exists())
				.toBe(true)

			wrapper.unmount()
			expect(style.isConnected)
				.toBe(false)
		}
		finally {
			forgetPackStyles()
			style.remove()
		}
	})

	it('leaves nothing of the nested app behind in the document head after the pack is gone', async () => {
		await mountPage('nui')
		// While the pack is mounted its nested app has its own generated colour block in the head.
		expect(document.head.querySelectorAll('style#nuxt-ui-colors'))
			.toHaveLength(1)
		wrapper!.unmount()
		wrapper = null
		// `unhead` renders its removal asynchronously.
		await vi.waitFor(() => expect(document.head.querySelectorAll('style#nuxt-ui-colors'))
			.toHaveLength(0), { timeout: 2000 })
	})
})

describe('the Nuxt UI pack: its own root, its own overlays', () => {
	it('draws every widget with an inspect anchor on its root, inside the pack\'s own root', async () => {
		const { wrapper } = await mountPage('nui')
		const root = wrapper.get('[data-testid="packs-nui-mount"] .packs-ui')
		for (const id of ['settings', 'appearance', 'notifier', 'profile', 'workspace-name', 'tagline', 'week-start', 'preferences', 'digest', 'beta', 'danger', 'clear-cache', 'archive-workspace']) {
			const element = root.find(`${widgetSelector(id)}`)
			expect(element.exists() || root.element === wrapper.get(widgetSelector(id)).element, id)
				.toBe(true)
			expect(wrapper.get(widgetSelector(id))
				.attributes('data-tutorial-target'), id)
				.toBe(`packs-${id}`)
		}
	})

	it('puts `dark` on the pack\'s root only, from the Appearance mode and the host theme, never on the document', async () => {
		const { wrapper, host, widgets } = await mountPage('nui', { theme: 'dark' })
		const root = wrapper.get('[data-testid="nui-page"]')
		expect(root.classes())
			.toContain('dark')
		host.theme.value = 'light'
		await settle()
		expect(root.classes())
			.not
			.toContain('dark')
		widgets.appearance.state.mode.set('dark')
		await settle()
		expect(root.classes())
			.toContain('dark')
		expect(document.documentElement.classList.contains('dark'))
			.toBe(false)
		expect(document.body.classList.contains('dark'))
			.toBe(false)
		expect(document.querySelectorAll('.dark'))
			.toHaveLength(1)
	})

	it('teleports the confirmation modal and the select menu into the pack\'s overlay container, not the frame body', async () => {
		const { wrapper, widgets } = await mountPage('nui')
		await wrapper.get('[data-testid="nui-ask-archive-workspace"]')
			.trigger('click')
		await settle()
		expect(widgets.archive.state.confirming.get())
			.toBe(true)
		const dialog = document.querySelector('[role="dialog"]')
		expect(dialog, 'the modal').not.toBeNull()
		expect(dialog!.closest('[data-packs-portal]'), 'inside the pack\'s overlay container')
			.not
			.toBeNull()
		expect([...document.body.children].filter(child => child.matches('[role="dialog"], [data-reka-popper-content-wrapper]')))
			.toEqual([])
		expect(dialog!.textContent)
			.toContain('Archive this workspace?')
	})

	it('confirms through the modal: the Notifier is told, the modal closes and State says so; cancelling and Esc leave nothing behind', async () => {
		const { wrapper, widgets } = await mountPage('nui')
		await wrapper.get('[data-testid="nui-ask-archive-workspace"]')
			.trigger('click')
		await settle()
		document.querySelector<HTMLElement>('[data-testid="nui-cancel-archive-workspace"]')!.click()
		await settle()
		expect(widgets.archive.state.confirming.get())
			.toBe(false)
		expect(widgets.notifier.state.items.get())
			.toEqual([])
		expect(document.querySelector('[role="dialog"]'))
			.toBeNull()

		await wrapper.get('[data-testid="nui-ask-archive-workspace"]')
			.trigger('click')
		await settle()
		document.querySelector<HTMLElement>('[data-testid="nui-confirm-archive-workspace"]')!.click()
		await settle()
		expect(widgets.archive.state.confirming.get())
			.toBe(false)
		expect(widgets.notifier.state.items.get()!.map(item => item.message.en))
			.toEqual(['Workspace archived.'])
		expect(wrapper.get('[data-testid="nui-alert"]')
			.text())
			.toContain('Workspace archived.')
	})

	it('shows the plugin\'s validation message as the field error and writes State from the input', async () => {
		const { wrapper, widgets } = await mountPage('nui')
		await wrapper.get('[data-testid="nui-input-workspace-name"]')
			.setValue('A workspace name that is far too long')
		await settle()
		expect(widgets.workspaceName.state.value.get())
			.toBe('A workspace name that is far too long')
		expect(wrapper.get(widgetSelector('workspace-name'))
			.text())
			.toContain('Too long: 37 of 24 characters allowed.')
	})
})

describe('two Vue apps in one document', () => {
	it('never repeat an id: the nested app generates its own prefix, so every label points at its own control', async () => {
		const { wrapper } = await mountPage('both')
		const ids = [...document.querySelectorAll('[id]')].map(element => element.id)
		const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index)
		expect(duplicated)
			.toEqual([])
		expect(wrapper.get('[data-testid="nui-input-workspace-name"]')
			.attributes('id'))
			.toMatch(/^packs-nui/)
		expect((wrapper.get('[data-testid="nui-input-workspace-name"]').element as HTMLInputElement).labels)
			.toHaveLength(1)
		expect((wrapper.get('[data-testid="hand-input-workspace-name"]').element as HTMLInputElement).labels)
			.toHaveLength(1)
	})
})

describe('side by side', () => {
	it('keeps both panes in sync from the one State, with one alert, one status and one open confirmation', async () => {
		const { wrapper, widgets } = await mountPage('both')
		expect(wrapper.findAll('[data-testid="packs-pane-hand"], [data-testid="packs-pane-nui"]'))
			.toHaveLength(2)
		await wrapper.get('[data-testid="hand-input-tagline"]')
			.setValue('Sync me')
		await settle()
		expect((wrapper.get('[data-testid="nui-input-tagline"]').element as HTMLInputElement).value)
			.toBe('Sync me')
		widgets.notifier.methods.notify({ en: 'Cleared' }, 'success')
		widgets.notifier.methods.notify({ en: 'Warned' }, 'danger')
		await settle()
		expect(document.querySelectorAll('[role="alert"]'))
			.toHaveLength(1)
		expect(document.querySelectorAll('[role="status"]'))
			.toHaveLength(1)
		expect(wrapper.get('[data-testid="hand-alert"]')
			.text())
			.toContain('Warned')
		expect(wrapper.get('[data-testid="nui-alert"]')
			.text())
			.toContain('Warned')

		// The Nuxt UI pane asked: its modal opens, the hand-written pane's dialog does not.
		await wrapper.get('[data-testid="nui-ask-archive-workspace"]')
			.trigger('click')
		await settle()
		expect(document.querySelector('[role="dialog"]'))
			.not
			.toBeNull()
		expect((wrapper.get('[data-testid="hand-dialog-archive-workspace"]').element as HTMLDialogElement).open)
			.toBe(false)
		expect(wrapper.get(`[data-testid="packs-pane-hand"] ${widgetSelector('archive-workspace')}`)
			.text())
			.toContain('The confirmation is open in the other pane.')
		document.querySelector<HTMLElement>('[data-testid="nui-cancel-archive-workspace"]')!.click()
		await settle()

		// The hand-written pane asked: its dialog opens, the Nuxt UI modal does not.
		await wrapper.get('[data-testid="hand-ask-archive-workspace"]')
			.trigger('click')
		await settle()
		expect((wrapper.get('[data-testid="hand-dialog-archive-workspace"]').element as HTMLDialogElement).open)
			.toBe(true)
		expect(document.querySelector('[role="dialog"]'))
			.toBeNull()
	})

	it('changes the density and the mode of both packs from either one\'s Appearance', async () => {
		const { wrapper } = await mountPage('both')
		await wrapper.get('[data-testid="hand-density-compact"]')
			.setValue(true)
		await settle()
		expect(wrapper.get('[data-testid="hand-page"]')
			.attributes('data-packs-density'))
			.toBe('compact')
		expect(wrapper.get('[data-testid="nui-page"]')
			.attributes('data-packs-density'))
			.toBe('compact')
		await wrapper.get('[data-testid="hand-mode-dark"]')
			.setValue(true)
		await settle()
		expect(wrapper.get('[data-testid="hand-page"]')
			.attributes('data-packs-theme'))
			.toBe('dark')
		expect(wrapper.get('[data-testid="nui-page"]')
			.classes())
			.toContain('dark')
	})
})
