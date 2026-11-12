// @vitest-environment node
import type { InspectableValue } from './value'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { createInProcessInspectorTransportPair } from './transport'
import { isInspectableValue } from './validation'
import { DEFAULT_INSPECTABLE_VALUE_LIMITS, encodeInspectableValue } from './value'

afterEach(() => {
	vi.restoreAllMocks()
})

function countNodes(value: InspectableValue): number {
	switch (value.type) {
		case 'array':
			return 1 + value.items.reduce((sum, item) => sum + countNodes(item), 0)
		case 'object':
			return 1 + value.entries.reduce((sum, entry) => sum + countNodes(entry.value), 0)
		default:
			return 1
	}
}

function wide(width: number, depth: number): unknown {
	if (depth === 0)
		return 'leaf'
	const result: Record<string, unknown> = {}
	for (let index = 0; index < width; index++) {
		result[`k${String(index)
			.padStart(3, '0')}`] = wide(width, depth - 1)
	}
	return result
}

describe('encodeInspectableValue total budget', () => {
	it('keeps a wide, deep value within the default total node budget', () => {
		const encoded = encodeInspectableValue(wide(50, 3))
		expect(countNodes(encoded))
			.toBeLessThanOrEqual(DEFAULT_INSPECTABLE_VALUE_LIMITS.maxNodes)
		// 50 x 50 x 50 leaves used to encode to ~70 MB; the budget keeps the document small.
		expect(JSON.stringify(encoded).length)
			.toBeLessThan(200_000)
		expect(encoded)
			.toMatchObject({ type: 'object', truncated: true })
	})

	it('reports truncation explicitly on every container the budget cut short', () => {
		const encoded = encodeInspectableValue({ a: [1, 2, 3], b: [4, 5, 6], c: [7, 8, 9] }, { maxNodes: 6 })
		expect(countNodes(encoded))
			.toBeLessThanOrEqual(6)
		if (encoded.type !== 'object')
			throw new Error('Expected object encoding.')
		expect(encoded.truncated)
			.toBe(true)
		expect(encoded.entries.map(entry => entry.key))
			.toEqual(['a', 'b'])
		expect(encoded.entries[1]!.value)
			.toMatchObject({ type: 'array', truncated: true })
	})

	it('does not truncate anything that fits the budget', () => {
		const encoded = encodeInspectableValue({ a: [1, 2], b: 'x' })
		expect(countNodes(encoded))
			.toBe(5)
		expect(JSON.stringify(encoded)).not.toContain('"truncated":true')
	})

	it('always emits the root, even with the smallest budget', () => {
		expect(encodeInspectableValue({ a: 1 }, { maxNodes: 1 }))
			.toMatchObject({ type: 'object', entries: [], truncated: true })
		expect(encodeInspectableValue([1, 2], { maxNodes: 1 }))
			.toMatchObject({ type: 'array', items: [], truncated: true })
	})
})

describe('encodeInspectableValue key truncation', () => {
	it('truncates keys with the string limit and marks the entry', () => {
		const longKey = 'k'.repeat(600)
		const encoded = encodeInspectableValue({ [longKey]: 1, short: 2 })
		if (encoded.type !== 'object')
			throw new Error('Expected object encoding.')
		const byValue = Object.fromEntries(encoded.entries.map(entry => [entry.value.type === 'number' ? entry.value.value : -1, entry]))
		expect(byValue[1]!.key)
			.toBe('k'.repeat(500))
		expect(byValue[1]!.keyTruncated)
			.toBe(true)
		// An untruncated key carries no marker at all.
		expect(byValue[2]).not.toHaveProperty('keyTruncated')
	})

	it('emits keys in full, unmarked, when the marker is off, so distinct long keys never collide', () => {
		const encoded = encodeInspectableValue({ abcdef: 1, abcxyz: 2 }, { maxStringLength: 3, markTruncatedKeys: false })
		if (encoded.type !== 'object')
			throw new Error('Expected object encoding.')
		expect(encoded.entries.map(entry => entry.key))
			.toEqual(['abcdef', 'abcxyz'])
		for (const entry of encoded.entries)
			expect(entry).not.toHaveProperty('keyTruncated')
	})

	it('validates the optional marker on the wire', () => {
		const entry = (keyTruncated: unknown) => ({
			type: 'object',
			id: 1,
			truncated: false,
			entries: [{ key: 'a', keyTruncated, value: { type: 'null' } }],
		})
		expect(isInspectableValue(entry(true)))
			.toBe(true)
		expect(isInspectableValue(entry(undefined)))
			.toBe(true)
		expect(isInspectableValue(entry('yes')))
			.toBe(false)
	})
})

