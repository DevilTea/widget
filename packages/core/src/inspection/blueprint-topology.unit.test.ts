/**
 * Conformance group 4 (source topology projection), group 5 (ordering — node pre-order and
 * slot/semantic-slot declaration order) and group 6 (capability distinction) from issue #10's inspection
 * amendment "inspection exact API v1 (part 1)".
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from './index'

interface LeafInterfaces {
	state: {
		value: number
	}
}

const leafPlugin = createWidgetPlugin('topology-leaf')
	.interfaces<LeafInterfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
		default: () => 0,
	}))
	.done()

interface ContainerInterfaces {
	slots: 'left' | 'right'
}

/** Declared in reverse-alphabetic order to prove `semanticSlots` preserves declaration order verbatim. */
const containerPlugin = createWidgetPlugin('topology-container')
	.interfaces<ContainerInterfaces>()
	.slots({ right: {}, left: {} })
	.done()

interface ZebraApplePluginInterfaces {
	slots: 'zebra' | 'apple'
}

const zebraApplePlugin = createWidgetPlugin('zebra-apple')
	.interfaces<ZebraApplePluginInterfaces>()
	.slots({ zebra: {}, apple: {} })
	.done()

interface ConfiguredInterfaces {
	config: {
		raw: { readonly label?: string }
		resolved: { readonly label: string }
	}
}

const configuredPlugin = createWidgetPlugin('configured')
	.interfaces<ConfiguredInterfaces>()
	.config({
		validate: (input): input is { readonly label?: string } => input === undefined || (typeof input === 'object' && input !== null),
		resolve: raw => ({ label: raw?.label ?? 'default' }),
	})
	.done()

interface ExplicitEmptyInterfaces {
	slots: never
	state: Record<never, never>
	properties: Record<never, never>
	methods: Record<never, never>
}

/**
 * `slots`/`state`/`properties`/`methods` are all *declared* (each builder phase is actually invoked) but
 * with zero member/slot names — the "explicitly declared empty" capability shape distinct from
 * "capability not declared at all". `Record<never, never>` is this codebase's established spelling for a
 * declared-but-empty state/properties/methods capability (matching `compile-view-typing.unit.test.ts`
 * and `plugin-typestate.unit.test.ts`); `slots: never` is the canonical explicit-empty slots spelling
 * (issue #10 amendment "declaration-presence semantics and public `WidgetPlugin.capabilities`").
 */
const explicitEmptyPlugin = createWidgetPlugin('explicit-empty')
	.interfaces<ExplicitEmptyInterfaces>()
	.slots({})
	.state(state => state)
	.properties(properties => properties)
	.methods(methods => methods)
	.done()

const system = createWidgetSystem({ plugins: [leafPlugin, containerPlugin, zebraApplePlugin, configuredPlugin, explicitEmptyPlugin] })

function widgetIdOf(node: { readonly node: { readonly resolved: boolean, readonly id?: string } }): string | null {
	return node.node.resolved ? (node.node.id as string) : null
}

describe('source topology projection', () => {
	it('a declared slot key gets placement "slot"', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'topology-container',
			slots: { left: [{ id: 'a', type: 'topology-leaf' }], right: [] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		const leftSlot = root.sourceSlots.find(slot => slot.name === 'left')!
		expect(leftSlot.placement)
			.toBe('slot')
	})

	it('an unknown raw slot key on a resolved node gets placement "raw-slot" and is excluded from semanticSlots', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'topology-container',
			slots: { left: [], right: [], mystery: [{ id: 'a', type: 'topology-leaf' }] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		const mysterySlot = root.sourceSlots.find(slot => slot.name === 'mystery')!
		expect(mysterySlot.placement)
			.toBe('raw-slot')
		expect(mysterySlot.children)
			.toHaveLength(1)
		expect(root.semanticSlots.some(slot => slot.name === 'mystery'))
			.toBe(false)
	})

	it('every recovered source slot of an unresolved node has placement "raw-slot"', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'does-not-exist',
			slots: { left: [{ id: 'a', type: 'topology-leaf' }], right: [{ id: 'b', type: 'topology-leaf' }] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		expect(root.resolved)
			.toBe(false)
		expect(root.sourceSlots.length)
			.toBeGreaterThan(0)
		expect(root.sourceSlots.every(slot => slot.placement === 'raw-slot'))
			.toBe(true)
	})

	it('one recovered source-slot entry never mixes "slot" and "raw-slot" placements', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'topology-container',
			slots: { left: [{ id: 'a', type: 'topology-leaf' }], right: [] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		for (const slot of root.sourceSlots) {
			expect(['slot', 'raw-slot'])
				.toContain(slot.placement)
		}
		// Each entry is a single scalar placement, structurally incapable of mixing.
	})

	it('a malformed raw slot value produces no sourceSlots entry, and the existing definition Issue is unaffected', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'topology-container',
			slots: { left: 'not-an-array' as unknown as [], right: [] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.sourceSlots.some(slot => slot.name === 'left'))
			.toBe(false)
		expect(root.node.getIssues()
			.some(issue => issue.source.type === 'definition'))
			.toBe(true)
	})
})

