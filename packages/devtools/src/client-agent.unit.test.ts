import type { WidgetInterfaces } from '@deviltea/widget-core'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint, inspectRuntime } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { createInspectorAgent } from './agent'
import { createInspectorClient } from './client'
import { projectBlueprintSnapshot } from './projection'
import { createDevtoolsTestFixture, devtoolsTestSystem } from './test-fixture'
import { createInProcessInspectorTransportPair } from './transport'

function containsFunction(value: unknown, seen = new WeakSet<object>()): boolean {
	if (typeof value === 'function')
		return true
	if (typeof value !== 'object' || value === null)
		return false
	if (seen.has(value))
		return false
	seen.add(value)
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (descriptor !== undefined && 'value' in descriptor && containsFunction(descriptor.value, seen))
			return true
	}
	return false
}

function createConnectedFixture() {
	const fixture = createDevtoolsTestFixture()
	const pair = createInProcessInspectorTransportPair()
	const agent = createInspectorAgent({ runtime: fixture.runtime, transport: pair.agent, runtimeId: 'runtime-test' })
	const client = createInspectorClient(pair.client)
	return { ...fixture, agent, client }
}

describe('inspectorClient + InspectorAgent', () => {
	it('handshakes, correlates requests, and exposes only the explicit read-only capability vocabulary', async () => {
		const { agent, client } = createConnectedFixture()
		try {
			const handshake = await client.request('handshake', { protocol: { major: 0, minor: 1 } })
			expect(handshake.protocol)
				.toEqual({ major: 0, minor: 1 })
			expect(handshake.capabilities.methods)
				.toContain('runtime.getWidgetSnapshot')
			expect(handshake.capabilities.methods).not.toContain('method.invoke')
			expect(handshake.capabilities.methods).not.toContain('state.set')

			const [runtimes, snapshot] = await Promise.all([
				client.request('runtime.list', {}),
				client.request('blueprint.getSnapshot', { runtimeId: 'runtime-test' }),
			])
			expect(runtimes.runtimes)
				.toEqual([{ runtimeId: 'runtime-test', rootNodeId: snapshot.rootNodeId }])
			expect(snapshot.runtimeId)
				.toBe('runtime-test')
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('projects Core inspection into JSON-safe DTOs without plugin objects, callables, or node-object identity', async () => {
		const { blueprint, agent, client } = createConnectedFixture()
		try {
			const snapshot = await client.request('blueprint.getSnapshot', { runtimeId: 'runtime-test' })
			const coreInspection = inspectBlueprint(blueprint)
			const coreCounter = coreInspection.nodes.find(node => node.resolved && node.node.id === 'counter')
			const wireCounter = snapshot.nodes.find(node => node.widgetId === 'counter')

			expect(wireCounter)
				.toBeDefined()
			expect(wireCounter).not.toBe(coreCounter)
			expect(wireCounter).not.toHaveProperty('node')
			expect(wireCounter).not.toHaveProperty('plugin')
			expect(containsFunction(snapshot))
				.toBe(false)
			expect(JSON.parse(JSON.stringify(snapshot)))
				.toEqual(snapshot)
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('keeps a never-evaluated Property passive until a real Runtime consumer evaluates it', async () => {
		const { runtime, counter, agent, client } = createConnectedFixture()
		try {
			const core = inspectRuntime(runtime)
			const counterNode = core.blueprint.nodes.find(node => node.resolved && node.node.id === 'counter')!
			const ref = { runtimeId: 'runtime-test', nodeId: counterNode.nodeId }

			const before = await client.request('runtime.getWidgetSnapshot', { ref })
			expect(before.members.find(member => member.type === 'property' && member.name === 'doubled'))
				.toEqual({ type: 'property', name: 'doubled', snapshot: { status: 'never-evaluated' } })

			counter.properties.doubled.get()
			const after = await client.request('runtime.getWidgetSnapshot', { ref })
			expect(after.members.find(member => member.type === 'property' && member.name === 'doubled'))
				.toMatchObject({
					type: 'property',
					name: 'doubled',
					snapshot: { status: 'completed', result: { ok: true, value: { type: 'number', value: 2 } } },
				})
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('subscribes to passive member observations and stops events after unsubscribe', async () => {
		const { runtime, counter, agent, client } = createConnectedFixture()
		try {
			const counterNode = inspectRuntime(runtime).blueprint.nodes.find(node => node.resolved && node.node.id === 'counter')!
			const ref = { runtimeId: 'runtime-test', nodeId: counterNode.nodeId }
			const events: unknown[] = []
			const stopListening = client.on('runtime.memberChanged', payload => events.push(payload))
			const subscription = await client.request('runtime.subscribeMember', {
				ref,
				member: { type: 'state', name: 'count' },
			})

			counter.state.count.set(4)
			await Promise.resolve()
			expect(events)
				.toContainEqual(expect.objectContaining({
					subscriptionId: subscription.subscriptionId,
					member: { type: 'state', name: 'count', value: { type: 'number', value: 4 } },
				}))

			await client.request('runtime.unsubscribeMember', { subscriptionId: subscription.subscriptionId })
			const countBefore = events.length
			counter.state.count.set(5)
			await Promise.resolve()
			expect(events)
				.toHaveLength(countBefore)
			stopListening()
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})

	it('rejects incompatible handshakes and unknown Runtime/widget identities explicitly', async () => {
		const { agent, client } = createConnectedFixture()
		try {
			await expect(client.request('handshake', { protocol: { major: 99, minor: 0 } }))
				.rejects.toMatchObject({ protocolError: expect.objectContaining({ code: 'unsupported-version' }) })
			await expect(client.request('blueprint.getSnapshot', { runtimeId: 'missing' }))
				.rejects.toMatchObject({ protocolError: expect.objectContaining({ code: 'runtime-not-found' }) })
			await expect(client.request('runtime.getWidgetSnapshot', {
				ref: { runtimeId: 'runtime-test', nodeId: 999999 },
			}))
				.rejects.toMatchObject({ protocolError: expect.objectContaining({ code: 'widget-not-found' }) })
		}
		finally {
			client.dispose()
			agent.dispose()
		}
	})
})

describe('core inspection projection', () => {
	it('preserves nested Runtime dependency diagnostic provenance as JSON-safe wire data', async () => {
		interface DiagnosticInterfaces extends WidgetInterfaces {
			properties: {
				flaky: number
				viaFlaky: number
			}
		}
		const plugin = createWidgetPlugin('DevtoolsDiagnostic')
			.description('DevTools diagnostic fixture')
			.interfaces<DiagnosticInterfaces>()
			.properties(properties => properties
				.flaky({
					compute: ({ addDiagnostic }) => {
						addDiagnostic({ message: 'flaky failed' })
						return 7
					},
				})
				.viaFlaky({
					registerDeps: ({ dep }) => ({ flaky: dep.self.properties.get('flaky') }),
					compute: ({ deps }) => {
						const result = deps.flaky()
						return result.ok ? result.value ?? 0 : -1
					},
				}))
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'DevtoolsDiagnostic' })
		if (blueprint.status !== 'valid')
			throw new Error('Expected diagnostic Blueprint to compile.')
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('Expected diagnostic Runtime widget.')
		const result = widget.properties.viaFlaky.get()
		expect(result.ok)
			.toBe(false)

		const inspection = inspectRuntime(runtime)
		const rootNode = inspection.blueprint.nodes.find(node => node.resolved && node.node.id === 'root')
		if (rootNode === undefined)
			throw new Error('Expected diagnostic inspection node.')
		const pair = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({ runtime, transport: pair.agent, runtimeId: 'runtime-nested-diagnostic' })
		const client = createInspectorClient(pair.client)
		try {
			const snapshot = await client.request('runtime.getWidgetSnapshot', {
				ref: { runtimeId: 'runtime-nested-diagnostic', nodeId: rootNode.nodeId },
			})
			const property = snapshot.members.find(member => member.type === 'property' && member.name === 'viaFlaky')
			expect(property)
				.toMatchObject({
					type: 'property',
					snapshot: {
						status: 'completed',
						result: {
							ok: false,
							diagnostics: [{
								code: 'dependency-target-failed',
								related: [{ type: 'property', widgetId: 'root', name: 'flaky' }],
								cause: {
									code: 'invalid-property-result',
									location: { type: 'property', widgetId: 'root', name: 'flaky' },
									result: { type: 'number', value: 7 },
								},
							}],
						},
					},
				})
			expect(JSON.parse(JSON.stringify(snapshot)))
				.toEqual(snapshot)
		}
		finally {
			client.close()
			agent.dispose()
		}
	})

	it('clones Core dependency references instead of retaining inspection object identity', () => {
		const { blueprint } = createDevtoolsTestFixture()
		const inspection = inspectBlueprint(blueprint)
		const coreCounter = inspection.nodes.find(node => node.resolved && node.node.id === 'counter')
		if (coreCounter === undefined || !coreCounter.resolved)
			throw new Error('Expected resolved counter inspection node.')
		const coreDependency = coreCounter.properties.find(property => property.name === 'doubled')?.dependencies[0]
		if (coreDependency === undefined)
			throw new Error('Expected doubled dependency inspection.')

		const projected = projectBlueprintSnapshot('runtime-dependency-fixture', inspection)
		const wireCounter = projected.nodes.find(node => node.widgetId === 'counter')
		const wireDependency = wireCounter?.properties?.find(property => property.name === 'doubled')?.dependencies[0]
		if (wireDependency === undefined)
			throw new Error('Expected projected doubled dependency.')

		expect(wireDependency.reference)
			.toEqual(coreDependency.reference)
		expect(wireDependency.reference).not.toBe(coreDependency.reference)
		expect(wireDependency.reference.target).not.toBe(coreDependency.reference.target)
		expect(wireDependency.reference.operation).not.toBe(coreDependency.reference.operation)
	})

	it('flattens diagnostic node references instead of carrying Blueprint node objects', () => {
		const invalid = devtoolsTestSystem.createBlueprint({
			id: 'root',
			type: 'DevtoolsRoot',
			slots: {
				body: [
					{ id: 'dup', type: 'DevtoolsCounter' },
					{ id: 'dup', type: 'DevtoolsCounter' },
				],
			},
		})
		expect(invalid.status)
			.toBe('invalid')
		const inspection = inspectBlueprint(invalid)
		const projected = projectBlueprintSnapshot('runtime-diagnostic-fixture', inspection)

		expect(projected.nodes.some(node => node.diagnostics.length > 0))
			.toBe(true)
		expect(containsFunction(projected))
			.toBe(false)
		expect(JSON.parse(JSON.stringify(projected)))
			.toEqual(projected)
		for (const node of projected.nodes) {
			for (const diagnostic of node.diagnostics) {
				expect(diagnostic.location).not.toHaveProperty('node')
				for (const related of diagnostic.related ?? [])
					expect(related).not.toHaveProperty('node')
			}
		}
	})
})
