/**
 * Shared test-only mount helper for the quote renderer tests. Not itself a test file and never imported by
 * application code. It mounts the real `QuoteRenderer` (the registry wrapped in its host) over a real Runtime, inside
 * a `ShowcaseHost` of plain refs (what the Preview frame provides in the app), so a test can switch the theme and the
 * locale the way the host does. The Web Worker is replaced by an in-process stand-in that runs the REAL worker
 * handler (`handleWorkerMessage`) on the JSON text it is sent, so the page-and-worker comparison is real; a test can
 * also provide a backend of its own.
 */

import type { VueWrapper } from '@vue/test-utils'
import type { Ref } from 'vue'
import type { ShowcaseHost, ShowcaseLocale, ShowcaseTheme } from '../../../showcase-host'
import type { QuoteEvaluation } from '../evaluate'
import type { QuoteRuntime } from '../test-support'
import type { QuoteBackend, QuoteWorkerLike } from '../worker-client'
import { flushPromises, mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { ShowcaseHostKey } from '../../../showcase-host'
import { createWorkerBackend } from '../worker-client'
import { handleWorkerMessage } from '../worker-protocol'
import { QuoteRenderer } from './index'
import { QuoteBackendFactoryKey } from './quote-host'

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

/** A `Worker` that answers on a microtask with the real handler's reply. */
export function createInProcessWorker(): QuoteWorkerLike {
	const worker: QuoteWorkerLike = {
		onmessage: null,
		onerror: null,
		postMessage: (message) => {
			queueMicrotask(() => {
				const reply = handleWorkerMessage(message)
				worker.onmessage?.({ data: JSON.parse(JSON.stringify(reply)) })
			})
		},
		terminate: () => {},
	}
	return worker
}

/** A backend whose evaluations a test rewrites on the way back (a defective backend, for the mismatch case). */
export function createTamperedBackend(tamper: (evaluation: QuoteEvaluation) => QuoteEvaluation): QuoteBackend {
	const real = createWorkerBackend(createInProcessWorker)
	return { evaluate: async request => tamper(await real.evaluate(request)), dispose: real.dispose }
}

/** `attachTo` is for tests that need real focus; such a test must unmount the wrapper. */
export async function mountQuote(runtime: QuoteRuntime, options: { readonly attachTo?: HTMLElement, readonly host?: ShowcaseHost, readonly backend?: () => QuoteBackend } = {}): Promise<VueWrapper> {
	const wrapper = mount(QuoteRenderer, {
		props: { runtime },
		attachTo: options.attachTo,
		global: {
			provide: {
				[ShowcaseHostKey as symbol]: options.host ?? createTestHost(),
				[QuoteBackendFactoryKey as symbol]: options.backend ?? (() => createWorkerBackend(createInProcessWorker)),
			},
		},
	})
	await flushPromises()
	return wrapper
}

/** The selector of a widget renderer's root element: its inspect anchor. */
export function widgetSelector(widgetId: string): string {
	return `[data-widget-id="${widgetId}"]`
}
