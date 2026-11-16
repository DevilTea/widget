/**
 * Shared test-only mount helper for the survey-form renderer tests. Not itself a test file and never
 * imported by application code. It mounts the real `SurveyRenderer` registry over a real Runtime of the
 * default preset; only the Lab i18n store is a stub (an English identity translator, the pattern of the
 * other showcases' renderer tests).
 */

import type { VueWrapper } from '@vue/test-utils'
import type { createSurveyRuntime } from '../test-support'
import { flushPromises, mount } from '@vue/test-utils'
import { LabI18nKey } from '../../../composables/use-lab-i18n'
import { testGlobalProperties } from '../../../test-support'
import { SurveyRenderer } from './index'

export type SurveyTestRuntime = ReturnType<typeof createSurveyRuntime>['runtime']

/** `attachTo` is for tests that need real focus; such a test must unmount the wrapper. */
export async function mountSurvey(runtime: SurveyTestRuntime, options: { readonly attachTo?: HTMLElement } = {}): Promise<VueWrapper> {
	const wrapper = mount(SurveyRenderer, {
		props: { runtime },
		attachTo: options.attachTo,
		global: {
			config: { globalProperties: testGlobalProperties },
			provide: {
				[LabI18nKey as symbol]: {
					locale: { value: 'en' },
					locales: ['en', 'zh-TW'],
					setLocale: () => {},
					t: (source: string) => source,
				},
			},
		},
	})
	await flushPromises()
	return wrapper
}

/** The selector of a question renderer's root element: its inspect anchor. */
export function widgetSelector(widgetId: string): string {
	return `[data-widget-id="${widgetId}"]`
}
