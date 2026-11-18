// @vitest-environment happy-dom
/**
 * The host of one Runtime (`quote-host.ts`): the Worker's lifecycle and which answer of the backend counts. The backend
 * here is a controlled one, so a test decides when and in what order its replies arrive; the page, the Runtime and the
 * evaluation are real.
 */
import type { QuoteRequest } from '../evaluate'
import type { QuoteBackend } from '../worker-client'
import { setIsolatedErrorHandler } from '@deviltea/widget-core'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateQuote } from '../evaluate'
import { createQuoteRuntime, widgetOfType } from '../test-support'
import { createQuoteHost } from './quote-host'
import { mountQuote, widgetSelector } from './test-harness'

afterEach(() => {
	setIsolatedErrorHandler(null)
})

interface Call {
	readonly request: QuoteRequest
	/** Answers it with the real evaluation of what it was asked, as a Worker would (JSON text round trip). */
	readonly answer: () => void
	readonly fail: (error: Error) => void
}

function createControlledBackend() {
	const calls: Call[] = []
	const dispose = vi.fn()
	const backend: QuoteBackend = {
		evaluate: request => new Promise((resolve, reject) => {
			calls.push({
				request,
				answer: () => resolve(JSON.parse(JSON.stringify(evaluateQuote(JSON.parse(JSON.stringify(request)))))),
				fail: reject,
			})
		}),
		dispose,
	}
	return { backend, calls, dispose }
}

async function typeQuantity(wrapper: Awaited<ReturnType<typeof mountQuote>>, id: string, value: string): Promise<void> {
	await wrapper.find(`${widgetSelector(id)} [data-testid="quote-quantity"]`)
		.setValue(value)
	await flushPromises()
}

describe('the Worker\'s lifecycle', () => {
	it('disposes the backend when the page unmounts, and asks it nothing afterwards', async () => {
		const { runtime } = createQuoteRuntime()
		const { backend, calls, dispose } = createControlledBackend()
		const wrapper = await mountQuote(runtime, { backend: () => backend })
		expect(dispose)
			.not
			.toHaveBeenCalled()
		expect(calls)
			.toHaveLength(1)

		wrapper.unmount()
		expect(dispose)
			.toHaveBeenCalledTimes(1)

		// The Runtime outlives the page (the Lab disposes it after unmounting); writing to it asks nobody.
		widgetOfType(runtime, 'flyers', 'Item').state.quantity.set(7)
		expect(calls)
			.toHaveLength(1)
	})

	it('disposes the backend once however often it is disposed, and ignores a reply that arrives afterwards', async () => {
		const { runtime } = createQuoteRuntime()
		const { backend, calls, dispose } = createControlledBackend()
		const { host, dispose: stop } = createQuoteHost(runtime, backend)
		stop()
		stop()
		expect(dispose)
			.toHaveBeenCalledTimes(1)
		calls[0]!.answer()
		await flushPromises()
		expect(host.worker.value.status)
			.toBe('pending')
	})

	it('gives a page for another Runtime its own backend, and disposes the first one\'s', async () => {
		const first = createControlledBackend()
		const second = createControlledBackend()
		const backends = [first.backend, second.backend]
		const wrapper = await mountQuote(createQuoteRuntime().runtime, { backend: () => backends.shift()! })
		wrapper.unmount()
		const other = await mountQuote(createQuoteRuntime().runtime, { backend: () => backends.shift()! })
		expect(first.dispose)
			.toHaveBeenCalledTimes(1)
		expect(second.dispose)
			.not
			.toHaveBeenCalled()
		other.unmount()
		expect(second.dispose)
			.toHaveBeenCalledTimes(1)
	})
})

describe('which answer of the backend counts', () => {
	it('keeps the answer to the latest request when the answers come back out of order', async () => {
		const { runtime } = createQuoteRuntime()
		const { backend, calls } = createControlledBackend()
		const wrapper = await mountQuote(runtime, { backend: () => backend })
		calls[0]!.answer()
		await flushPromises()

		await typeQuantity(wrapper, 'flyers', '600')
		await typeQuantity(wrapper, 'flyers', '1200')
		expect(calls)
			.toHaveLength(3)
		// The newest request is answered first, then the older one arrives late.
		calls[2]!.answer()
		await flushPromises()
		calls[1]!.answer()
		await flushPromises()

		// 1200 x 9 + 3500 + 2900 = 17200; 1452 pieces -> 10% = 1720; taxable 15480; tax 21% = 3251; total 18731
		expect(wrapper.find('[data-testid="quote-worker-total"]')
			.text())
			.toBe('€187.31')
		expect(wrapper.find('[data-testid="quote-browser-total"]')
			.text())
			.toBe('€187.31')
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('data-state'))
			.toBe('match')
		wrapper.unmount()
	})

	it('ignores a failure of an older request once a newer one is answered', async () => {
		const { runtime } = createQuoteRuntime()
		const { backend, calls } = createControlledBackend()
		const wrapper = await mountQuote(runtime, { backend: () => backend })
		await typeQuantity(wrapper, 'flyers', '600')
		calls[1]!.answer()
		await flushPromises()
		calls[0]!.fail(new Error('too late to matter'))
		await flushPromises()
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('data-state'))
			.toBe('match')
		wrapper.unmount()
	})

	it('shows the previous worker outcome while the next is awaited, and says it is waiting', async () => {
		const { runtime } = createQuoteRuntime()
		const { backend, calls } = createControlledBackend()
		const wrapper = await mountQuote(runtime, { backend: () => backend })
		calls[0]!.answer()
		await flushPromises()
		await typeQuantity(wrapper, 'flyers', '600')
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('data-state'))
			.toBe('pending')
		expect(wrapper.find('[data-testid="quote-worker-total"]')
			.text())
			.toBe('€125.30')
		wrapper.unmount()
	})
})

describe('what a screen reader is told about the comparison', () => {
	it('announces only a settled result: the live region keeps its text while the worker is asked again', async () => {
		const { runtime } = createQuoteRuntime()
		const { backend, calls } = createControlledBackend()
		const wrapper = await mountQuote(runtime, { backend: () => backend })
		const live = (): string => wrapper.find('[data-testid="quote-comparison-live"]')
			.text()
		const visible = (): string => wrapper.find('[data-testid="quote-comparison"]')
			.text()
		expect(live())
			.toBe('')
		expect(visible())
			.toContain('Waiting for the worker')

		calls[0]!.answer()
		await flushPromises()
		expect(live())
			.toBe('Identical JSON')

		// Every keystroke goes through "waiting" on the visible line; the live region stays on the settled result.
		await typeQuantity(wrapper, 'flyers', '6')
		expect(visible())
			.toContain('Waiting for the worker')
		expect(live())
			.toBe('Identical JSON')
		await typeQuantity(wrapper, 'flyers', '60')
		expect(live())
			.toBe('Identical JSON')
		calls[2]!.answer()
		await flushPromises()
		expect(visible())
			.toContain('Identical JSON')
		expect(live())
			.toBe('Identical JSON')
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('role'))
			.toBeUndefined()
		expect(wrapper.find('[data-testid="quote-comparison-live"]')
			.attributes('role'))
			.toBe('status')

		// A different settled result is announced.
		await typeQuantity(wrapper, 'flyers', '61')
		calls[3]!.fail(new Error('Workers are blocked here'))
		await flushPromises()
		expect(live())
			.toBe('The worker is not available: Workers are blocked here')
		wrapper.unmount()
	})
})
