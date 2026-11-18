// @vitest-environment happy-dom
/**
 * The quote's renderers (through the real `QuoteRenderer`, so with the real host) over real Runtimes: what they show,
 * what they write, the side-by-side comparison with the backend, the isolated exception reaching the page's
 * handler, and the language and theme from the showcase host. The Web Worker is an in-process stand-in that runs the
 * real worker handler on JSON text; the real Worker is the e2e suite's.
 *
 * Expected amounts are hand-derived (see `plugins/quote.unit.test.ts`): the default quote is 12530 cents.
 */
import { setIsolatedErrorHandler } from '@deviltea/widget-core'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createQuoteRuntime, presetText, widgetOfType } from '../test-support'
import { createWorkerBackend } from '../worker-client'
import { createInProcessWorker, createTamperedBackend, createTestHost, mountQuote, widgetSelector } from './test-harness'

afterEach(() => {
	setIsolatedErrorHandler(null)
})

type Wrapper = Awaited<ReturnType<typeof mountQuote>>

function text(wrapper: Wrapper, selector: string): string {
	return wrapper.find(selector)
		.text()
}

async function typeQuantity(wrapper: Wrapper, id: string, value: string): Promise<void> {
	await wrapper.find(`${widgetSelector(id)} [data-testid="quote-quantity"]`)
		.setValue(value)
	await flushPromises()
}

describe('the page', () => {
	it('shows the title, the items then the rules in order, and the total the plugins computed', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)

		expect(wrapper.find('h1')
			.text())
			.toBe('Corner Press: print job')
		expect(wrapper.findAll('[data-widget-id]')
			.map(element => element.attributes('data-widget-id')))
			.toEqual(['quote', 'flyers', 'cards', 'poster', 'volume', 'rush', 'delivery', 'tax'])
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€125.30')
		expect(text(wrapper, '[data-testid="quote-subtotal"]'))
			.toBe('€109.00')
		expect(wrapper.find(`${widgetSelector('flyers')} [data-testid="quote-line-total"]`)
			.text())
			.toBe('€45.00')
		expect(wrapper.find(`${widgetSelector('volume')} [data-testid="quote-rule-amount"]`)
			.text())
			.toBe('−€5.45')
		expect(wrapper.find(`${widgetSelector('volume')} [data-testid="quote-rule-note"]`)
			.text())
			.toBe('5% applied')
		expect(wrapper.find(`${widgetSelector('rush')} [data-testid="quote-rule-note"]`)
			.text())
			.toBe('Not applied')
		wrapper.unmount()
	})

	it('writes State from the controls: a quantity, a paper, rush and courier delivery, and the total follows', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)

		await typeQuantity(wrapper, 'flyers', '600')
		// 600 x 9 + 3500 + 2900 = 11800; 852 pieces -> 5% = 590; taxable 11210; tax 2354.1 -> 2354; total 13564
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€135.64')
		expect(widgetOfType(runtime, 'flyers', 'Item').state.quantity.get())
			.toBe(600)

		await wrapper.find(`${widgetSelector('flyers')} [data-testid="quote-paper"]`)
			.setValue('gloss')
		await flushPromises()
		// 600 x 12 = 7200: subtotal 13600; 5% = 680; taxable 12920; tax 2713.2 -> 2713; total 15633
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€156.33')

		await wrapper.find('[data-testid="quote-rush"]')
			.setValue(true)
		await wrapper.find('[data-testid="quote-delivery"]')
			.setValue('courier')
		await flushPromises()
		expect(widgetOfType(runtime, 'rush', 'RushSurcharge').state.enabled.get())
			.toBe(true)
		expect(widgetOfType(runtime, 'delivery', 'Delivery').state.method.get())
			.toBe('courier')
		// rush 25% of 13600 = 3400; courier 900 (subtotal below 200.00); taxable 13600 - 680 + 3400 + 900 = 17220; tax 3616.2 -> 3616; total 20836
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€208.36')
		wrapper.unmount()
	})

	it('refuses a quantity the schema library refuses: nothing is stored and the field shows the stored value again', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)
		await typeQuantity(wrapper, 'flyers', '0')
		expect(widgetOfType(runtime, 'flyers', 'Item').state.quantity.get())
			.toBe(500)
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€125.30')
		wrapper.unmount()
	})

	it('"Start over" asks the host for runtime.resetState(): every answer goes back to the document\'s', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)
		await typeQuantity(wrapper, 'flyers', '9')
		await wrapper.find('[data-testid="quote-rush"]')
			.setValue(true)
		await wrapper.find('[data-testid="quote-start-over"]')
			.trigger('click')
		await flushPromises()
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€125.30')
		expect((wrapper.find('[data-testid="quote-rush"]').element as HTMLInputElement).checked)
			.toBe(false)
		wrapper.unmount()
	})

	it('gives every control an accessible name through a label, and every disclosure a button with aria-expanded', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime, { attachTo: document.body })
		for (const control of wrapper.findAll('input, select')) {
			const id = control.attributes('id')
			expect(id, control.html())
				.toBeTruthy()
			expect(document.querySelector(`label[for="${id}"]`)?.textContent?.trim(), control.html())
				.toBeTruthy()
		}
		for (const toggle of wrapper.findAll('[data-testid$="-json-toggle"]')) {
			expect(toggle.attributes('aria-expanded'))
				.toBe('false')
			expect(toggle.attributes('aria-controls'))
				.toBeTruthy()
		}
		expect(wrapper.findAll('h1'))
			.toHaveLength(1)
		expect(wrapper.find('main')
			.exists())
			.toBe(true)
		wrapper.unmount()
	})
})

