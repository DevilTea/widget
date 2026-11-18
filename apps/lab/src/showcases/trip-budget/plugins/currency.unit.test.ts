/**
 * The Currency widget's two read-only Methods and the Properties that call them.
 *
 * "Read-only" is a fact Core derives from the declarations (a Method that neither writes State nor emits an
 * Event, itself or through the Methods it invokes), and it is the only kind of Method a Property may depend on.
 */

import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { createTripRuntime, valueOf, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createTripRuntime()
	return {
		runtime,
		currency: widgetOfType(runtime, 'currency', 'Currency'),
		museum: widgetOfType(runtime, 'museum', 'Expense'),
		settlement: widgetOfType(runtime, 'settlement', 'Settlement'),
	}
}

describe('currency.convert', () => {
	it('converts into minor units of the base currency', () => {
		const { currency } = setup()
		expect(valueOf(currency.methods.convert(64, 'USD')))
			.toBe(5888)
		expect(valueOf(currency.methods.convert(38, 'GBP')))
			.toBe(4446)
		expect(valueOf(currency.methods.convert(12.5, 'EUR')))
			.toBe(1250)
		expect(valueOf(currency.methods.convert(0, 'USD')))
			.toBe(0)
	})

	it('fails with a located Method diagnostic for a currency that has no rate', () => {
		const { currency } = setup()
		const result = currency.methods.convert(10, 'CHF')
		expect(result.ok)
			.toBe(false)
		const diagnostics = currency.methods.convert.getDiagnostics()
		expect(diagnostics.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-method-result'])
		expect(JSON.stringify(diagnostics))
			.toContain('unknown-currency')
		expect(JSON.stringify(diagnostics))
			.toContain('There is no rate for CHF')
	})

	it('refuses arguments that are not an amount and a code, before it runs', () => {
		const { currency } = setup()
		const call = currency.methods.convert as unknown as (...args: unknown[]) => { ok: boolean }
		expect(call('10', 'USD').ok)
			.toBe(false)
		expect(call(10).ok)
			.toBe(false)
		expect(call(Number.NaN, 'USD').ok)
			.toBe(false)
		expect(currency.methods.convert.getDiagnostics()
			.map(diagnostic => diagnostic.code))
			.toEqual(['invalid-method-arguments'])
	})
})

describe('currency.roundTransfer', () => {
	it('rounds to the current step, which is State', () => {
		const { currency } = setup()
		expect(currency.state.roundStep.get())
			.toBe(1)
		expect(valueOf(currency.methods.roundTransfer(11922)))
			.toBe(11922)
		currency.state.roundStep.set(100)
		expect(valueOf(currency.methods.roundTransfer(11922)))
			.toBe(11900)
		currency.state.roundStep.set(500)
		expect(valueOf(currency.methods.roundTransfer(11922)))
			.toBe(12000)
		expect(valueOf(currency.methods.roundTransfer(6199)))
			.toBe(6000)
	})

	it('accepts only a step the Currency offers', () => {
		const { currency } = setup()
		expect(currency.state.roundStep.set(7).ok)
			.toBe(false)
		expect(currency.state.roundStep.set(null as never).ok)
			.toBe(false)
		expect(currency.state.roundStep.get())
			.toBe(1)
	})
})

describe('both are read-only, as Core derives it', () => {
	it('reports neither Method as writing State or emitting an Event', () => {
		const { runtime } = setup()
		const node = inspectBlueprint(runtime.blueprint)
			.nodes
			.find(candidate => candidate.resolved && candidate.node.id === 'currency')
		if (node === undefined || !node.resolved)
			throw new Error('No Currency node')
		expect(node.methods.map(method => [method.name, method.transitivelyWrites, method.transitivelyEmits]))
			.toEqual([['convert', false, false], ['roundTransfer', false, false]])
		expect(node.events)
			.toEqual([])
	})

	it('is what lets a Property depend on them: Core rejects a Property that depends on a Method that writes State', () => {
		const writer = createWidgetPlugin('writer')
			.description('A widget whose Method writes State and whose Property tries to depend on it.')
			.interfaces<{ state: { n: number }, properties: { bad: number }, methods: { bump: () => void } }>()
			.state(state => state.n({ validate: (input): input is number => typeof input === 'number', default: () => 0 }))
			.properties(properties => properties.bad({
				registerDeps: ({ dep }) => ({ bump: dep.self.methods.invoke('bump') }),
				compute: () => 0,
			}))
			.methods(methods => methods.bump({
				validateArgs: (args): args is [] => args.length === 0,
				registerDeps: ({ dep }) => ({ setN: dep.self.state.set('n') }),
				execute: ({ deps }) => {
					deps.setN(1)
				},
			}))
			.done()
		const blueprint = createWidgetSystem({ plugins: [writer] })
			.createBlueprint({ id: 'w', type: 'writer' })
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics.map(diagnostic => diagnostic.code))
			.toEqual(['property-dependency-has-side-effects'])
	})
})

