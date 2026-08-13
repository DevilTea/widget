/**
 * Conformance coverage for structure validation (issue #10 checkpoint C, COMMENT 13 diagnostic
 * locations, COMMENT 14 relative `addIssue()` authoring / framework finalization).
 */

import type {
	BlueprintPropertyIssueLocation,
	BlueprintStructureIssueLocation,
	BlueprintStructureIssueSource,
	RelativeSystemStructureIssueInput,
	WidgetInterfaces,
} from '../index'
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

type CallOrderEntry = 'plugin' | 'slot' | 'system'
let callOrder: CallOrderEntry[] = []

interface ItemInterfaces extends WidgetInterfaces {}

const itemPlugin = createWidgetPlugin('item')
	.interfaces<ItemInterfaces>()
	.done()

interface ListInterfaces extends WidgetInterfaces {
	slots: 'items'
}

const listPlugin = createWidgetPlugin('list')
	.interfaces<ListInterfaces>()
	.slots(
		{
			items: {
				validateStructure: (ctx) => {
					callOrder.push('slot')
					ctx.addIssue({ message: 'slot:widget-slot' })
					ctx.addIssue({ message: 'slot:widget-slot-child', index: 0 })
				},
			},
		},
		(ctx) => {
			callOrder.push('plugin')
			ctx.addIssue({ message: 'plugin:widget' })
			ctx.addIssue({ message: 'plugin:widget-slot', slot: 'items' })
			ctx.addIssue({ message: 'plugin:widget-slot-child', slot: 'items', index: 0 })
		},
	)
	.done()

const system = createWidgetSystem({
	plugins: [listPlugin, itemPlugin],
	validateStructure: (ctx) => {
		callOrder.push('system')
		const root = ctx.blueprint.root
		if (!root.resolved || root.type !== 'list')
			return

		ctx.addIssue({ message: 'system:widget', location: { type: 'widget', node: root } })
		ctx.addIssue({ message: 'system:widget-slot', location: { type: 'slot', node: root, slot: 'items' } })

		const children = ctx.blueprint.getChildrenAt(root, 'items')
		const firstChild = children[0]
		if (firstChild !== undefined) {
			ctx.addIssue({
				message: 'system:widget-slot-child',
				location: { type: 'slot-child', node: root, slot: 'items', index: 0 },
				related: [{ type: 'widget', node: firstChild }],
			})
		}

		// an explicit `widget` location may reference an unresolved node: `BlueprintWidgetIssueLocation`
		// carries `BlueprintWidgetNode`, which includes the unresolved variant.
		const secondChild = children[1]
		if (secondChild !== undefined) {
			ctx.addIssue({
				message: 'system:unresolved-widget',
				location: { type: 'widget', node: secondChild },
			})
		}
	},
})

beforeEach(() => {
	callOrder = []
})

