/**
 * Shared test-only mount helper for the trip-budget renderer tests. Not itself a test file and never imported by
 * application code. It mounts the real `TripBudgetRenderer` (the registry wrapped in its reset host) over a real
 * Runtime; nothing is stubbed, because the showcase asks its host for nothing it cannot default (`../host.ts`
 * falls back to English and light when the Lab provides no stores).
 */

import type { VueWrapper } from '@vue/test-utils'
import type { TripRuntime } from '../test-support'
import { flushPromises, mount } from '@vue/test-utils'
import { TripBudgetRenderer } from './index'

/** `attachTo` is for tests that need real focus; such a test must unmount the wrapper. */
export async function mountTrip(runtime: TripRuntime, options: { readonly attachTo?: HTMLElement, readonly provide?: Record<symbol, unknown> } = {}): Promise<VueWrapper> {
	const wrapper = mount(TripBudgetRenderer, {
		props: { runtime },
		attachTo: options.attachTo,
		global: { provide: options.provide ?? {} },
	})
	await flushPromises()
	return wrapper
}

/** The selector of a widget renderer's root element: its inspect anchor. */
export function widgetSelector(widgetId: string): string {
	return `[data-widget-id="${widgetId}"]`
}
