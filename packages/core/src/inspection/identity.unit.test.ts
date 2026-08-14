/**
 * Conformance group 2 (facade identity) and group 3 (`InspectionNodeId` uniqueness/round-trip/foreign
 * handling) from issue #10's inspection amendment "inspection exact API v1 (part 2)".
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint, inspectRuntime } from './index'

interface LeafInterfaces {
	state: {
		value: number
	}
}

const leafPlugin = createWidgetPlugin('identity-leaf')
	.interfaces<LeafInterfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()

interface ContainerInterfaces {
	slots: 'items'
}

const containerPlugin = createWidgetPlugin('identity-container')
	.interfaces<ContainerInterfaces>()
	.slots({ items: {} })
	.done()

const system = createWidgetSystem({ plugins: [leafPlugin, containerPlugin] })

function createValidBlueprint() {
	return system.createBlueprint({
		id: 'root',
		type: 'identity-container',
		slots: { items: [{ id: 'a', type: 'identity-leaf' }, { id: 'b', type: 'identity-leaf' }] },
	})
}

describe('facade identity', () => {
	it('inspectBlueprint(blueprint) === inspectBlueprint(blueprint)', () => {
		const blueprint = createValidBlueprint()
		expect(inspectBlueprint(blueprint))
			.toBe(inspectBlueprint(blueprint))
	})

	it('distinct Blueprint instances never share a facade, even from the same definition', () => {
		const first = createValidBlueprint()
		const second = createValidBlueprint()
		expect(inspectBlueprint(first))
			.not.toBe(inspectBlueprint(second))
	})

	it('inspectRuntime(runtime) === inspectRuntime(runtime)', () => {
		const blueprint = createValidBlueprint()
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')
		const runtime = blueprint.createRuntime()
		expect(inspectRuntime(runtime))
			.toBe(inspectRuntime(runtime))
	})

	it('inspectRuntime(runtime).blueprint === inspectBlueprint(runtime.blueprint)', () => {
		const blueprint = createValidBlueprint()
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')
		const runtime = blueprint.createRuntime()
		expect(inspectRuntime(runtime).blueprint)
			.toBe(inspectBlueprint(runtime.blueprint))
	})

	it('distinct Runtime instances never share a facade', () => {
		const first = createValidBlueprint()
		const second = createValidBlueprint()
		if (first.status !== 'valid' || second.status !== 'valid')
			throw new Error('test fixture: expected valid blueprints')
		expect(inspectRuntime(first.createRuntime()))
			.not.toBe(inspectRuntime(second.createRuntime()))
	})
})

describe('inspectionNodeId', () => {
	it('is unique per recovered node, including two nodes that share the same duplicate WidgetId', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'identity-container',
			slots: { items: [{ id: 'dup', type: 'identity-leaf' }, { id: 'dup', type: 'identity-leaf' }] },
		})
		const inspection = inspectBlueprint(blueprint)

		const rootNode = inspection.getNode(inspection.rootNodeId)
		if (rootNode === null || !rootNode.resolved)
			throw new Error('test fixture: expected a resolved root')

		const childIds = rootNode.sourceSlots[0]!.children
		expect(childIds)
			.toHaveLength(2)
		expect(childIds[0])
			.not.toBe(childIds[1])

		const first = inspection.getNode(childIds[0]!)
		const second = inspection.getNode(childIds[1]!)
		expect(first)
			.not.toBeNull()
		expect(second)
			.not.toBeNull()
		expect(first)
			.not.toBe(second)
		// Both still resolve to the same duplicate declared id.
		expect(first!.resolved && first!.node.resolved && first!.node.id)
			.toBe('dup')
		expect(second!.resolved && second!.node.resolved && second!.node.id)
			.toBe('dup')
	})

	it('covers unresolved nodes too (a node missing id/type still gets an InspectionNodeId)', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'identity-container',
			slots: { items: [{ notAWidget: true }] },
		})
		const inspection = inspectBlueprint(blueprint)
		const rootNode = inspection.getNode(inspection.rootNodeId)
		if (rootNode === null || !rootNode.resolved)
			throw new Error('test fixture: expected a resolved root')

		const childId = rootNode.sourceSlots[0]!.children[0]!
		const child = inspection.getNode(childId)
		expect(child)
			.not.toBeNull()
		expect(child!.resolved)
			.toBe(false)
	})

	it('getNode()/getNodeId() round-trip for every node in the snapshot', () => {
		const blueprint = createValidBlueprint()
		const inspection = inspectBlueprint(blueprint)

		for (const node of inspection.nodes) {
			expect(inspection.getNode(node.nodeId))
				.toBe(node)
			expect(inspection.getNodeId(node.node))
				.toBe(node.nodeId)
		}
	})

	it('getNodeId() returns null for a foreign node from a different Blueprint snapshot', () => {
		const first = createValidBlueprint()
		const second = createValidBlueprint()
		const firstInspection = inspectBlueprint(first)
		const secondInspection = inspectBlueprint(second)

		const foreignNode = secondInspection.getNode(secondInspection.rootNodeId)!.node
		expect(firstInspection.getNodeId(foreignNode))
			.toBeNull()
	})

	it('getNodeId() returns null for a forged non-node value', () => {
		const blueprint = createValidBlueprint()
		const inspection = inspectBlueprint(blueprint)
		expect(inspection.getNodeId({} as never))
			.toBeNull()
	})

	it('getNode() returns null for a forged out-of-domain id (never throws)', () => {
		const blueprint = createValidBlueprint()
		const inspection = inspectBlueprint(blueprint)
		expect(() => inspection.getNode(999_999 as never)).not.toThrow()
		expect(inspection.getNode(999_999 as never))
			.toBeNull()
		expect(inspection.getNode(-1 as never))
			.toBeNull()
	})
})
