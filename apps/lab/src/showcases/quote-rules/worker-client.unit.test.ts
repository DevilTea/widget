/**
 * The Preview's side of the Worker and the Worker's own message handler, with a stand-in `Worker` that runs the REAL
 * handler (`handleWorkerMessage`, the whole body of `quote.worker.ts`) on the text it was sent, so what is tested is
 * the protocol: JSON text in, JSON text out, answered by request id. The real Worker in a real browser is the e2e
 * suite's (`e2e/quote-rules.spec.ts`).
 */

import type { QuoteWorkerLike } from './worker-client'
import type { WorkerRequestMessage } from './worker-protocol'
import { describe, expect, it } from 'vitest'
import { evaluateQuote } from './evaluate'
import { parsedPreset } from './test-support'
import { createWorkerBackend } from './worker-client'
import { handleWorkerMessage, isWorkerRequestMessage } from './worker-protocol'

class FakeWorker implements QuoteWorkerLike {
	onmessage: QuoteWorkerLike['onmessage'] = null
	onerror: QuoteWorkerLike['onerror'] = null
	readonly received: WorkerRequestMessage[] = []
	terminated = false
	/** Replies are held until `flush()`, in the order they were asked, or in reverse with `reverse`. */
	readonly held: (() => void)[] = []
	hold = false

	postMessage(message: WorkerRequestMessage): void {
		this.received.push(message)
		const reply = (): void => {
			const response = handleWorkerMessage(message)
			// A real postMessage clones the data: nothing but the string crosses.
			this.onmessage?.({ data: JSON.parse(JSON.stringify(response)) })
		}
		if (this.hold)
			this.held.push(reply)
		else
			queueMicrotask(reply)
	}

	terminate(): void {
		this.terminated = true
	}

	flush(options: { reverse?: boolean } = {}): void {
		const replies = options.reverse === true
			? this.held.splice(0)
					.reverse()
			: this.held.splice(0)
		for (const reply of replies) reply()
	}
}

const request = (quantity: number) => ({ quote: parsedPreset(), answers: { flyers: { quantity } } })

describe('handleWorkerMessage', () => {
	it('answers a request message with JSON text of the evaluation, under the same id', () => {
		const reply = handleWorkerMessage({ id: 7, input: JSON.stringify(request(77)) })
		expect(reply?.id)
			.toBe(7)
		expect(typeof reply?.output)
			.toBe('string')
		expect(JSON.parse(reply!.output))
			.toEqual(JSON.parse(JSON.stringify(evaluateQuote(request(77)))))
	})

	it('ignores a message that is not a request', () => {
		for (const data of [null, 'hello', { id: 'x', input: '{}' }, { id: 1 }, { input: '{}' }]) {
			expect(handleWorkerMessage(data), JSON.stringify(data))
				.toBeNull()
		}
		expect(isWorkerRequestMessage({ id: 1, input: '{}' }))
			.toBe(true)
	})

	it('answers unparsable text with an invalid-request outcome instead of throwing', () => {
		const reply = handleWorkerMessage({ id: 1, input: '{nope' })
		expect(JSON.parse(reply!.output).outcome)
			.toMatchObject({ ok: false, failure: { kind: 'invalid-request' } })
	})
})

describe('createWorkerBackend', () => {
	it('sends the request as JSON text and resolves with the parsed evaluation', async () => {
		const worker = new FakeWorker()
		const backend = createWorkerBackend(() => worker)
		const evaluation = await backend.evaluate(request(77))
		expect(worker.received)
			.toHaveLength(1)
		expect(typeof worker.received[0]!.input)
			.toBe('string')
		expect(JSON.parse(worker.received[0]!.input))
			.toEqual(JSON.parse(JSON.stringify(request(77))))
		expect(evaluation)
			.toEqual(JSON.parse(JSON.stringify(evaluateQuote(request(77)))))
	})

	it('starts the Worker on the first request only, and reuses it', async () => {
		let spawned = 0
		const worker = new FakeWorker()
		const backend = createWorkerBackend(() => {
			spawned++
			return worker
		})
		expect(spawned)
			.toBe(0)
		await backend.evaluate(request(1))
		await backend.evaluate(request(2))
		expect(spawned)
			.toBe(1)
	})

	it('matches each reply to its own request even when they come back out of order', async () => {
		const worker = new FakeWorker()
		worker.hold = true
		const backend = createWorkerBackend(() => worker)
		const first = backend.evaluate(request(10))
		const second = backend.evaluate(request(3000))
		worker.flush({ reverse: true })
		const [a, b] = await Promise.all([first, second])
		// flyers 10 x 9 + 3500 + 2900 = 6490; flyers 3000 x 9 + 3500 + 2900 = 33400
		expect(a.outcome.ok && a.outcome.quote.subtotalCents)
			.toBe(6490)
		expect(b.outcome.ok && b.outcome.quote.subtotalCents)
			.toBe(33400)
	})

	it('rejects what is waiting when the Worker errors, and starts a new one for the next request', async () => {
		const workers: FakeWorker[] = []
		const backend = createWorkerBackend(() => {
			const worker = new FakeWorker()
			worker.hold = workers.length === 0
			workers.push(worker)
			return worker
		})
		const waiting = backend.evaluate(request(1))
		workers[0]!.onerror?.({ message: 'boom' })
		await expect(waiting)
			.rejects
			.toThrow('The Web Worker stopped: boom')
		expect(workers[0]!.terminated)
			.toBe(true)
		await expect(backend.evaluate(request(2)))
			.resolves
			.toMatchObject({ outcome: { ok: true } })
		expect(workers)
			.toHaveLength(2)
	})

	it('rejects when the Worker cannot be started at all', async () => {
		const backend = createWorkerBackend(() => {
			throw new Error('Workers are blocked here')
		})
		await expect(backend.evaluate(request(1)))
			.rejects
			.toThrow('Workers are blocked here')
	})

	it('rejects a reply that is not JSON, and terminates and rejects on dispose()', async () => {
		const worker = new FakeWorker()
		worker.hold = true
		const backend = createWorkerBackend(() => worker)
		const broken = backend.evaluate(request(1))
		worker.onmessage?.({ data: { id: worker.received[0]!.id, output: 'not json' } })
		await expect(broken)
			.rejects
			.toThrow('not JSON')
		const pending = backend.evaluate(request(2))
		backend.dispose()
		await expect(pending)
			.rejects
			.toThrow('disposed')
		expect(worker.terminated)
			.toBe(true)
	})
})
