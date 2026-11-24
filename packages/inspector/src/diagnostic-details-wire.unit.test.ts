import type { WidgetChild } from '@deviltea/widget-core'
import type { InspectableValue } from './value'
import { createWidgetPlugin, createWidgetSystem, undocumented } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { projectBlueprintSnapshot } from './projection'
import { isInspectorRequestResult, parseInspectorEventMessage } from './protocol'
import { createInProcessInspectorTransportPair } from './transport'

interface TooLarge {
	readonly limit: number
	readonly received: number
}

interface GaugeInterfaces {
	config: {
		raw: { readonly limit: number } | null
		resolved: { readonly limit: number }
	}
	slots: { items: WidgetChild }
	state: { level: number }
	properties: { shown: number }
	methods: { add: (amount: number) => number }
	reasons: {
		'too-large': TooLarge
		'not-a-number': void
		'long': { readonly text: string, readonly list: readonly number[] }
	}
}

const flags = { propertyFails: false, longDetails: false }

const GaugePlugin = createWidgetPlugin('DetailsGauge')
	.description(undocumented)
	.interfaces<GaugeInterfaces>()
	.config({
		description: undocumented,
		validate: (input, ctx): input is { readonly limit: number } | null => {
			if (input === null)
				return true
			const limit = (input as { readonly limit?: unknown }).limit
			if (typeof limit !== 'number') {
				ctx.addDiagnostic({ message: 'limit must be a number', path: ['limit'], reason: 'not-a-number' })
				return false
			}
			if (limit > 100) {
				ctx.addDiagnostic({ message: 'limit is too large', path: ['limit'], reason: 'too-large', details: { limit: 100, received: limit } })
				return false
			}
			return true
		},
		resolve: raw => ({ limit: raw?.limit ?? 10 }),
	})
	.slots({ items: { description: undocumented } })
	.state(state => state.level({
		description: undocumented,
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.properties(properties => properties.shown({
		description: undocumented,
		compute: (ctx) => {
			if (flags.propertyFails) {
				ctx.addDiagnostic({
					message: 'shown is too large',
					reason: flags.longDetails ? 'long' : 'too-large',
					details: flags.longDetails
						? { text: 'x'.repeat(600), list: Array.from({ length: 60 }, (_, index) => index) }
						: { limit: ctx.config.limit, received: 999 },
				} as never)
			}
			return 0
		},
	}))
	.methods(methods => methods.add({
		description: undocumented,
		validateArgs: (args, ctx): args is [number] => {
			if (typeof args[0] !== 'number') {
				ctx.addDiagnostic({ message: 'amount must be a number', path: [0], reason: 'not-a-number' })
				return false
			}
			if (args[0] > ctx.config.limit) {
				ctx.addDiagnostic({ message: 'amount is too large', path: [0], reason: 'too-large', details: { limit: ctx.config.limit, received: args[0] } })
				return false
			}
			return true
		},
		execute: ({ args: [amount] }) => amount,
	}))
	.reasons({ 'too-large': undocumented, 'not-a-number': undocumented, 'long': undocumented })
	.done()

const system = createWidgetSystem({ plugins: [GaugePlugin] })

function encodedTooLarge(received: number): InspectableValue {
	return {
		type: 'object',
		id: 1,
		entries: [
			{ key: 'limit', value: { type: 'number', value: 100 } },
			{ key: 'received', value: { type: 'number', value: received } },
		],
		truncated: false,
	}
}

function createRuntimeFixture(valueLimits?: Parameters<typeof createInspectorAgent>[0]['valueLimits']) {
	const blueprint = system.createBlueprint({ id: 'root', type: 'DetailsGauge', config: { limit: 5 } })
	if (blueprint.status !== 'valid')
		throw new Error('Expected a valid Blueprint.')
	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null || widget.type !== 'DetailsGauge')
		throw new Error('Expected the gauge widget.')
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-details', ...(valueLimits === undefined ? {} : { valueLimits }) })
	const client = createInspectorClient(pair.client)
	async function ref() {
		const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-details' })
		return { runtimeId: 'runtime-details', nodeId: snapshot.rootNodeId }
	}
	return { widget, agent, client, ref, dispose: () => {
		client.dispose()
		agent.dispose()
	} }
}

describe('blueprint diagnostic details on the wire', () => {
	it('encodes the details of a plugin diagnostic and leaves the field out when there are none', () => {
		const tooLarge = system.createBlueprint({ id: 'root', type: 'DetailsGauge', config: { limit: 500 } })
		const projected = projectBlueprintSnapshot('runtime-details', inspectBlueprint(tooLarge), {})
		expect(projected.nodes[0]!.diagnostics)
			.toEqual([{
				code: 'invalid-widget-config',
				message: 'limit is too large',
				location: { type: 'widget', nodeId: projected.rootNodeId },
				path: ['limit'],
				reason: 'too-large',
				details: encodedTooLarge(500),
			}])

		const notANumber = system.createBlueprint({ id: 'root', type: 'DetailsGauge', config: { limit: 'ten' } })
		const plain = projectBlueprintSnapshot('runtime-details', inspectBlueprint(notANumber), {}).nodes[0]!.diagnostics[0]!
		expect(plain)
			.toMatchObject({ code: 'invalid-widget-config', reason: 'not-a-number' })
		expect(plain).not.toHaveProperty('details')

		// A diagnostic Core itself authored never carries details either.
		const unknown = system.createBlueprint({ id: 'root', type: 'Missing' })
		for (const diagnostic of projectBlueprintSnapshot('runtime-details', inspectBlueprint(unknown), {}).nodes.flatMap(node => node.diagnostics))
			expect(diagnostic).not.toHaveProperty('details')
	})

	it('encodes details within the value limits and marks the truncation', () => {
		const tooLarge = system.createBlueprint({ id: 'root', type: 'DetailsGauge', config: { limit: 500 } })
		const projected = projectBlueprintSnapshot('runtime-details', inspectBlueprint(tooLarge), { maxEntries: 1 })
		expect(projected.nodes[0]!.diagnostics[0]!.details)
			.toEqual({
				type: 'object',
				id: 1,
				entries: [{ key: 'limit', value: { type: 'number', value: 100 } }],
				truncated: true,
			})
	})

	it('validates details on the client side', () => {
		const tooLarge = system.createBlueprint({ id: 'root', type: 'DetailsGauge', config: { limit: 500 } })
		const projected = projectBlueprintSnapshot('runtime-details', inspectBlueprint(tooLarge), {})
		expect(isInspectorRequestResult('blueprint.getSnapshot', projected))
			.toBe(true)

		for (const bad of [{ type: 'bogus' }, 'plain string', { type: 'string', value: 'x' }, { type: 'number', value: Number.NaN }]) {
			const corrupted = structuredClone(projected) as unknown as { nodes: { diagnostics: Record<string, unknown>[] }[] }
			corrupted.nodes[0]!.diagnostics[0]!.details = bad
			expect(isInspectorRequestResult('blueprint.getSnapshot', corrupted), JSON.stringify(bad))
				.toBe(false)
		}
		// `details` is optional, so a diagnostic without it stays valid.
		const without = structuredClone(projected) as unknown as { nodes: { diagnostics: Record<string, unknown>[] }[] }
		delete without.nodes[0]!.diagnostics[0]!.details
		expect(isInspectorRequestResult('blueprint.getSnapshot', without))
			.toBe(true)
	})
})

describe('runtime diagnostic details on the wire', () => {
	it('carries the details of a Property failure, and encodes long values within the limits', async () => {
		const fixture = createRuntimeFixture()
		try {
			flags.propertyFails = true
			flags.longDetails = false
			expect(fixture.widget.properties.shown.get().ok)
				.toBe(false)
			const ref = await fixture.ref()
			const snapshot = await fixture.client.request('runtime.getWidgetSnapshot', { ref })
			const property = snapshot.members.find(member => member.type === 'property')
			expect(property)
				.toMatchObject({
					snapshot: {
						status: 'completed',
						result: {
							ok: false,
							diagnostics: [{
								code: 'invalid-property-result',
								reason: 'too-large',
								details: {
									type: 'object',
									entries: [
										{ key: 'limit', value: { type: 'number', value: 5 } },
										{ key: 'received', value: { type: 'number', value: 999 } },
									],
									truncated: false,
								},
							}],
						},
					},
				})
			expect(JSON.parse(JSON.stringify(snapshot)))
				.toEqual(snapshot)
		}
		finally {
			flags.propertyFails = false
			fixture.dispose()
		}
	})

	it('truncates oversized details like any other value and marks it', async () => {
		const fixture = createRuntimeFixture({ maxStringLength: 20, maxEntries: 5 })
		try {
			flags.propertyFails = true
			flags.longDetails = true
			fixture.widget.properties.shown.get()
			const ref = await fixture.ref()
			const snapshot = await fixture.client.request('runtime.getWidgetSnapshot', { ref })
			const property = snapshot.members.find(member => member.type === 'property')
			if (property?.type !== 'property' || property.snapshot.status !== 'completed' || property.snapshot.result.ok)
				throw new Error('Expected a failed Property.')
			const details = property.snapshot.result.diagnostics[0]!.details
			if (details?.type !== 'object')
				throw new Error('Expected object details.')
			const text = details.entries.find(entry => entry.key === 'text')!.value
			expect(text)
				.toEqual({ type: 'string', value: 'x'.repeat(20), truncated: true })
			const list = details.entries.find(entry => entry.key === 'list')!.value
			if (list.type !== 'array')
				throw new Error('Expected an array.')
			expect(list.items)
				.toHaveLength(5)
			expect(list.truncated)
				.toBe(true)
		}
		finally {
			flags.propertyFails = false
			flags.longDetails = false
			fixture.dispose()
		}
	})

	it('carries the details of a Method diagnostic in the snapshot, the subscribe answer and memberChanged', async () => {
		const fixture = createRuntimeFixture()
		try {
			const ref = await fixture.ref()
			const changes: unknown[] = []
			fixture.client.on('runtime.memberChanged', payload => changes.push(payload.member))
			const subscribed = await fixture.client.request('runtime.subscribeMember', { ref, member: { type: 'method', name: 'add' } })
			expect(subscribed.member)
				.toEqual({ type: 'method', name: 'add', diagnostics: [] })

			fixture.widget.methods.add(50)
			const expected = {
				type: 'method',
				name: 'add',
				diagnostics: [{
					code: 'invalid-method-arguments',
					message: 'amount is too large',
					location: { type: 'method', widgetId: 'root', name: 'add' },
					path: [0],
					reason: 'too-large',
					details: {
						type: 'object',
						id: 1,
						entries: [
							{ key: 'limit', value: { type: 'number', value: 5 } },
							{ key: 'received', value: { type: 'number', value: 50 } },
						],
						truncated: false,
					},
					args: [{ type: 'number', value: 50 }],
				}],
			}
			expect(changes)
				.toEqual([expected])
			const snapshot = await fixture.client.request('runtime.getWidgetSnapshot', { ref })
			expect(snapshot.members.find(member => member.type === 'method'))
				.toEqual(expected)

			// A diagnostic without details carries no `details` key, and the event validates either way.
			fixture.widget.methods.add('nope' as never)
			const plain = (changes.at(-1) as { diagnostics: Record<string, unknown>[] }).diagnostics[0]!
			expect(plain)
				.toMatchObject({ reason: 'not-a-number' })
			expect(plain).not.toHaveProperty('details')
			expect(parseInspectorEventMessage({
				protocol: { major: 1, minor: 0 },
				kind: 'event',
				event: 'runtime.memberChanged',
				payload: { subscriptionId: subscribed.subscriptionId, ref, member: expected },
			}))
				.not
				.toBeNull()
			expect(parseInspectorEventMessage({
				protocol: { major: 1, minor: 0 },
				kind: 'event',
				event: 'runtime.memberChanged',
				payload: { subscriptionId: 's', ref, member: { ...expected, diagnostics: [{ ...expected.diagnostics[0], details: { type: 'bogus' } }] } },
			}))
				.toBeNull()
		}
		finally {
			fixture.dispose()
		}
	})
})
