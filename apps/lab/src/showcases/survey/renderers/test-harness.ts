/**
 * Shared test-only mount helper for the survey-form renderer tests. Not itself a test file and never
 * imported by application code. It mounts the real `SurveyRenderer` registry over a real Runtime of the
 * default preset, inside a `ShowcaseHost` of plain refs (what the Preview frame provides in the app), so a
 * test can switch the locale and the theme the way the host does.
 */

import type { VueWrapper } from '@vue/test-utils'
import type { Ref } from 'vue'
import type { ShowcaseHost, ShowcaseLocale, ShowcaseTheme } from '../../../showcase-host'
import type { createSurveyRuntime } from '../test-support'
import { flushPromises, mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { ShowcaseHostKey } from '../../../showcase-host'
import { SurveyRenderer } from './index'

export type SurveyTestRuntime = ReturnType<typeof createSurveyRuntime>['runtime']

export interface TestShowcaseHost extends ShowcaseHost {
	readonly locale: Ref<ShowcaseLocale>
	readonly theme: Ref<ShowcaseTheme>
}

export function createTestHost(initial: { readonly locale?: ShowcaseLocale, readonly theme?: ShowcaseTheme } = {}): TestShowcaseHost {
	return {
		locale: shallowRef(initial.locale ?? 'en'),
		theme: shallowRef(initial.theme ?? 'dark'),
	}
}

/** `attachTo` is for tests that need real focus; such a test must unmount the wrapper. */
export async function mountSurvey(
	runtime: SurveyTestRuntime,
	options: { readonly attachTo?: HTMLElement, readonly host?: ShowcaseHost } = {},
): Promise<VueWrapper> {
	const wrapper = mount(SurveyRenderer, {
		props: { runtime },
		attachTo: options.attachTo,
		global: {
			provide: { [ShowcaseHostKey as symbol]: options.host ?? createTestHost() },
		},
	})
	await flushPromises()
	return wrapper
}

/** The selector of a question renderer's root element: its inspect anchor. */
export function widgetSelector(widgetId: string): string {
	return `[data-widget-id="${widgetId}"]`
}
