// @vitest-environment happy-dom
/**
 * The Nuxt UI pack is a lazy chunk behind the page. When it fails to load, its pane says so (and is no alert), the hand-written pack
 * keeps working over the same Runtime, and nothing of a nested app is left behind.
 */

import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPacksRuntime, widgetsOf } from '../test-support'
import { liveNuxtUiApps } from './nuxt-ui/nested-app'
import { mountPacks, settle } from './test-harness'

vi.mock('./nuxt-ui/NuxtUiPack', () => {
	throw new Error('Failed to fetch dynamically imported module')
})

let wrapper: VueWrapper | null = null

afterEach(() => {
	wrapper?.unmount()
	wrapper = null
	document.body.innerHTML = ''
})

describe('a Nuxt UI chunk that fails to load', () => {
	it('shows a message in the Nuxt UI pane without an alert, creates no nested app, and leaves the hand-written pack and the Runtime working', async () => {
		const { runtime } = createPacksRuntime()
		wrapper = await mountPacks(runtime, { attachTo: document.body })
		await wrapper.get('[data-testid="packs-choice-both"]')
			.setValue(true)
		await vi.waitFor(() => expect(wrapper!.find('[data-testid="packs-nui-failed"]')
			.exists())
			.toBe(true), { timeout: 5000 })
		expect(wrapper.get('[data-testid="packs-nui-failed"]')
			.text())
			.toContain('could not be loaded')
		expect(wrapper.findAll('[role="alert"]'))
			.toHaveLength(0)
		expect(liveNuxtUiApps())
			.toBe(0)

		// The page still works: the hand-written pane writes State, and the other pane is only a message.
		await wrapper.get('[data-testid="hand-input-tagline"]')
			.setValue('Still here')
		await settle()
		expect(widgetsOf(runtime).tagline.state.value.get())
			.toBe('Still here')
		expect(runtime.isDisposed)
			.toBe(false)
		await wrapper.get('[data-testid="packs-choice-hand"]')
			.setValue(true)
		await settle()
		expect(wrapper.find('[data-testid="packs-nui-failed"]')
			.exists())
			.toBe(false)
	})
})
