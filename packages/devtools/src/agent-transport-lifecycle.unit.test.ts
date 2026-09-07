import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createDevtoolsTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

describe('inspector Agent transport lifecycle', () => {
	it('can release one Runtime binding without closing a host-owned shared transport', () => {
		const pair = createInProcessInspectorTransportPair()
		const firstFixture = createDevtoolsTestFixture()
		const first = createInspectorAgent({
			runtime: firstFixture.runtime,
			transport: pair.agent,
			closeTransportOnDispose: false,
		})
		first.dispose()
		expect(pair.agent.closed)
			.toBe(false)

		const secondFixture = createDevtoolsTestFixture()
		const second = createInspectorAgent({
			runtime: secondFixture.runtime,
			transport: pair.agent,
			closeTransportOnDispose: false,
		})
		expect(second.runtimeId).not.toBe(first.runtimeId)

		second.dispose()
		pair.agent.close()
		firstFixture.runtime.dispose()
		secondFixture.runtime.dispose()
	})
})
