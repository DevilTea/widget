/**
 * Shared test-only mount helper for the onboarding renderer tests. Not itself a test file and never imported by
 * application code. It mounts the real `OnboardingRenderer` (the registry wrapped in its host) over a real Runtime,
 * inside a `ShowcaseHost` of plain refs (what the Preview frame provides in the app), with a scheduler the test fires
 * by hand so the booking office never uses a timer.
 */

import type { VueWrapper } from '@vue/test-utils'
import type { Ref } from 'vue'
import type { ShowcaseHost, ShowcaseLocale, ShowcaseTheme } from '../../../showcase-host'
import type { CancelScheduled, Scheduler } from '../booking-office'
import type { OnboardingRuntime } from '../test-support'
import { flushPromises, mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { ShowcaseHostKey } from '../../../showcase-host'
import { OnboardingRenderer, OnboardingSchedulerKey } from './index'

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

/** A scheduler whose callbacks run only when the test says so. */
export function createManualScheduler() {
	const scheduled: { readonly callback: () => void, cancelled: boolean, fired: boolean }[] = []
	const scheduler: Scheduler = {
		after: (callback) => {
			const entry = { callback, cancelled: false, fired: false }
			scheduled.push(entry)
			const cancel: CancelScheduled = () => {
				entry.cancelled = true
			}
			return cancel
		},
	}
	return {
		scheduler,
		scheduled,
		fireAll: () => {
			for (const entry of scheduled) {
				if (!entry.cancelled && !entry.fired) {
					entry.fired = true
					entry.callback()
				}
			}
		},
		live: () => scheduled.filter(entry => !entry.cancelled && !entry.fired).length,
	}
}

/** `attachTo` is for tests that need real focus; such a test must unmount the wrapper. */
export async function mountOnboarding(runtime: OnboardingRuntime, options: { readonly attachTo?: HTMLElement, readonly host?: ShowcaseHost, readonly scheduler?: Scheduler } = {}): Promise<VueWrapper> {
	const manual = options.scheduler === undefined ? createManualScheduler().scheduler : options.scheduler
	const wrapper = mount(OnboardingRenderer, {
		props: { runtime },
		attachTo: options.attachTo,
		global: { provide: { [ShowcaseHostKey as symbol]: options.host ?? createTestHost(), [OnboardingSchedulerKey as symbol]: manual } },
	})
	await flushPromises()
	return wrapper
}

/** The selector of a widget renderer's root element: its inspect anchor. */
export function widgetSelector(widgetId: string): string {
	return `[data-widget-id="${widgetId}"]`
}
