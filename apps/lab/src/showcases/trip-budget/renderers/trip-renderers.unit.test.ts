// @vitest-environment happy-dom
/**
 * The trip's renderers (through the real `TripBudgetRenderer`) over real Runtimes: what they show, what they
 * write, the controls' labels, the lazily-read disclosures and the two `resetState()` actions.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabThemeKey } from '../../../composables/use-lab-theme'
import { createRuntimeReader } from '../../../tutorial/inspection-reader'
import { tripBudgetPresets } from '../presets'
import { createTripRuntime, widgetOfType } from '../test-support'
import { mountTrip, widgetSelector } from './test-harness'

function presetSource(id: string): string {
	return tripBudgetPresets.find(preset => preset.id === id)!.sourceText
}

async function typeAmount(wrapper: Awaited<ReturnType<typeof mountTrip>>, expenseId: string, value: string): Promise<void> {
	await wrapper.find(`${widgetSelector(expenseId)} [data-testid="trip-amount"]`)
		.setValue(value)
	await flushPromises()
}

function transfers(wrapper: Awaited<ReturnType<typeof mountTrip>>): string[] {
	return wrapper.findAll('[data-testid="trip-transfer"]')
		// The sentence and the amount are separate flex items, so there is no space between them in the text.
		.map(row => row.findAll('span, strong')
			.map(part => part.text())
			.join(' '))
}

describe('the page', () => {
	it('shows the title, the settlement above the people and the expenses, and the anchors in order', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)

		expect(wrapper.find('h1')
			.text())
			.toBe('Lisbon weekend')
		expect(wrapper.findAll('[data-widget-id]')
			.map(element => element.attributes('data-widget-id')))
			.toEqual(['lisbon', 'currency', 'settlement', 'ana', 'ben', 'chloe', 'dev', 'hotel', 'dinner', 'museum', 'taxi', 'market'])
		expect(wrapper.find('[data-testid="trip-total"]')
			.text())
			.toBe('€651.74')
		expect(transfers(wrapper))
			.toEqual(['Chloe pays Ana €119.22', 'Ben pays Ana €61.99', 'Dev pays Ana €56.23'])
		expect(wrapper.find(`${widgetSelector('ana')} [data-testid="trip-person-status"]`)
			.text())
			.toBe('+ gets back €237.44')
		expect(wrapper.find(`${widgetSelector('ben')} [data-testid="trip-person-status"]`)
			.text())
			.toBe('− owes €61.99')
		wrapper.unmount()
	})

	it('gives every control an accessible name through a label, and every disclosure a button with aria-expanded', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime, { attachTo: document.body })

		const controls = wrapper.findAll('input, select')
		expect(controls.length)
			.toBeGreaterThan(20)
		for (const control of controls) {
			const element = control.element as HTMLInputElement
			const labelled = element.labels !== null && element.labels.length > 0 && (element.labels[0]!.textContent ?? '').trim() !== ''
			expect(labelled, control.html())
				.toBe(true)
		}
		for (const toggle of wrapper.findAll('[data-testid$="-toggle"]')) {
			expect(toggle.element.tagName)
				.toBe('BUTTON')
			expect(toggle.attributes('aria-expanded'))
				.toBe('false')
			expect(toggle.attributes('aria-controls'))
				.toBeTruthy()
		}
		for (const button of wrapper.findAll('button')) {
			expect(button.attributes('type'), button.text())
				.toBe('button')
		}
		wrapper.unmount()
	})

	it('switches every text and amount format when the language changes, and writes State language', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)

		await wrapper.find('[data-testid="trip-language"]')
			.setValue('zh-TW')
		await flushPromises()

		expect(widgetOfType(runtime, 'lisbon', 'Trip').state.language.get())
			.toBe('zh-TW')
		expect(wrapper.find('h1')
			.text())
			.toBe('里斯本週末小旅行')
		expect(wrapper.find('[data-testid="trip-start-over"]')
			.text())
			.toBe('重新開始')
		expect(transfers(wrapper)[0])
			.toBe('Chloe 付給 Ana €119.22')
		expect(wrapper.find(`${widgetSelector('hotel')} h3`)
			.text())
			.toBe('旅館三晚')
		expect(wrapper.find(`${widgetSelector('ben')} [data-testid="trip-person-status"]`)
			.text())
			.toBe('− 要付 €61.99')
		wrapper.unmount()
	})

	it('paints from its own --trip tokens, chosen by the host theme, and defaults to light outside the Lab', async () => {
		const { runtime } = createTripRuntime()
		const plain = await mountTrip(runtime)
		expect(plain.find('.trip')
			.attributes('data-trip-theme'))
			.toBe('light')
		plain.unmount()

		const dark = await mountTrip(runtime, { provide: { [LabThemeKey as symbol]: { theme: { value: 'dark' }, themes: ['light', 'dark'], setTheme: () => {} } } })
		expect(dark.find('.trip')
			.attributes('data-trip-theme'))
			.toBe('dark')
		dark.unmount()
	})
})

describe('editing an expense', () => {
	it('moves the settlement when the amount is typed, and shows the converted amount of a foreign expense', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)

		await typeAmount(wrapper, 'hotel', '520')
		expect(widgetOfType(runtime, 'hotel', 'Expense').state.amount.get())
			.toBe(520)
		expect(wrapper.find('[data-testid="trip-total"]')
			.text())
			.toBe('€751.74')
		expect(wrapper.find(`${widgetSelector('museum')} [data-testid="trip-converted"]`)
			.text())
			.toBe('≈ €58.88')
		expect(wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-converted"]`)
			.exists())
			.toBe(false)
		wrapper.unmount()
	})

	it('shows a negative amount as an error next to the field and leaves the expense out of the settlement', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)

		await typeAmount(wrapper, 'hotel', '-5')
		const error = wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-expense-error"]`)
		expect(error.text())
			.toContain('The amount cannot be negative.')
		expect(error.text())
			.toContain('Not counted in the settlement')
		expect(error.attributes('data-error-code'))
			.toBe('amount-negative')
		expect(wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-amount"]`)
			.attributes('aria-invalid'))
			.toBe('true')
		expect(wrapper.find(widgetSelector('hotel'))
			.attributes('data-counted'))
			.toBe('false')
		expect(wrapper.find('[data-testid="trip-total"]')
			.text())
			.toBe('€231.74')

		await typeAmount(wrapper, 'hotel', '')
		expect(widgetOfType(runtime, 'hotel', 'Expense').state.amount.get())
			.toBeNull()
		expect(wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-expense-error"]`)
			.attributes('data-error-code'))
			.toBe('amount-missing')
		wrapper.unmount()
	})

	it('writes who paid, the currency and who shares', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)
		const dinner = widgetOfType(runtime, 'dinner', 'Expense')

		await wrapper.find(`${widgetSelector('dinner')} [data-testid="trip-paid-by"]`)
			.setValue('chloe')
		expect(dinner.state.paidBy.get())
			.toBe('chloe')

		await wrapper.find(`${widgetSelector('dinner')} [data-testid="trip-currency"]`)
			.setValue('USD')
		expect(dinner.state.currency.get())
			.toBe('USD')

		await wrapper.find(`${widgetSelector('dinner')} [data-testid="trip-share-chloe"]`)
			.setValue(false)
		expect(dinner.state.among.get())
			.toEqual(['ana', 'ben'])
		await wrapper.find(`${widgetSelector('dinner')} [data-testid="trip-share-dev"]`)
			.setValue(true)
		expect(dinner.state.among.get())
			.toEqual(['ana', 'ben', 'dev'])
		wrapper.unmount()
	})

	it('shows the authored percentages of a percent split as text, with no checkboxes', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)
		expect(wrapper.find(`${widgetSelector('taxi')} [data-testid="trip-percents"]`)
			.text())
			.toContain('Ana 40% · Ben 30% · Chloe 30%')
		expect(wrapper.findAll(`${widgetSelector('taxi')} input[type="checkbox"]`))
			.toHaveLength(0)
		wrapper.unmount()
	})

	it('offers a currency the expense has even when the Currency has no rate for it, so the select can show it', async () => {
		const { runtime } = createTripRuntime(presetSource('trip-unsupported-currency'))
		const wrapper = await mountTrip(runtime)
		const select = wrapper.find(`${widgetSelector('museum')} [data-testid="trip-currency"]`)
		expect((select.element as HTMLSelectElement).value)
			.toBe('CHF')
		expect(select.findAll('option')
			.map(option => option.text()))
			.toEqual(['EUR', 'USD', 'GBP', 'CHF'])
		wrapper.unmount()
	})

	it('ignores the mouse wheel on a focused number input', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime, { attachTo: document.body })
		const input = wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-amount"]`)
		;(input.element as HTMLInputElement).focus()
		expect(document.activeElement)
			.toBe(input.element)
		await input.trigger('wheel')
		expect(document.activeElement)
			.not
			.toBe(input.element)
		expect(widgetOfType(runtime, 'hotel', 'Expense').state.amount.get())
			.toBe(420)
		wrapper.unmount()
	})
})

describe('the money settings', () => {
	it('shows the base and the rates, and rounds the payments when the step changes', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)
		expect(wrapper.find('[data-testid="trip-base-currency"]')
			.text())
			.toBe('EUR')
		expect(wrapper.find('[data-testid="trip-rates"]')
			.text())
			.toBe('1 USD = 0.92 EUR · 1 GBP = 1.17 EUR')
		expect(wrapper.find('[data-testid="trip-rounding-gap"]')
			.exists())
			.toBe(false)

		await wrapper.find('[data-testid="trip-round-step"]')
			.setValue('100')
		expect(widgetOfType(runtime, 'currency', 'Currency').state.roundStep.get())
			.toBe(100)
		expect(transfers(wrapper))
			.toEqual(['Chloe pays Ana €119.00', 'Ben pays Ana €62.00', 'Dev pays Ana €56.00'])
		expect(wrapper.find('[data-testid="trip-rounding-gap"]')
			.text())
			.toBe('Rounded transfers differ from the exact balances by €0.44 in total.')
		wrapper.unmount()
	})

	it('says everyone is settled when there is nothing to pay', async () => {
		const { runtime } = createTripRuntime()
		for (const id of ['hotel', 'dinner', 'museum', 'taxi', 'market'])
			widgetOfType(runtime, id, 'Expense').state.amount.set(0)
		const wrapper = await mountTrip(runtime)
		expect(wrapper.find('[data-testid="trip-all-settled"]')
			.text())
			.toBe('Everyone is settled up.')
		expect(wrapper.find('[data-testid="trip-transfers"]')
			.exists())
			.toBe(false)
		wrapper.unmount()
	})
})

describe('a failed chain', () => {
	it('shows a notice at the expense and at the settlement instead of numbers', async () => {
		const { runtime } = createTripRuntime(presetSource('trip-unsupported-currency'))
		const wrapper = await mountTrip(runtime)

		const expense = wrapper.find(`${widgetSelector('museum')} [data-testid="trip-conversion-failed"]`)
		expect(expense.text())
			.toContain('No rate for this currency')
		expect(expense.attributes('role'))
			.toBe('alert')
		const settlement = wrapper.find('[data-testid="trip-settlement-failed"]')
		expect(settlement.attributes('role'))
			.toBe('alert')
		expect(wrapper.find('[data-testid="trip-total"]')
			.exists())
			.toBe(false)
		expect(wrapper.find(widgetSelector('settlement'))
			.attributes('data-failed'))
			.toBe('true')
		expect(wrapper.find(`${widgetSelector('ana')} [data-testid="trip-person-status"]`)
			.text())
			.toBe('')

		// Choosing a currency the Currency knows fixes it.
		await wrapper.find(`${widgetSelector('museum')} [data-testid="trip-currency"]`)
			.setValue('USD')
		expect(wrapper.find('[data-testid="trip-settlement-failed"]')
			.exists())
			.toBe(false)
		expect(wrapper.find('[data-testid="trip-total"]')
			.text())
			.toBe('€651.74')
		wrapper.unmount()
	})
})

describe('the lazily-read disclosures', () => {
	it('evaluates breakdown only while it is open', async () => {
		const { runtime } = createTripRuntime()
		const reader = createRuntimeReader(runtime)
		const wrapper = await mountTrip(runtime)
		const toggle = wrapper.find(`${widgetSelector('museum')} [data-testid="trip-breakdown-toggle"]`)

		// Everything the page shows is evaluated; the breakdown is not, and has no element.
		expect(reader.readProperty('museum', 'amountBase')?.status)
			.toBe('completed')
		expect(reader.readProperty('museum', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })
		expect(wrapper.find('[data-testid="trip-breakdown"]')
			.exists())
			.toBe(false)

		await toggle.trigger('click')
		expect(toggle.attributes('aria-expanded'))
			.toBe('true')
		expect(reader.readProperty('museum', 'breakdown')?.status)
			.toBe('completed')
		const panel = wrapper.find(`${widgetSelector('museum')} [data-testid="trip-breakdown"]`)
		expect(panel.attributes('id'))
			.toBe(toggle.attributes('aria-controls'))
		expect(panel.find('[data-testid="trip-breakdown-conversion"]')
			.text())
			.toBe('64.00 USD × 0.92 = €58.88')
		expect(panel.findAll('[data-testid="trip-breakdown-line"]')
			.map(line => line.text()))
			.toEqual(['Ana: €19.63 (equal split)', 'Chloe: €19.63 (equal split)', 'Dev: €19.62 (equal split)'])
		expect(panel.find('[data-testid="trip-breakdown-remainder"]')
			.text())
			.toBe('+2 cents to even out the rounding')

		// Other expenses stay unevaluated.
		expect(reader.readProperty('hotel', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })

		// The open breakdown follows an edit; closing removes it.
		await typeAmount(wrapper, 'museum', '70')
		expect(wrapper.find('[data-testid="trip-breakdown-conversion"]')
			.text())
			.toBe('70.00 USD × 0.92 = €64.40')
		await toggle.trigger('click')
		expect(wrapper.find('[data-testid="trip-breakdown"]')
			.exists())
			.toBe(false)
		wrapper.unmount()
	})

	it('shows the percent of a percent split in the breakdown', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)
		await wrapper.find(`${widgetSelector('taxi')} [data-testid="trip-breakdown-toggle"]`)
			.trigger('click')
		expect(wrapper.findAll(`${widgetSelector('taxi')} [data-testid="trip-breakdown-line"]`)
			.map(line => line.text()))
			.toEqual(['Ana: €17.78 (40%)', 'Ben: €13.34 (30%)', 'Chloe: €13.34 (30%)'])
		wrapper.unmount()
	})

	it('evaluates a person\'s ledger only while it is open', async () => {
		const { runtime } = createTripRuntime()
		const reader = createRuntimeReader(runtime)
		const wrapper = await mountTrip(runtime)
		expect(reader.readProperty('ben', 'ledger'))
			.toEqual({ status: 'never-evaluated' })

		const toggle = wrapper.find(`${widgetSelector('ben')} [data-testid="trip-ledger-toggle"]`)
		await toggle.trigger('click')
		expect(reader.readProperty('ben', 'ledger')?.status)
			.toBe('completed')
		const ledger = wrapper.find(`${widgetSelector('ben')} [data-testid="trip-ledger"]`)
		expect(ledger.text())
			.toContain('Seafood dinner')
		expect(ledger.text())
			.toContain('paid €96.50')
		expect(ledger.text())
			.toContain('share €32.17')
		expect(reader.readProperty('chloe', 'ledger'))
			.toEqual({ status: 'never-evaluated' })
		await toggle.trigger('click')
		expect(wrapper.find('[data-testid="trip-ledger"]')
			.exists())
			.toBe(false)
		wrapper.unmount()
	})
})

describe('resetState', () => {
	it('"Reset this expense" puts that expense\'s State back to the authored values, and nothing else', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)
		const hotel = widgetOfType(runtime, 'hotel', 'Expense')

		await typeAmount(wrapper, 'hotel', '999')
		await typeAmount(wrapper, 'dinner', '1')
		await wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-paid-by"]`)
			.setValue('dev')
		await wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-share-ben"]`)
			.setValue(false)

		await wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-reset-expense"]`)
			.trigger('click')
		await flushPromises()

		expect(hotel.state.amount.get())
			.toBe(420)
		expect(hotel.state.paidBy.get())
			.toBe('ana')
		expect(hotel.state.among.get())
			.toEqual(['ana', 'ben', 'chloe', 'dev'])
		expect((wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-amount"]`).element as HTMLInputElement).value)
			.toBe('420')
		expect(widgetOfType(runtime, 'dinner', 'Expense').state.amount.get())
			.toBe(1)
		wrapper.unmount()
	})

	it('"Start over" resets every widget but keeps the interface language', async () => {
		const { runtime } = createTripRuntime()
		const wrapper = await mountTrip(runtime)
		await typeAmount(wrapper, 'hotel', '999')
		await wrapper.find('[data-testid="trip-round-step"]')
			.setValue('500')
		await wrapper.find('[data-testid="trip-language"]')
			.setValue('zh-TW')
		await flushPromises()

		await wrapper.find('[data-testid="trip-start-over"]')
			.trigger('click')
		await flushPromises()

		expect(widgetOfType(runtime, 'hotel', 'Expense').state.amount.get())
			.toBe(420)
		expect(widgetOfType(runtime, 'currency', 'Currency').state.roundStep.get())
			.toBe(1)
		expect(widgetOfType(runtime, 'lisbon', 'Trip').state.language.get())
			.toBe('zh-TW')
		expect(wrapper.find('h1')
			.text())
			.toBe('里斯本週末小旅行')
		expect(wrapper.find('[data-testid="trip-total"]')
			.text())
			.toBe('€651.74')
		wrapper.unmount()
	})

	it('follows a replaced Runtime: the host acts on the one it was given last', async () => {
		const first = createTripRuntime().runtime
		const second = createTripRuntime().runtime
		const wrapper = await mountTrip(first)
		await wrapper.setProps({ runtime: second })
		await flushPromises()
		widgetOfType(second, 'hotel', 'Expense').state.amount.set(1)
		widgetOfType(first, 'hotel', 'Expense').state.amount.set(2)
		await wrapper.find(`${widgetSelector('hotel')} [data-testid="trip-reset-expense"]`)
			.trigger('click')
		expect(widgetOfType(second, 'hotel', 'Expense').state.amount.get())
			.toBe(420)
		expect(widgetOfType(first, 'hotel', 'Expense').state.amount.get())
			.toBe(2)
		wrapper.unmount()
	})
})