describe('the same rules, twice', () => {
	it('shows both outcomes and says they are the same JSON text, after the worker answered', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('data-state'))
			.toBe('match')
		expect(text(wrapper, '[data-testid="quote-browser-total"]'))
			.toBe('€125.30')
		expect(text(wrapper, '[data-testid="quote-worker-total"]'))
			.toBe('€125.30')
		wrapper.unmount()
	})

	it('follows an answer to the worker: both columns move together and still match', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)
		await typeQuantity(wrapper, 'flyers', '600')
		expect(text(wrapper, '[data-testid="quote-browser-total"]'))
			.toBe('€135.64')
		expect(text(wrapper, '[data-testid="quote-worker-total"]'))
			.toBe('€135.64')
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('data-state'))
			.toBe('match')
		wrapper.unmount()
	})

	it('shows each side\'s JSON on demand, and the two texts are identical', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)
		await wrapper.find('[data-testid="quote-browser-json-toggle"]')
			.trigger('click')
		await wrapper.find('[data-testid="quote-worker-json-toggle"]')
			.trigger('click')
		expect(wrapper.find('[data-testid="quote-browser-json-toggle"]')
			.attributes('aria-expanded'))
			.toBe('true')
		const browser = text(wrapper, '[data-testid="quote-browser-json"]')
		expect(browser)
			.toContain('"totalCents": 12530')
		expect(text(wrapper, '[data-testid="quote-worker-json"]'))
			.toBe(browser)
		wrapper.unmount()
	})

	it('sends the document and the answers as JSON text, and nothing else, to the backend', async () => {
		const { runtime } = createQuoteRuntime()
		const sent: string[] = []
		const wrapper = await mountQuote(runtime, {
			backend: () => createWorkerBackend(() => {
				const worker = createInProcessWorker()
				const post = worker.postMessage
				worker.postMessage = (message) => {
					sent.push(message.input)
					post(message)
				}
				return worker
			}),
		})
		await typeQuantity(wrapper, 'cards', '260')
		expect(sent.length)
			.toBeGreaterThanOrEqual(2)
		const last = JSON.parse(sent.at(-1)!)
		expect(Object.keys(last)
			.sort())
			.toEqual(['answers', 'quote'])
		expect(last.quote)
			.toEqual(JSON.parse(presetText('quote-default')))
		expect(last.answers.cards)
			.toEqual({ quantity: 260, paper: 'standard' })
		wrapper.unmount()
	})

	it('says so when the two sides differ (a defective backend), and never claims a match it did not see', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime, {
			backend: () => createTamperedBackend((evaluation) => {
				if (evaluation.outcome.ok)
					return { ...evaluation, outcome: { ok: true, quote: { ...evaluation.outcome.quote, totalCents: evaluation.outcome.quote.totalCents + 1 } } }
				return evaluation
			}),
		})
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('data-state'))
			.toBe('mismatch')
		expect(text(wrapper, '[data-testid="quote-browser-total"]'))
			.toBe('€125.30')
		expect(text(wrapper, '[data-testid="quote-worker-total"]'))
			.toBe('€125.31')
		wrapper.unmount()
	})

	it('says the worker is unavailable when it cannot start, and the page keeps working', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime, {
			backend: () => createWorkerBackend(() => {
				throw new Error('Workers are blocked here')
			}),
		})
		const status = wrapper.find('[data-testid="quote-comparison"]')
		expect(status.attributes('data-state'))
			.toBe('unavailable')
		expect(status.text())
			.toContain('Workers are blocked here')
		await typeQuantity(wrapper, 'flyers', '600')
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€135.64')
		wrapper.unmount()
	})
})