describe('the Properties that call the Methods', () => {
	it('recompute when the State a Method reads changes, and say how far rounding moved the payments', () => {
		const { currency, settlement } = setup()
		expect(valueOf(settlement.properties.transfers.get()))
			.toMatchObject({ roundingGapCents: 0 })

		currency.state.roundStep.set(100)
		const rounded = valueOf(settlement.properties.transfers.get())
		expect(rounded.transfers.map(transfer => [transfer.exactCents, transfer.cents]))
			.toEqual([[11922, 11900], [6199, 6200], [5623, 5600]])
		expect(rounded.roundingGapCents)
			.toBe(44)

		currency.state.roundStep.set(500)
		expect(valueOf(settlement.properties.transfers.get()).transfers.map(transfer => transfer.cents))
			.toEqual([12000, 6000, 5500])
	})

	it('drops a payment that rounds to nothing', () => {
		const { runtime, currency, settlement } = setup()
		for (const id of ['hotel', 'dinner', 'museum', 'taxi', 'market'])
			widgetOfType(runtime, id, 'Expense').state.amount.set(0)
		widgetOfType(runtime, 'market', 'Expense').state.amount.set(0.04)
		currency.state.roundStep.set(500)
		expect(valueOf(settlement.properties.transfers.get()))
			.toMatchObject({ transfers: [] })
	})

	it('fails with the Method, all the way down the chain, when the currency has no rate; the rest of the trip is unaffected', () => {
		const { runtime, museum, settlement } = setup()
		museum.state.currency.set('CHF')
		expect(museum.properties.amountBase.get().ok)
			.toBe(false)
		expect(museum.properties.shares.get().ok)
			.toBe(false)
		// `paid` reads every expense's `amountBase`, so one expense that cannot be converted fails it for everyone.
		expect(widgetOfType(runtime, 'ana', 'Person').properties.paid.get().ok)
			.toBe(false)
		expect(widgetOfType(runtime, 'ana', 'Person').properties.owed.get().ok)
			.toBe(false)
		expect(widgetOfType(runtime, 'ana', 'Person').properties.balance.get().ok)
			.toBe(false)
		expect(settlement.properties.balances.get().ok)
			.toBe(false)
		expect(settlement.properties.transfers.get().ok)
			.toBe(false)
		expect(settlement.properties.total.get().ok)
			.toBe(false)
		expect(widgetOfType(runtime, 'hotel', 'Expense').properties.amountBase.get().ok)
			.toBe(true)

		// Choosing a currency the Currency knows brings the whole chain back.
		museum.state.currency.set('USD')
		expect(settlement.properties.transfers.get().ok)
			.toBe(true)
	})

	it('names the failed dependency on the consumer, not the Method\'s own diagnostic', () => {
		const { museum } = setup()
		museum.state.currency.set('CHF')
		museum.properties.amountBase.get()
		const diagnostics = museum.properties.amountBase.getDiagnostics()
		expect(diagnostics.length)
			.toBeGreaterThan(0)
		expect(diagnostics.every(diagnostic => diagnostic.code === 'dependency-target-failed' || diagnostic.code === 'dependency-value-rejected' || diagnostic.code.startsWith('dependency')))
			.toBe(true)
	})
})
