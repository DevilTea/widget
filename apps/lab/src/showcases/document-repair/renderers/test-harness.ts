/**
 * Shared test-only mount helper for the repair desk renderer tests. Not itself a test file and never imported by
 * application code. It mounts the real `DocumentRepairRenderer` (the registry wrapped in its host) over a real Runtime,
 * inside a `ShowcaseHost` of plain refs (what the Preview frame provides in the app).
 */

import type { VueWrapper } from '@vue/test-utils'
import type { Ref } from 'vue'
import type { ShowcaseHost, ShowcaseLocale, ShowcaseTheme } from '../../../showcase-host'
import type { RepairRuntime } from '../test-support'
import { flushPromises, mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { ShowcaseHostKey } from '../../../showcase-host'
import { DocumentRepairRenderer } from './index'

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

/** `attachTo` is for tests that need real focus; such a test must unmount the wrapper. */
export async function mountRepairDesk(runtime: RepairRuntime, options: { readonly attachTo?: HTMLElement, readonly host?: ShowcaseHost } = {}): Promise<VueWrapper> {
	const wrapper = mount(DocumentRepairRenderer, {
		props: { runtime },
		attachTo: options.attachTo,
		global: { provide: { [ShowcaseHostKey as symbol]: options.host ?? createTestHost() } },
	})
	await flushPromises()
	return wrapper
}

/** The selector of a widget renderer's root element: its inspect anchor. */
export function widgetSelector(widgetId: string): string {
	return `[data-widget-id="${widgetId}"]`
}
