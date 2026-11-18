/**
 * The message protocol between the Preview and the quote Web Worker, kept apart from the worker's own entry
 * (`./quote.worker.ts`) so the same handler can be driven in a unit test with no Worker at all.
 *
 * The request and the response are JSON **text**, not structured-clone objects: the worker is a stand-in for a
 * backend, and a backend only ever receives and returns bytes. Nothing but a string crosses the boundary, so the
 * browser cannot lean on an object identity or a prototype the backend would not have. No Vue, no DOM.
 */

import { evaluateQuoteJson } from './evaluate'

export interface WorkerRequestMessage {
	readonly id: number
	/** A JSON-encoded `QuoteRequest`. */
	readonly input: string
}

export interface WorkerResponseMessage {
	readonly id: number
	/** A JSON-encoded `QuoteEvaluation`. */
	readonly output: string
}

export function isWorkerRequestMessage(value: unknown): value is WorkerRequestMessage {
	return typeof value === 'object' && value !== null && typeof (value as WorkerRequestMessage).id === 'number' && typeof (value as WorkerRequestMessage).input === 'string'
}

/** The worker's whole behaviour: a request message in, the response message out, `null` for a message that is not ours. */
export function handleWorkerMessage(data: unknown): WorkerResponseMessage | null {
	if (!isWorkerRequestMessage(data))
		return null
	return { id: data.id, output: evaluateQuoteJson(data.input) }
}
