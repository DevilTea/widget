/**
 * Shared test-only mount helpers for the renderer-packs renderer tests. Not itself a test file and never imported by application
 * code. They mount the real `RendererPacksRenderer` (the page frame around both packs) over a real Runtime, inside a
 * `ShowcaseHost` of plain refs (what the Preview frame provides in the app).
 *
 * The Nuxt UI pack needs no plugin from the harness: it installs `@nuxt/ui/vue-plugin` in its own nested app, exactly as in the
 * frame, and a test that wants to see it must attach the wrapper to the document (the pack's overlay container is found with a
 * selector). For a Nuxt UI renderer on its own, `mountNuxtUiRenderer` has the harness's own `UApp` and plugin: the Lab chrome's
 * test support (`src/test-support-ui.ts`) is the chrome's, and a showcase may not import it.
 */

import type { VueWrapper } from '@vue/test-utils'
import type { Ref } from 'vue'
import type { ShowcaseHost, ShowcaseLocale, ShowcaseTheme } from '../../../showcase-host'
import type { PacksRuntime } from '../test-support'
import type { PackChoice } from './packs-host'
import UApp from '@nuxt/ui/components/App.vue'
import ui from '@nuxt/ui/vue-plugin'
import { flushPromises, mount } from '@vue/test-utils'
import { vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import { ShowcaseHostKey } from '../../../showcase-host'
import { NuxtUiWidgetRenderer } from './nuxt-ui'
import { PORTAL_SELECTOR } from './nuxt-ui/portal'
import { RendererPacksRenderer } from './page'

export interface TestShowcaseHost extends ShowcaseHost {
	readonly locale: Ref<ShowcaseLocale>
	readonly theme: Ref<ShowcaseTheme>
}

export function createTestHost(initial: { readonly locale?: ShowcaseLocale, readonly theme?: ShowcaseTheme } = {}): TestShowcaseHost {
	return {
		locale: shallowRef(initial.locale ?? 'en'),
		theme: shallowRef(initial.theme ?? 'light'),
	}
}

/** Lets the lazy Nuxt UI chunk load and the nested app render. */
export async function settle(): Promise<void> {
	for (let pass = 0; pass < 6; pass++)
		await flushPromises()
}

/** Waits for the lazy Nuxt UI chunk (the first load of Nuxt UI, Tailwind and their modules is slow in a cold test run). */
export async function waitForNuxtUi(wrapper: VueWrapper): Promise<void> {
	await vi.waitFor(() => {
		if (wrapper.find('[data-testid="packs-nui-loading"]')
			.exists()) {
			throw new Error('The Nuxt UI pack is still loading.')
		}
	}, { timeout: 20_000, interval: 20 })
	await settle()
}

/**
 * Mounts the page. `attachTo` is for tests that need real focus, the real top layer or the Nuxt UI pack's overlay container; such a
 * test must unmount the wrapper. `pack` picks the pack by driving the chooser, like a visitor.
 */
export async function mountPacks(runtime: PacksRuntime, options: { readonly attachTo?: HTMLElement, readonly host?: ShowcaseHost, readonly pack?: PackChoice } = {}): Promise<VueWrapper> {
	const wrapper = mount(RendererPacksRenderer, {
		props: { runtime },
		attachTo: options.attachTo,
		global: { provide: { [ShowcaseHostKey as symbol]: options.host ?? createTestHost() } },
	})
	await settle()
	if (options.pack !== undefined && options.pack !== 'hand') {
		await wrapper.get(`[data-testid="packs-choice-${options.pack}"]`)
			.setValue(true)
		await waitForNuxtUi(wrapper)
	}
	return wrapper
}

/** One Nuxt UI renderer tree on its own (no nested app, no page frame), with the harness's plugin and `UApp`. Attach it. */
export async function mountNuxtUiRenderer(runtime: PacksRuntime, options: { readonly attachTo: HTMLElement, readonly host?: ShowcaseHost }): Promise<VueWrapper> {
	const Root = defineComponent({
		setup: () => () => h(UApp, { portal: PORTAL_SELECTOR, toaster: null }, { default: () => h(NuxtUiWidgetRenderer, { runtime }) }),
	})
	const wrapper = mount(Root, {
		attachTo: options.attachTo,
		global: { plugins: [ui], provide: { [ShowcaseHostKey as symbol]: options.host ?? createTestHost() } },
	})
	await settle()
	return wrapper
}

/** The selector of a widget renderer's root element: its inspect anchor. */
export function widgetSelector(widgetId: string): string {
	return `[data-widget-id="${widgetId}"]`
}
