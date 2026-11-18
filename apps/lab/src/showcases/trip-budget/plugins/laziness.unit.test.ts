/**
 * Laziness and subscriptions, observed through the same passive surface the Lab's Runtime panel uses
 * (`createRuntimeReader`: `getSnapshot()` only, which never evaluates anything).
 *
 * Properties are lazy: Core runs one only when something reads it (`get()`) or subscribes to it. `breakdown`
 * (of an Expense) and `ledger` (of a Person) are read only when a viewer opens them, so a fresh Runtime, and
 * a Runtime whose settlement was read, has never evaluated them.
 *
 * What the Lab can observe is only `never-evaluated` versus `completed` with the latest result. Who is
 * subscribed is not observable through inspection (there is no subscription count), so these tests state what
 * is visible, not more.
 */

import { describe, expect, it } from 'vitest'
import { createRuntimeReader } from '../../../tutorial/inspection-reader'
import { createTripRuntime, valueOf, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createTripRuntime()
	return {
		runtime,
		reader: createRuntimeReader(runtime),
		hotel: widgetOfType(runtime, 'hotel', 'Expense'),
		ben: widgetOfType(runtime, 'ben', 'Person'),
		settlement: widgetOfType(runtime, 'settlement', 'Settlement'),
	}
}

describe('a fresh Runtime has evaluated nothing', () => {
	it('reports every Property as never evaluated', () => {
		const { runtime, reader } = setup()
		for (const id of ['hotel', 'dinner', 'museum', 'taxi', 'market']) {
			for (const name of ['amountBase', 'shares', 'breakdown', 'errors']) {
				expect(reader.readProperty(id, name), `${id}.${name}`)
					.toEqual({ status: 'never-evaluated' })
			}
		}
		expect(reader.readProperty('ben', 'ledger'))
			.toEqual({ status: 'never-evaluated' })
		expect(reader.readProperty('settlement', 'transfers'))
			.toEqual({ status: 'never-evaluated' })
		expect(runtime.isDisposed)
			.toBe(false)
	})
})

describe('reading the settlement evaluates the chain it depends on and nothing else', () => {
	it('leaves breakdown and ledger never evaluated', () => {
		const { reader, settlement } = setup()
		settlement.properties.transfers.get()

		for (const name of ['amountBase', 'shares', 'counted']) {
			expect(reader.readProperty('hotel', name)?.status, name)
				.toBe('completed')
		}
		expect(reader.readProperty('ben', 'balance')?.status)
			.toBe('completed')
		// Nothing in the settlement's chain reads these, so Core never ran them.
		expect(reader.readProperty('hotel', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })
		expect(reader.readProperty('museum', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })
		expect(reader.readProperty('ben', 'ledger'))
			.toEqual({ status: 'never-evaluated' })
		// ... nor `errors`, which only the expense's own card shows.
		expect(reader.readProperty('hotel', 'errors'))
			.toEqual({ status: 'never-evaluated' })
	})

	it('does not run breakdown when an input changes while nothing reads it', () => {
		const { reader, hotel, settlement } = setup()
		settlement.properties.transfers.get()
		hotel.state.amount.set(520)
		settlement.properties.transfers.get()
		expect(reader.readProperty('hotel', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })
	})
})

describe('reading or subscribing is what evaluates', () => {
	it('evaluates breakdown on get, with the current inputs', () => {
		const { reader, hotel } = setup()
		hotel.state.amount.set(520)
		const breakdown = valueOf(hotel.properties.breakdown.get())
		expect(breakdown.totalCents)
			.toBe(52000)
		expect(reader.readProperty('hotel', 'breakdown'))
			.toMatchObject({ status: 'completed', result: { ok: true } })
	})

	it('evaluates on subscribe without calling the listener, then keeps the value current while subscribed', () => {
		const { reader, hotel } = setup()
		const totals: number[] = []
		expect(reader.readProperty('hotel', 'breakdown'))
			.toEqual({ status: 'never-evaluated' })

		const stop = hotel.properties.breakdown.subscribe((result) => {
			if (result.ok)
				totals.push(result.value.totalCents)
		})
		expect(reader.readProperty('hotel', 'breakdown')?.status)
			.toBe('completed')
		expect(totals)
			.toEqual([])

		hotel.state.amount.set(520)
		expect(totals)
			.toEqual([52000])
		expect(reader.readProperty('hotel', 'breakdown'))
			.toMatchObject({ status: 'completed', result: { ok: true, value: { totalCents: 52000 } } })
		stop()
	})

	it('after the subscription ends, keeps the last result and runs nothing until something reads again', () => {
		const { reader, hotel } = setup()
		const stop = hotel.properties.breakdown.subscribe(() => {})
		hotel.state.amount.set(520)
		stop()

		hotel.state.amount.set(600)
		// Nobody is reading: the Lab still shows the latest result a consumer produced, which is the old one.
		expect(reader.readProperty('hotel', 'breakdown'))
			.toMatchObject({ status: 'completed', result: { ok: true, value: { totalCents: 52000 } } })

		// The next read runs it again with the current State.
		expect(valueOf(hotel.properties.breakdown.get()).totalCents)
			.toBe(60000)
		expect(reader.readProperty('hotel', 'breakdown'))
			.toMatchObject({ status: 'completed', result: { ok: true, value: { totalCents: 60000 } } })
	})

	it('evaluates a person\'s ledger only when it is read', () => {
		const { reader, ben } = setup()
		expect(reader.readProperty('ben', 'ledger'))
			.toEqual({ status: 'never-evaluated' })
		ben.properties.ledger.get()
		expect(reader.readProperty('ben', 'ledger')?.status)
			.toBe('completed')
		expect(reader.readProperty('chloe', 'ledger'))
			.toEqual({ status: 'never-evaluated' })
	})
})