describe('structure validation scopes', () => {
	it('runs slot, then plugin, then system validateStructure, each producing correctly shaped structure issues', () => {
		const definition = {
			id: 'root',
			type: 'list',
			slots: {
				items: [
					{ id: 'i1', type: 'item' },
					null,
				],
			},
		}

		const blueprint = system.createBlueprint(definition)

		expect(callOrder)
			.toEqual(['slot', 'plugin', 'system'])
		expect(blueprint.status)
			.toBe('invalid')

		const root = blueprint.root
		if (!root.resolved || root.type !== 'list')
			throw new Error('expected a resolved list root')

		const issues = blueprint.getCollectedIssues()
			.filter(issue => issue.source.type === 'structure')
		expect(issues)
			.toHaveLength(9)

		function sourceOf(message: string): BlueprintStructureIssueSource {
			const issue = issues.find(candidate => candidate.message === message)
			if (issue === undefined)
				throw new Error(`expected a structure issue with message "${message}"`)
			return issue.source as BlueprintStructureIssueSource
		}

		// slot-level: widget + slot (no index) — the current slot is always implicit for this scope, so
		// a slot-level diagnostic can never be "widget only".
		const slotWidgetSlot = sourceOf('slot:widget-slot')
		expect(slotWidgetSlot.node)
			.toBe(root)
		expect('slot' in slotWidgetSlot && slotWidgetSlot.slot)
			.toBe('items')
		expect('index' in slotWidgetSlot)
			.toBe(false)

		// slot-level: widget + slot + index
		const slotWidgetSlotChild = sourceOf('slot:widget-slot-child')
		expect(slotWidgetSlotChild.node)
			.toBe(root)
		expect('slot' in slotWidgetSlotChild && slotWidgetSlotChild.slot)
			.toBe('items')
		expect('index' in slotWidgetSlotChild && slotWidgetSlotChild.index)
			.toBe(0)

		// plugin-level: widget only
		const pluginWidget = sourceOf('plugin:widget')
		expect(pluginWidget.node)
			.toBe(root)
		expect('slot' in pluginWidget)
			.toBe(false)
		expect('index' in pluginWidget)
			.toBe(false)

		// plugin-level: widget + slot
		const pluginWidgetSlot = sourceOf('plugin:widget-slot')
		expect('slot' in pluginWidgetSlot && pluginWidgetSlot.slot)
			.toBe('items')
		expect('index' in pluginWidgetSlot)
			.toBe(false)

		// plugin-level: widget + slot + index
		const pluginWidgetSlotChild = sourceOf('plugin:widget-slot-child')
		expect('slot' in pluginWidgetSlotChild && pluginWidgetSlotChild.slot)
			.toBe('items')
		expect('index' in pluginWidgetSlotChild && pluginWidgetSlotChild.index)
			.toBe(0)

		// system-level: explicit widget location
		const systemWidget = sourceOf('system:widget')
		expect(systemWidget.node)
			.toBe(root)
		expect('slot' in systemWidget)
			.toBe(false)

		// system-level: explicit slot location
		const systemWidgetSlot = sourceOf('system:widget-slot')
		expect('slot' in systemWidgetSlot && systemWidgetSlot.slot)
			.toBe('items')
		expect('index' in systemWidgetSlot)
			.toBe(false)

		// system-level: explicit slot-child location, with `related` restricted to a widget location
		const systemWidgetSlotChild = sourceOf('system:widget-slot-child')
		expect('slot' in systemWidgetSlotChild && systemWidgetSlotChild.slot)
			.toBe('items')
		expect('index' in systemWidgetSlotChild && systemWidgetSlotChild.index)
			.toBe(0)
		expect(systemWidgetSlotChild.related)
			.toHaveLength(1)
		expect(systemWidgetSlotChild.related![0]!.type)
			.toBe('widget')
		expect(systemWidgetSlotChild.related![0]!.node)
			.toBe(root.slots.items[0])

		// system-level: explicit widget location targeting an unresolved node still finalizes correctly.
		const systemUnresolvedWidget = sourceOf('system:unresolved-widget')
		expect(systemUnresolvedWidget.node)
			.toBe(root.slots.items[1])
		expect(systemUnresolvedWidget.node.resolved)
			.toBe(false)
	})

	it('a Blueprint with no structure violations remains valid', () => {
		const plainPlugin = createWidgetPlugin('plain')
			.interfaces<WidgetInterfaces>()
			.done()
		const plainSystem = createWidgetSystem({ plugins: [plainPlugin] })

		const blueprint = plainSystem.createBlueprint({ id: 'root', type: 'plain' })

		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.getCollectedIssues())
			.toEqual([])
	})
})

describe('type contract: structure locations', () => {
	it('system-level location/related accept only widget, slot, and slot-child locations', () => {
		expectTypeOf<RelativeSystemStructureIssueInput['location']>()
			.toEqualTypeOf<BlueprintStructureIssueLocation>()
		expectTypeOf<NonNullable<RelativeSystemStructureIssueInput['related']>[number]>()
			.toEqualTypeOf<BlueprintStructureIssueLocation>()

		const propertyLocation = { type: 'property', node: {}, name: 'x' } as BlueprintPropertyIssueLocation

		// @ts-expect-error a property location is not a valid structure location
		const invalidLocation: RelativeSystemStructureIssueInput['location'] = propertyLocation
		expect(invalidLocation)
			.toBeDefined()
	})
})
