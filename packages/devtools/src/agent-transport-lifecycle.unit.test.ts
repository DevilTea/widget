import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createDevtoolsTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

describe('inspector Agent transport lifecycle', () => {
	it('releases two Runtime bindings from a host-owned shared transport one subscription at a time', async () => {
		const pair = createInProcessInspectorTransportPair()
		const activeSubscriptions = new Set<(message: unknown) => void>()
		const subscribe = pair.agent.subscribe
		pair.agent.subscribe = (listener) => {
			activeSubscriptions.add(listener)
			const unsubscribe = subscribe(listener)
			let active = true
			return () => {
				if (!active)
					return
				active = false
				activeSubscriptions.delete(listener)
				unsubscribe()
			}
		}
		const client = createInspectorClient(pair.client)
		const firstFixture = createDevtoolsTestFixture()
		const first = createInspectorAgent({
			runtime: firstFixture.runtime,
			transport: pair.agent,
			closeTransportOnDispose: false,
		})

		const secondFixture = createDevtoolsTestFixture()
		const second = createInspectorAgent({
			runtime: secondFixture.runtime,
			transport: pair.agent,
			closeTransportOnDispose: false,
		})
		try {
			expect(activeSubscriptions.size)
				.toBe(2)
			first.dispose()
			expect(activeSubscriptions.size)
				.toBe(1)
			expect(pair.agent.closed)
				.toBe(false)
			const runtimes = await client.request('runtime.list', {})
			expect(runtimes.runtimes)
				.toHaveLength(1)
			expect(runtimes.runtimes[0])
				.toMatchObject({ runtimeId: second.runtimeId })
			second.dispose()
			expect(activeSubscriptions.size)
				.toBe(0)
		}
		finally {
			client.dispose()
			first.dispose()
			second.dispose()
			pair.agent.close()
			firstFixture.runtime.dispose()
			secondFixture.runtime.dispose()
		}
	})
})
