/**
 * The Agent hands its configured `valueLimits` to the Blueprint projection.
 *
 * A Blueprint snapshot of a Runtime holds no diagnostic (a Runtime exists only for a valid Blueprint), and a
 * diagnostic's `details` is the one Blueprint value the limits cut, so no request the Agent can answer shows
 * the limits at work there. `diagnostic-details-wire.unit.test.ts` pins the cut itself through
 * `projectBlueprintSnapshot`; this file pins the wiring with a spy on that function, which keeps its real
 * implementation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import * as projection from './projection'
import { createInspectorTestFixture } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

vi.mock('./projection', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./projection')>()
	return { ...actual, projectBlueprintSnapshot: vi.fn(actual.projectBlueprintSnapshot) }
})

const spy = vi.mocked(projection.projectBlueprintSnapshot)

async function snapshotWith(valueLimits?: Parameters<typeof createInspectorAgent>[0]['valueLimits']) {
	const fixture = createInspectorTestFixture()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-limits', ...(valueLimits === undefined ? {} : { valueLimits }) })
	const client = createInspectorClient(pair.client)
	try {
		await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-limits' })
	}
	finally {
		client.dispose()
		agent.dispose()
	}
}

describe('agent value limits reach the Blueprint projection', () => {
	afterEach(() => {
		spy.mockClear()
	})

	it('passes the configured valueLimits as the projection\'s encoding options', async () => {
		await snapshotWith({ maxEntries: 2, maxDepth: 3, maxStringLength: 40, maxNodes: 50 })
		expect(spy)
			.toHaveBeenCalledTimes(1)
		expect(spy.mock.calls[0]![0])
			.toBe('runtime-limits')
		expect(spy.mock.calls[0]![2])
			.toEqual({ maxEntries: 2, maxDepth: 3, maxStringLength: 40, maxNodes: 50 })
	})

	it('passes no limits when none are configured', async () => {
		await snapshotWith()
		expect(spy)
			.toHaveBeenCalledTimes(1)
		expect(spy.mock.calls[0]![2])
			.toEqual({})
	})
})