describe('encodeInspectableValue bounded work', () => {
	it('never fetches descriptors for, nor sorts, more keys than it emits', () => {
		const huge: Record<string, number> = {}
		for (let index = 0; index < 200_000; index++)
			huge[`key-${index}`] = index
		const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors')
		const descriptor = vi.spyOn(Object, 'getOwnPropertyDescriptor')
		const sortedLengths: number[] = []
		const originalSort = Array.prototype.sort
		vi.spyOn(Array.prototype, 'sort')
			.mockImplementation(function (this: unknown[], compare) {
				sortedLengths.push(this.length)
				return originalSort.call(this, compare)
			})

		const encoded = encodeInspectableValue(huge)
		const sortedDuringEncode = Math.max(0, ...sortedLengths)
		const descriptorCalls = descriptor.mock.calls.filter(([target]) => target === huge).length
		const bulkDescriptorCalls = descriptors.mock.calls.filter(([target]) => target === huge).length
		if (encoded.type !== 'object')
			throw new Error('Expected object encoding.')
		expect(encoded.entries)
			.toHaveLength(50)
		expect(encoded.truncated)
			.toBe(true)
		// The 50 emitted entries are the 50 smallest keys, in sorted order, as before.
		expect(encoded.entries.map(entry => entry.key))
			.toEqual(Object.keys(huge)
				.sort()
				.slice(0, 50))
		expect(bulkDescriptorCalls)
			.toBe(0)
		expect(descriptorCalls)
			.toBeLessThanOrEqual(50)
		expect(sortedDuringEncode)
			.toBeLessThanOrEqual(50)
	})
})

describe('inspectorAgent valueLimits', () => {
	interface BlobInterfaces {
		state: { blob: Record<string, unknown> }
	}

	function createFixture(options: { readonly valueLimits?: Parameters<typeof createInspectorAgent>[0]['valueLimits'] } = {}) {
		const big: Record<string, unknown> = {}
		for (let index = 0; index < 100; index++) {
			big[`k${String(index)
				.padStart(3, '0')}`] = index
		}
		big['x'.repeat(600)] = 'long-key'
		const plugin = createWidgetPlugin('BlobFixture')
			.description('Blob fixture')
			.interfaces<BlobInterfaces>()
			.state(state => state.blob({ validate: (input): input is Record<string, unknown> => typeof input === 'object', default: () => big }))
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'BlobFixture' })
		if (blueprint.status !== 'valid')
			throw new Error('fixture must compile')
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime: blueprint.createRuntime(), transport: pair.agent, runtimeId: 'runtime-x', ...options })
		const client = createInspectorClient(pair.client)
		return { agent, client }
	}

	async function blobValue(client: ReturnType<typeof createFixture>['client']) {
		const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-x' })
		const member = await client.request('runtime.getWidgetSnapshot', { ref: { runtimeId: 'runtime-x', nodeId: snapshot.rootNodeId } })
		const blob = member.members[0]!
		if (blob.type !== 'state' || blob.value.type !== 'object')
			throw new Error('Expected an object State.')
		return blob.value
	}

	it('applies the default limits and the documented overrides to Runtime values on the wire', async () => {
		const defaults = createFixture()
		try {
			expect((await blobValue(defaults.client)).entries)
				.toHaveLength(50)
		}
		finally {
			defaults.client.dispose()
			defaults.agent.dispose()
		}

		const small = createFixture({ valueLimits: { maxEntries: 3, maxNodes: 100 } })
		try {
			const value = await blobValue(small.client)
			expect(value.entries.map(entry => entry.key))
				.toEqual(['k000', 'k001', 'k002'])
			expect(value.truncated)
				.toBe(true)
		}
		finally {
			small.client.dispose()
			small.agent.dispose()
		}
	})

	it('cuts and marks long keys only for peers negotiated at 0.4 or newer; older peers see them in full', async () => {
		const { agent, client } = createFixture({ valueLimits: { maxEntries: 200 } })
		try {
			await client.request('handshake', { protocol: { major: 0, minor: 3 } })
			const previous = await blobValue(client)
			const previousLong = previous.entries.find(entry => entry.key.length === 600)!
			expect(previousLong.key)
				.toBe('x'.repeat(600))
			expect(previousLong).not.toHaveProperty('keyTruncated')
			expect(previous.entries.some(entry => entry.key.length === 500))
				.toBe(false)

			await client.request('handshake', { protocol: { major: 0, minor: 4 } })
			const current = await blobValue(client)
			expect(current.entries.find(entry => entry.key.length === 500))
				.toMatchObject({ keyTruncated: true })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it.each([
		{ maxDepth: -1 },
		{ maxDepth: 1.5 },
		{ maxEntries: 0 },
		{ maxStringLength: 0 },
		{ maxNodes: 0 },
		{ maxNodes: Number.NaN },
		{ maxNodes: Number.POSITIVE_INFINITY },
	])('rejects the invalid limit %j instead of silently ignoring it', (valueLimits) => {
		expect(() => createFixture({ valueLimits }))
			.toThrow(RangeError)
	})
})
