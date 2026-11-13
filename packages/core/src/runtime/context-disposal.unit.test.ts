/**
 * Runtime context disposal bookkeeping: every owned subscription is torn down exactly once, in
 * registration order, whether it was released by its own handle first or by `dispose()`, and a handle
 * called afterwards (by user code or from a disposal listener) is a harmless no-op.
 */

import { describe, expect, it } from 'vitest'
import { createRuntimeContext } from './context'

describe('runtime context disposal', () => {
	it('tears down every still-owned subscription once, in registration order', () => {
		const context = createRuntimeContext()
		const log: string[] = []
		const handles = ['a', 'b', 'c', 'd'].map(name => context.registerSubscription(() => log.push(name)))

		handles[1]!()
		expect(log)
			.toEqual(['b'])

		context.dispose()
		expect(log)
			.toEqual(['b', 'a', 'c', 'd'])

		context.dispose()
		for (const handle of handles)
			handle()
		expect(log)
			.toEqual(['b', 'a', 'c', 'd'])
	})

	it('lets a disposal listener call the handles, delivering listeners after the teardown', () => {
		const context = createRuntimeContext()
		const log: string[] = []
		const handle = context.registerSubscription(() => log.push('torn down'))
		context.subscribeDisposal(() => {
			log.push('listener')
			handle()
			handle()
		})
		context.subscribeDisposal(() => log.push('second listener'))

		context.dispose()

		expect(log)
			.toEqual(['torn down', 'listener', 'second listener'])
	})

	it('does not tear down a subscription its own handle released before dispose a second time', () => {
		const context = createRuntimeContext()
		let teardowns = 0
		const handle = context.registerSubscription(() => ++teardowns)

		handle()
		handle()
		context.dispose()
		handle()

		expect(teardowns)
			.toBe(1)
	})
})
