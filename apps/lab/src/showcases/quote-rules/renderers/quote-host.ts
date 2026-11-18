/**
 * The host of one quote Runtime: everything that belongs to whoever owns the Runtime and that `useWidget()`
 * deliberately does not hand a renderer (it exposes no Runtime). `QuoteRenderer` (`./index.ts`) creates one host per
 * Runtime and provides it to the renderers below it.
 *
 * What the host does:
 * - **Runs the same rules somewhere else.** It watches the root's Property `answers`; whenever an answer changes it
 *   reads the live Runtime's quote (`readQuoteOutcome`) and sends the document (`runtime.blueprint.source`) and the
 *   answers, as JSON text, to the backend (a Web Worker with no DOM). It never computes a price itself: both sides
 *   run the plugins, and the host only compares the two outcomes as JSON text.
 * - **Receives isolated exceptions.** It installs Core's isolated-error handler (`setIsolatedErrorHandler`) while it
 *   lives and puts back the one it replaced. The handler is given only the exception, so the host finds the widget
 *   by reading each rule again (`findThrowingMember`), and records it. Without a handler Core would rethrow the
 *   exception in a microtask: an uncaught error on the page that nobody can tie to anything.
 * - **`resetAll()`**: `runtime.resetState()`, put back every answer. It resets State only.
 *
 * A host is created and disposed with the component that provides it; it keeps no module state.
 */

import type { InjectionKey, Ref } from 'vue'
import type { QuoteEvaluation, QuoteOutcome } from '../evaluate'
import type { QuoteRuntime } from '../system'
import type { QuoteBackend } from '../worker-client'
import { setIsolatedErrorHandler } from '@deviltea/widget-core'
import { computed, shallowRef } from 'vue'
import { findThrowingMember, readQuoteOutcome } from '../evaluate'

export type WorkerView
	= | { readonly status: 'pending', readonly previous: QuoteEvaluation | null }
		| { readonly status: 'ready', readonly evaluation: QuoteEvaluation }
		| { readonly status: 'unavailable', readonly message: string }

export type Comparison = 'pending' | 'match' | 'mismatch' | 'unavailable'

/** One exception Core isolated and handed to this host. */
export interface IsolatedReport {
	/** 1, 2, 3...: the order they arrived in. */
	readonly sequence: number
	readonly name: string
	readonly message: string
	readonly widgetId: string | null
	readonly member: string | null
	/**
	 * How many times Core handed this very exception over. A Property that threw keeps the exception as its cached
	 * outcome, and Core reports it once per hand-over pass, so each subscription that first reads it (a renderer's ref, a
	 * dependent's) is a separate pass: one cached exception can arrive several times, and is listed once.
	 */
	readonly count: number
}

export interface QuoteHost {
	/** The live Runtime's quote, read directly (`readQuoteOutcome`). */
	readonly browser: Readonly<Ref<QuoteOutcome>>
	/** What the backend answered for the same document and answers. */
	readonly worker: Readonly<Ref<WorkerView>>
	readonly comparison: Readonly<Ref<Comparison>>
	/** The most recent isolated exceptions, oldest first (at most `MAX_REPORTS`). */
	readonly exceptions: Readonly<Ref<readonly IsolatedReport[]>>
	clearExceptions: () => void
	resetAll: () => void
}

export interface QuoteHostHandle {
	readonly host: QuoteHost
	/** Stops watching, puts back the previous isolated-error handler and disposes the backend. */
	dispose: () => void
}

export const QuoteHostKey: InjectionKey<QuoteHost> = Symbol('widget-lab:quote-host')

/** How to get the backend: a test provides a fake. The Preview uses a Web Worker. */
export const QuoteBackendFactoryKey: InjectionKey<() => QuoteBackend> = Symbol('widget-lab:quote-backend')

export const MAX_REPORTS = 20

/** Whether two outcomes are the same JSON. */
export function sameOutcome(left: QuoteOutcome, right: QuoteOutcome): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

export function createQuoteHost(runtime: QuoteRuntime, backend: QuoteBackend): QuoteHostHandle {
	const browser = shallowRef<QuoteOutcome>(readQuoteOutcome(runtime))
	const worker = shallowRef<WorkerView>({ status: 'pending', previous: null })
	const exceptions = shallowRef<readonly IsolatedReport[]>([])
	// The exception objects behind `exceptions`, in the same order: one entry per distinct exception (see `IsolatedReport.count`).
	let seen: unknown[] = []
	let sequence = 0
	let requests = 0
	let disposed = false

	const comparison = computed<Comparison>(() => {
		const view = worker.value
		if (view.status === 'pending')
			return 'pending'
		if (view.status === 'unavailable')
			return 'unavailable'
		return sameOutcome(browser.value, view.evaluation.outcome) ? 'match' : 'mismatch'
	})

	const root = runtime.getWidget(runtime.blueprint.root.id)
	const quoteRoot = root?.type === 'Quote' ? root : null

	function refresh(): void {
		if (disposed)
			return
		browser.value = readQuoteOutcome(runtime)
		const answers = quoteRoot?.properties.answers.get()
		const request = { quote: runtime.blueprint.source, answers: answers?.ok ? answers.value : {} }
		const mine = ++requests
		const current = worker.value
		worker.value = { status: 'pending', previous: current.status === 'ready' ? current.evaluation : current.status === 'pending' ? current.previous : null }
		backend.evaluate(request)
			.then((evaluation) => {
				if (!disposed && mine === requests)
					worker.value = { status: 'ready', evaluation }
			}, (error: unknown) => {
				if (!disposed && mine === requests)
					worker.value = { status: 'unavailable', message: error instanceof Error ? error.message : String(error) }
			})
	}

	// The handler is given the exception and nothing else. It runs after Core finished the write that caused it, so it
	// may read the Runtime: that is how the widget is found.
	const previousHandler = setIsolatedErrorHandler((error) => {
		const known = seen.indexOf(error)
		if (known >= 0) {
			exceptions.value = exceptions.value.map((entry, index) => index === known ? { ...entry, count: entry.count + 1 } : entry)
		}
		else {
			const where = findThrowingMember(runtime, error)
			const report: IsolatedReport = {
				sequence: ++sequence,
				name: error instanceof Error ? error.name : 'Error',
				message: error instanceof Error ? error.message : String(error),
				widgetId: where?.widgetId ?? null,
				member: where?.member ?? null,
				count: 1,
			}
			seen = [...seen, error].slice(-MAX_REPORTS)
			exceptions.value = [...exceptions.value, report].slice(-MAX_REPORTS)
		}
		// What the page now shows is the last quote that worked; the outcome of the live Runtime is the failure.
		browser.value = readQuoteOutcome(runtime)
	})

	const unsubscribe = quoteRoot === null ? () => {} : quoteRoot.properties.answers.subscribe(refresh)
	refresh()

	return {
		host: {
			browser,
			worker,
			comparison,
			exceptions,
			clearExceptions: () => {
				seen = []
				exceptions.value = []
			},
			resetAll: () => {
				runtime.resetState()
			},
		},
		dispose: () => {
			if (disposed)
				return
			disposed = true
			unsubscribe()
			setIsolatedErrorHandler(previousHandler)
			backend.dispose()
		},
	}
}