describe('a rule that throws', () => {
	async function mountBuggy() {
		const { runtime } = createQuoteRuntime(presetText('quote-buggy-rule'))
		const wrapper = await mountQuote(runtime)
		return { runtime, wrapper }
	}

	it('keeps the page alive, says the amounts are the last that worked, and lists the exception with its widget', async () => {
		const { wrapper } = await mountBuggy()
		expect(wrapper.find('[data-testid="quote-stale"]')
			.exists())
			.toBe(false)
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€45.75')

		await typeQuantity(wrapper, 'flyers', '50')

		expect(wrapper.find('[data-testid="quote-stale"]')
			.exists())
			.toBe(true)
		// The page did not re-render the Property that threw: the last amounts stay.
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€45.75')
		const entries = wrapper.findAll('[data-testid="quote-isolated-entry"]')
		expect(entries)
			.toHaveLength(1)
		expect(entries[0]!.text())
			.toContain('TypeError')
		expect(entries[0]!.text())
			.toContain('from volume.adjustment')
		expect(wrapper.find(`${widgetSelector('volume')}`)
			.attributes('data-state'))
			.toBe('threw')
		expect(wrapper.find(`${widgetSelector('volume')} [data-testid="quote-rule-threw"]`)
			.exists())
			.toBe(true)
		// Both columns say what happened, and they agree about it.
		expect(text(wrapper, '[data-testid="quote-browser-failure"]'))
			.toContain('volume.adjustment threw TypeError')
		expect(wrapper.find('[data-testid="quote-comparison"]')
			.attributes('data-state'))
			.toBe('match')
		expect(text(wrapper, '[data-testid="quote-worker-failure"]'))
			.toBe(text(wrapper, '[data-testid="quote-browser-failure"]'))
		wrapper.unmount()
	})

	it('recovers when the quantity is raised again: the banner goes, the new total shows, the log keeps its entry', async () => {
		const { wrapper } = await mountBuggy()
		await typeQuantity(wrapper, 'flyers', '50')
		await typeQuantity(wrapper, 'flyers', '300')
		expect(wrapper.find('[data-testid="quote-stale"]')
			.exists())
			.toBe(false)
		// 300 x 9 + 2900 = 5600; 5% = 280; taxable 5320; tax 1117.2 -> 1117; total 6437
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€64.37')
		expect(wrapper.findAll('[data-testid="quote-isolated-entry"]'))
			.toHaveLength(1)
		expect(wrapper.find(`${widgetSelector('volume')}`)
			.attributes('data-state'))
			.toBe('applied')
		await wrapper.find('[data-testid="quote-isolated-clear"]')
			.trigger('click')
		expect(wrapper.find('[data-testid="quote-isolated"]')
			.attributes('data-count'))
			.toBe('0')
		wrapper.unmount()
	})

	it('mounts a document that already starts below the first tier: no quote yet, the exception listed, nothing crashed', async () => {
		const { runtime } = createQuoteRuntime(presetText('quote-buggy-rule')
			.replace('"quantity": 120', '"quantity": 10'))
		const wrapper = await mountQuote(runtime)
		expect(text(wrapper, '[data-testid="quote-none"]'))
			.toBe('There is no quote to show yet.')
		expect(wrapper.find('[data-testid="quote-stale"]')
			.exists())
			.toBe(true)
		const entries = wrapper.findAll('[data-testid="quote-isolated-entry"]')
		expect(entries.length)
			.toBeGreaterThanOrEqual(1)
		expect(entries[0]!.text())
			.toContain('from volume.adjustment')
		expect(wrapper.find(`${widgetSelector('volume')}`)
			.attributes('data-state'))
			.toBe('threw')
		// The worker has the same thing to say about the same document.
		expect(text(wrapper, '[data-testid="quote-worker-failure"]'))
			.toBe(text(wrapper, '[data-testid="quote-browser-failure"]'))
		wrapper.unmount()
	})

	it('puts back the isolated-error handler it replaced when the page unmounts', async () => {
		const sentinel = (): void => {}
		setIsolatedErrorHandler(sentinel)
		const { wrapper } = await mountBuggy()
		wrapper.unmount()
		expect(setIsolatedErrorHandler(null))
			.toBe(sentinel)
	})

	it('has no exception to show in the default quote', async () => {
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime)
		await typeQuantity(wrapper, 'flyers', '1')
		expect(wrapper.find('[data-testid="quote-stale"]')
			.exists())
			.toBe(false)
		expect(wrapper.find('[data-testid="quote-isolated"]')
			.attributes('data-count'))
			.toBe('0')
		wrapper.unmount()
	})
})

describe('the host\'s language and theme', () => {
	it('speaks the host\'s locale: its own text and the document\'s text and money follow it', async () => {
		const host = createTestHost({ locale: 'en' })
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime, { host })
		expect(text(wrapper, '[data-testid="quote-start-over"]'))
			.toBe('Start over')

		host.locale.value = 'zh-TW'
		await flushPromises()
		expect(wrapper.find('h1')
			.text())
			.toBe('轉角印刷：印製報價')
		expect(text(wrapper, '[data-testid="quote-start-over"]'))
			.toBe('重新開始')
		expect(wrapper.find(`${widgetSelector('flyers')} h3`)
			.text())
			.toBe('A5 傳單')
		expect(wrapper.find('h2')
			.text())
			.toBe('品項')
		expect(text(wrapper, '[data-testid="quote-total"]'))
			.toBe('€125.30')
		wrapper.unmount()
	})

	it('paints from its own --quote tokens and follows the host theme', async () => {
		const host = createTestHost({ theme: 'light' })
		const { runtime } = createQuoteRuntime()
		const wrapper = await mountQuote(runtime, { host })
		expect(wrapper.find('main')
			.attributes('data-quote-theme'))
			.toBe('light')
		host.theme.value = 'dark'
		await flushPromises()
		expect(wrapper.find('main')
			.attributes('data-quote-theme'))
			.toBe('dark')
		wrapper.unmount()
	})
})