describe('ordering', () => {
	it('nodes is the exact recovered-source pre-order (root first, children in source slot key + index order)', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'topology-container',
			slots: {
				left: [{
					id: 'left-container',
					type: 'topology-container',
					slots: { left: [{ id: 'll', type: 'topology-leaf' }], right: [] },
				}],
				right: [{ id: 'r1', type: 'topology-leaf' }, { id: 'r2', type: 'topology-leaf' }],
			},
		})
		const inspection = inspectBlueprint(blueprint)

		expect(inspection.nodes.map(widgetIdOf))
			.toEqual(['root', 'left-container', 'll', 'r1', 'r2'])
	})

	it('semanticSlots preserves plugin declaration order verbatim (reverse-alphabetic), not sorted', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'zebra-apple' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.semanticSlots.map(slot => slot.name))
			.toEqual(['zebra', 'apple'])
	})

	it('sourceSlots follows the compiler recovered source-slot enumeration order, not alphabetic', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'topology-container',
			slots: { right: [], left: [] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.sourceSlots.map(slot => slot.name))
			.toEqual(['right', 'left'])
	})
})

describe('capability distinction', () => {
	it('capabilities.slots is true with per-slot empty inventories when no raw slots are supplied', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'topology-container' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.capabilities.slots)
			.toBe(true)
		expect(root.semanticSlots)
			.toEqual([{ name: 'right', children: [] }, { name: 'left', children: [] }])
	})

	it('capabilities.slots is false for a plugin without slots capability, and semanticSlots stays []', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'topology-leaf' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.capabilities.slots)
			.toBe(false)
		expect(root.semanticSlots)
			.toEqual([])
	})

	it('capabilities.state/properties/methods are false with empty inventories when the plugin never declares them', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'topology-container' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.capabilities.state)
			.toBe(false)
		expect(root.capabilities.properties)
			.toBe(false)
		expect(root.capabilities.methods)
			.toBe(false)
		expect(root.state)
			.toEqual([])
		expect(root.properties)
			.toEqual([])
		expect(root.methods)
			.toEqual([])
	})

	it('capabilities.slots/state/properties/methods are true (not absent) for a declared-but-explicitly-empty capability, with inventories staying [] (review round 1 finding 5, round 2 slots correction)', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'explicit-empty' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.capabilities.slots)
			.toBe(true)
		expect(root.capabilities.state)
			.toBe(true)
		expect(root.capabilities.properties)
			.toBe(true)
		expect(root.capabilities.methods)
			.toBe(true)
		expect(root.semanticSlots)
			.toEqual([])
		expect(root.state)
			.toEqual([])
		expect(root.properties)
			.toEqual([])
		expect(root.methods)
			.toEqual([])
	})

	it('capabilities.state is true with a non-empty inventory for a plugin that declares state', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'topology-leaf' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(root.capabilities.state)
			.toBe(true)
		expect(root.state)
			.toEqual([{ type: 'state', name: 'value' }])
	})

	it('capabilities.config is true for a plugin with config capability and false otherwise', () => {
		const configured = inspectBlueprint(system.createBlueprint({ id: 'root', type: 'configured' }))
		const plain = inspectBlueprint(system.createBlueprint({ id: 'root', type: 'topology-leaf' }))

		const configuredRoot = configured.getNode(configured.rootNodeId)!
		const plainRoot = plain.getNode(plain.rootNodeId)!
		if (!configuredRoot.resolved || !plainRoot.resolved)
			throw new Error('test fixture: expected resolved roots')

		expect(configuredRoot.capabilities.config)
			.toBe(true)
		expect(plainRoot.capabilities.config)
			.toBe(false)
	})
})
