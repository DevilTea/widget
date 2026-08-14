/**
 * `DealStore.updateStage`/`reset` (checkpoint §2), against the real canonical preset (`../presets.ts`).
 * Covers the locked `validateArgs`-vs-`execute` split (malformed tuple/invalid `DealStage` literal is
 * always `method-args`; a syntactically valid but currently-missing id is always `method-result`),
 * immutable array/record replacement, `reset()` restoring the seed snapshot, and that mutation never
 * reaches back into the plugin's own configured seed payload.
 */

import { describe, expect, it } from 'vitest'
import { seedDeals } from '../domain'
import { createCrmRuntime, widgetOfType } from '../test-support'

function setup() {
	const { runtime } = createCrmRuntime()
	const store = widgetOfType(runtime, 'deal-store', 'DealStore')
	return { runtime, store }
}

describe('dealStore.updateStage() — locked validateArgs-vs-execute failure split', () => {
	it('a non-string dealId is a method-args failure, deals unchanged', () => {
		const { store } = setup()
		const before = store.state.deals.get()
		const result = store.methods.updateStage(42 as unknown as string, 'won')
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-args')
		expect(store.state.deals.get())
			.toEqual(before)
	})

	it('an invalid DealStage literal is a method-args failure, deals unchanged', () => {
		const { store } = setup()
		const before = store.state.deals.get()
		const result = store.methods.updateStage('deal-1', 'bogus-stage' as unknown as 'won')
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-args')
		expect(store.state.deals.get())
			.toEqual(before)
	})

	it('wrong arity is a method-args failure', () => {
		const { store } = setup()
		const result = (store.methods.updateStage as (...args: readonly unknown[]) => { readonly success: boolean })('deal-1')
		expect(result.success)
			.toBe(false)
	})

	it('a syntactically valid tuple with a currently-missing deal id is a method-result failure, deals unchanged', () => {
		const { store } = setup()
		const before = store.state.deals.get()
		const result = store.methods.updateStage('no-such-deal', 'won')
		expect(result.success)
			.toBe(false)
		if (result.success)
			throw new Error('expected a failure')
		expect(result.issues[0]!.source.type)
			.toBe('method-result')
		expect(store.state.deals.get())
			.toEqual(before)
	})
})

describe('dealStore.updateStage() — success', () => {
	it('immutably replaces the deals array and returns the updated Deal', () => {
		const { store } = setup()
		const before = store.state.deals.get()!

		const result = store.methods.updateStage('deal-1', 'won')

		expect(result)
			.toEqual({ success: true, value: { id: 'deal-1', company: 'Aurora Systems', contact: 'Mia Chen', owner: 'Alex Rivera', stage: 'won', amount: 18_000 } })

		const after = store.state.deals.get()!
		expect(after)
			.not.toBe(before)
		expect(after.find(deal => deal.id === 'deal-1')?.stage)
			.toBe('won')
		// Every other deal is untouched.
		expect(after.filter(deal => deal.id !== 'deal-1'))
			.toEqual(before.filter(deal => deal.id !== 'deal-1'))
	})
})

describe('dealStore.reset()', () => {
	it('restores the configured seed snapshot after a mutation', () => {
		const { store } = setup()
		store.methods.updateStage('deal-1', 'won')
		expect(store.state.deals.get()!.find(deal => deal.id === 'deal-1')?.stage)
			.toBe('won')

		const result = store.methods.reset()
		expect(result.success)
			.toBe(true)
		expect(store.state.deals.get())
			.toEqual(seedDeals)
	})
})

describe('dealStore — seed config is never mutated in place', () => {
	it('mutating the store never changes the module-level seedDeals fixture', () => {
		const { store } = setup()
		store.methods.updateStage('deal-1', 'won')
		expect(seedDeals.find(deal => deal.id === 'deal-1')?.stage)
			.toBe('lead')
	})
})
