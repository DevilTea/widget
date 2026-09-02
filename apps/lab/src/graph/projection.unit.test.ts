/**
 * `projectSemanticGraph()` tests against real `@deviltea/widget-core` fixtures (no mocked core — repo
 * testing policy). Covers diagnostic #13 Phase 5 "Dependency Graph semantic representation": all four
 * operation kinds, absent/invalid stub filtering, isolated-member hiding, `transitivelyWrites`
 * cross-checked against the compiler's own fact, `invalidCycles` overlay, and deterministic output.
 */

import type { ResolvedBlueprintInspectionNode } from '@deviltea/widget-core/inspection'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { projectSemanticGraph } from './projection'

// -------------------------------------------------------------------------------------------------
// Fixture system — a container, a dependency target, and a consumer exercising every operation kind
// (state-get/property-get/method-invoke = reads/reads/invokes, state-set = writes) plus an isolated
// member, an absent (optional) dependency and an invalid (unresolved-required) dependency.
// -------------------------------------------------------------------------------------------------

interface ContainerInterfaces {
	slots: 'children'
}

const containerPlugin = createWidgetPlugin('graph-container')
	.interfaces<ContainerInterfaces>()
	.slots({ children: {} })
	.done()

interface TargetInterfaces {
	state: { value: number }
	properties: { val: number }
	methods: { run: () => number }
}

const targetPlugin = createWidgetPlugin('graph-target')
	.interfaces<TargetInterfaces>()
	.state(state => state.value({ validate: (input): input is number => typeof input === 'number', default: () => 1 }))
	.properties(properties => properties.val({ compute: () => 2 }))
	.methods(methods => methods.run({ validateArgs: (args): args is [] => args.length === 0, execute: () => 3 }))
	.done()

interface ConsumerInterfaces {
	properties: {
		reader: unknown
		isolated: unknown
		viaAbsent: unknown
		viaInvalid: unknown
	}
	methods: {
		writer: () => unknown
	}
}

const consumerPlugin = createWidgetPlugin('graph-consumer')
	.interfaces<ConsumerInterfaces>()
	.properties(properties => properties
		.reader({
			registerDeps: ({ dep }) => ({
				s: dep.widget('target').state.get('value'),
				p: dep.widget('target').properties.get('val'),
				m: dep.widget('target').methods.invoke('run'),
			}),
			compute: () => 0,
		})
		.isolated({
			compute: () => 0,
		})
		.viaAbsent({
			registerDeps: ({ dep }) => ({ v: dep.widget('missing-optional')
				.optional().state.get('value') }),
			compute: () => 0,
		})
		.viaInvalid({
			registerDeps: ({ dep }) => ({ v: dep.widget('missing-required').state.get('value') }),
			compute: () => 0,
		}))
	.methods(methods => methods.writer({
		registerDeps: ({ dep }) => ({ setValue: dep.widget('target').state.set('value') }),
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => null,
	}))
	.done()

interface WriteChainInterfaces {
	state: { value: number }
	methods: {
		a: () => unknown
		b: () => unknown
		c: () => unknown
	}
}

