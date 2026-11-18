/**
 * The Preview's side of the quote Worker: `evaluate(request)` posts the request as JSON text and resolves with the
 * parsed evaluation. The Worker is started on the first call (a document nobody asks about costs nothing) and
 * restarted after it failed; `dispose()` terminates it and rejects what is still waiting.
 *
 * The Worker is a module Worker whose URL is built with `new URL('./quote.worker.ts', import.meta.url)`, so Vite
 * bundles it as its own chunk in the build and serves it in dev. The path stays inside this showcase's directory,
 * which is what the showcase-isolation guard checks. Tests pass their own `spawn` and need no Worker.
 */

import type { QuoteEvaluation, QuoteRequest } from './evaluate'
import type { WorkerRequestMessage, WorkerResponseMessage } from './worker-protocol'

/** The part of a `Worker` this client uses, so a test can stand one in. */
export interface QuoteWorkerLike {
	onmessage: ((event: { readonly data: unknown }) => void) | null
	onerror: ((event: { readonly message?: string }) => void) | null
	postMessage: (message: WorkerRequestMessage) => void
	terminate: () => void
}

export interface QuoteBackend {
	evaluate: (request: QuoteRequest) => Promise<QuoteEvaluation>
	dispose: () => void
}

/** Starts the real Worker. The one place that names the file. */
export function spawnQuoteWorker(): QuoteWorkerLike {
	return new Worker(new URL('./quote.worker.ts', import.meta.url), { type: 'module' }) as unknown as QuoteWorkerLike
}

interface Pending {
	readonly resolve: (evaluation: QuoteEvaluation) => void
	readonly reject: (error: Error) => void
}

export function createWorkerBackend(spawn: () => QuoteWorkerLike = spawnQuoteWorker): QuoteBackend {
	let worker: QuoteWorkerLike | null = null
	let nextId = 1
	const pending = new Map<number, Pending>()

	function failAll(error: Error): void {
		const waiting = [...pending.values()]
		pending.clear()
		for (const entry of waiting)
			entry.reject(error)
	}

	function stop(): void {
		const current = worker
		worker = null
		current?.terminate()
	}

	function ensureWorker(): QuoteWorkerLike {
		if (worker !== null)
			return worker
		const created = spawn()
		created.onmessage = (event) => {
			const message = event.data as Partial<WorkerResponseMessage> | null
			if (typeof message?.id !== 'number' || typeof message.output !== 'string')
				return
			const entry = pending.get(message.id)
			if (entry === undefined)
				return
			pending.delete(message.id)
			try {
				entry.resolve(JSON.parse(message.output) as QuoteEvaluation)
			}
			catch {
				entry.reject(new Error('The Web Worker answered with text that is not JSON.'))
			}
		}
		created.onerror = (event) => {
			stop()
			failAll(new Error(`The Web Worker stopped: ${event.message ?? 'unknown error'}`))
		}
		worker = created
		return created
	}

	return {
		evaluate: (request) => {
			return new Promise<QuoteEvaluation>((resolve, reject) => {
				try {
					const id = nextId++
					pending.set(id, { resolve, reject })
					ensureWorker()
						.postMessage({ id, input: JSON.stringify(request) })
				}
				catch (error) {
					failAll(error instanceof Error ? error : new Error(String(error)))
					stop()
				}
			})
		},
		dispose: () => {
			stop()
			failAll(new Error('The quote backend was disposed.'))
		},
	}
}