/** `a` -> `b` -> `c` -> direct `state.set` — a 3-layer transitive write chain (mirrors core's own conformance fixture shape). */
const writeChainPlugin = createWidgetPlugin('graph-write-chain')
	.interfaces<WriteChainInterfaces>()
	.state(state => state.value({ validate: (input): input is number => typeof input === 'number' }))
	.methods(methods => methods
		.a({
			registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('b') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => null,
		})
		.b({
			registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('c') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => null,
		})
		.c({
			registerDeps: ({ dep }) => ({ setValue: dep.self.state.set('value') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => null,
		}))
	.done()

interface CycleInterfaces {
	properties: {
		p1: unknown
		p2: unknown
	}
}

/** `p1` <-> `p2` — a 2-member Property<->Property invalid evaluation cycle. */
const cyclePlugin = createWidgetPlugin('graph-cycle')
	.interfaces<CycleInterfaces>()
	.properties(properties => properties
		.p1({ registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p2') }), compute: () => null })
		.p2({ registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p1') }), compute: () => null }))
	.done()

const system = createWidgetSystem({
	plugins: [containerPlugin, targetPlugin, consumerPlugin, writeChainPlugin, cyclePlugin],
})

function createMainBlueprint() {
	return system.createBlueprint({
		id: 'root',
		type: 'graph-container',
		slots: {
			children: [
				{ id: 'consumer', type: 'graph-consumer' },
				{ id: 'target', type: 'graph-target' },
			],
		},
	})
}

function vertexIdOf(node: ResolvedBlueprintInspectionNode, kind: 'state' | 'property' | 'method', name: string): string {
	return `${node.nodeId}:${kind}:${name}`
}

describe('projectSemanticGraph', () => {
	it('projects clusters, vertices and edges for all four operation kinds, hiding an unresolved (root-less) container cluster with no members', () => {
		const blueprint = createMainBlueprint()
		const inspection = inspectBlueprint(blueprint)
		const graph = projectSemanticGraph(inspection)

		const consumerNode = inspection.nodes.find(node => node.resolved && node.node.id === 'consumer') as ResolvedBlueprintInspectionNode
		const targetNode = inspection.nodes.find(node => node.resolved && node.node.id === 'target') as ResolvedBlueprintInspectionNode
		expect(consumerNode)
			.toBeDefined()
		expect(targetNode)
			.toBeDefined()

		// The root `graph-container` has no state/properties/methods capability, hence no members and no
		// cluster of its own — clusters exist only where at least one visible member vertex lives.
		expect(graph.clusters.map(cluster => cluster.widgetId)
			.sort())
			.toEqual(['consumer', 'target'])

		const readerId = vertexIdOf(consumerNode, 'property', 'reader')
		const writerId = vertexIdOf(consumerNode, 'method', 'writer')
		// `viaInvalid`'s dependency is `invalid`, and an invalid stub is never filterable — its owner is
		// therefore visible by default too, alongside the three operation-kind-exercising members.
		const viaInvalidId = vertexIdOf(consumerNode, 'property', 'viaInvalid')
		const valueId = vertexIdOf(targetNode, 'state', 'value')
		const valId = vertexIdOf(targetNode, 'property', 'val')
		const runId = vertexIdOf(targetNode, 'method', 'run')

		const vertexIds = graph.vertices.map(vertex => vertex.id)
			.sort()
		expect(vertexIds)
			.toEqual([readerId, runId, valId, valueId, viaInvalidId, writerId].sort())

		function edgeBetween(source: string, target: string) {
			return graph.edges.find(edge => edge.sourceVertexId === source && edge.targetVertexId === target)
		}

		const stateGetEdge = edgeBetween(readerId, valueId)
		expect(stateGetEdge?.operation)
			.toBe('reads')
		expect(stateGetEdge?.path)
			.toEqual(['s'])

		const propertyGetEdge = edgeBetween(readerId, valId)
		expect(propertyGetEdge?.operation)
			.toBe('reads')
		expect(propertyGetEdge?.path)
			.toEqual(['p'])

		const methodInvokeEdge = edgeBetween(readerId, runId)
		expect(methodInvokeEdge?.operation)
			.toBe('invokes')
		expect(methodInvokeEdge?.path)
			.toEqual(['m'])

		const stateSetEdge = edgeBetween(writerId, valueId)
		expect(stateSetEdge?.operation)
			.toBe('writes')
		expect(stateSetEdge?.path)
			.toEqual(['setValue'])

		expect(graph.edges)
			.toHaveLength(4)
	})

	it('hides an absent (optional) stub by default but always shows an invalid stub', () => {
		const inspection = inspectBlueprint(createMainBlueprint())
		const graph = projectSemanticGraph(inspection)

		expect(graph.stubs)
			.toHaveLength(1)
		expect(graph.stubs[0]?.status)
			.toBe('invalid')

		const consumerNode = inspection.nodes.find(node => node.resolved && node.node.id === 'consumer') as ResolvedBlueprintInspectionNode
		const viaAbsentId = vertexIdOf(consumerNode, 'property', 'viaAbsent')
		const viaInvalidId = vertexIdOf(consumerNode, 'property', 'viaInvalid')

		// The absent stub's owner has no other visible relation, so it stays hidden entirely by default...
		expect(graph.vertices.some(vertex => vertex.id === viaAbsentId))
			.toBe(false)
		// ...while the invalid stub's owner is visible because the stub itself is never filterable.
		expect(graph.vertices.some(vertex => vertex.id === viaInvalidId))
			.toBe(true)
	})

	it('reveals the absent stub (and its owner) through the showAbsent filter', () => {
		const inspection = inspectBlueprint(createMainBlueprint())
		const graph = projectSemanticGraph(inspection, { showAbsent: true })

		const statuses = graph.stubs.map(stub => stub.status)
			.sort()
		expect(statuses)
			.toEqual(['absent', 'invalid'])

		const consumerNode = inspection.nodes.find(node => node.resolved && node.node.id === 'consumer') as ResolvedBlueprintInspectionNode
		const viaAbsentId = vertexIdOf(consumerNode, 'property', 'viaAbsent')
		expect(graph.vertices.some(vertex => vertex.id === viaAbsentId))
			.toBe(true)
	})

	it('hides an isolated member by default and reveals it through showIsolatedMembers', () => {
		const inspection = inspectBlueprint(createMainBlueprint())
		const consumerNode = inspection.nodes.find(node => node.resolved && node.node.id === 'consumer') as ResolvedBlueprintInspectionNode
		const isolatedId = vertexIdOf(consumerNode, 'property', 'isolated')

		const defaultGraph = projectSemanticGraph(inspection)
		expect(defaultGraph.vertices.some(vertex => vertex.id === isolatedId))
			.toBe(false)

		const withIsolated = projectSemanticGraph(inspection, { showIsolatedMembers: true })
		const isolatedVertex = withIsolated.vertices.find(vertex => vertex.id === isolatedId)
		expect(isolatedVertex)
			.toBeDefined()
		expect(isolatedVertex?.clusterId)
			.toBe(`cluster:${consumerNode.nodeId}`)
	})

	it('produces deterministic output across repeated calls on the same inspection snapshot', () => {
		const inspection = inspectBlueprint(createMainBlueprint())
		const first = projectSemanticGraph(inspection, { showAbsent: true, showIsolatedMembers: true })
		const second = projectSemanticGraph(inspection, { showAbsent: true, showIsolatedMembers: true })

		expect(second.vertices.map(vertex => vertex.id))
			.toEqual(first.vertices.map(vertex => vertex.id))
		expect(second.edges.map(edge => edge.id))
			.toEqual(first.edges.map(edge => edge.id))
		expect(second.stubs.map(stub => stub.id))
			.toEqual(first.stubs.map(stub => stub.id))
	})

	it('projects transitivelyWrites verbatim from the compiler fact for a state.set write chain', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'graph-write-chain' })
		const inspection = inspectBlueprint(blueprint)
		const rootNode = inspection.getNode(inspection.rootNodeId) as ResolvedBlueprintInspectionNode
		expect(rootNode.resolved)
			.toBe(true)

		const graph = projectSemanticGraph(inspection)

		for (const name of ['a', 'b', 'c'] as const) {
			const fact = rootNode.methods.find(method => method.name === name)?.transitivelyWrites
			const vertex = graph.vertices.find(v => v.id === vertexIdOf(rootNode, 'method', name))
			expect(vertex)
				.toBeDefined()
			// Cross-checked against the compiler's own fact, never hardcoded/recomputed by the Lab.
			expect(vertex?.transitivelyWrites)
				.toBe(fact)
			expect(vertex?.transitivelyWrites)
				.toBe(true)
		}
	})

	it('overlays invalidCycles onto participating vertices and their connecting edges', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'graph-cycle' })
		const inspection = inspectBlueprint(blueprint)
		expect(inspection.invalidCycles)
			.toHaveLength(1)

		const rootNode = inspection.getNode(inspection.rootNodeId) as ResolvedBlueprintInspectionNode
		const p1Id = vertexIdOf(rootNode, 'property', 'p1')
		const p2Id = vertexIdOf(rootNode, 'property', 'p2')

		const graph = projectSemanticGraph(inspection)
		expect(graph.invalidCycleVertexIds.has(p1Id))
			.toBe(true)
		expect(graph.invalidCycleVertexIds.has(p2Id))
			.toBe(true)

		const cycleEdges = graph.edges.filter(edge =>
			(edge.sourceVertexId === p1Id && edge.targetVertexId === p2Id)
			|| (edge.sourceVertexId === p2Id && edge.targetVertexId === p1Id),
		)
		expect(cycleEdges)
			.toHaveLength(2)
		expect(cycleEdges.every(edge => edge.invalidCycle))
			.toBe(true)
	})
})
