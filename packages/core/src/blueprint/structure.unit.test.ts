/**
 * Conformance coverage for structure validation (diagnostic #10 checkpoint C, COMMENT 13 diagnostic
 * locations, COMMENT 14 relative `addDiagnostic()` authoring / framework finalization).
 */

import type {
	BlueprintPropertyDiagnosticLocation,
	BlueprintStructureDiagnostic,
	RelativeStructureDiagnosticLocation,
	RelativeSystemStructureDiagnosticInput,
	WidgetInterfaces,
} from '../index'
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

type CallOrderEntry = 'plugin' | 'slot' | 'system'
let callOrder: CallOrderEntry[] = []

interface ItemInterfaces extends WidgetInterfaces {}

const itemPlugin = createWidgetPlugin('item')
	.description('Test widget')
	.interfaces<ItemInterfaces>()
	.done()

interface ListInterfaces extends WidgetInterfaces {
	slots: 'items'
}

const listPlugin = createWidgetPlugin('list')
	.description('Test widget')
	.interfaces<ListInterfaces>()
	.slots(
		{
			items: {
				description: 'Test slot',
				validateStructure: (ctx) => {
					callOrder.push('slot')
					ctx.addDiagnostic({ message: 'slot:widget-slot' })
					ctx.addDiagnostic({ message: 'slot:widget-slot-child', index: 0 })
				},
			},
		},
		(ctx) => {
			callOrder.push('plugin')
			ctx.addDiagnostic({ message: 'plugin:widget' })
			ctx.addDiagnostic({ message: 'plugin:widget-slot', slot: 'items' })
			ctx.addDiagnostic({ message: 'plugin:widget-slot-child', slot: 'items', index: 0 })
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

		ctx.addDiagnostic({ message: 'system:widget', location: { type: 'widget', node: root } })
		ctx.addDiagnostic({ message: 'system:widget-slot', location: { type: 'slot', node: root, slot: 'items' } })

		const children = ctx.blueprint.getChildrenAt(root, 'items')
		const firstChild = children[0]
		if (firstChild !== undefined) {
			ctx.addDiagnostic({
				message: 'system:widget-slot-child',
				location: { type: 'slot-child', node: root, slot: 'items', index: 0 },
				related: [{ type: 'widget', node: firstChild }],
			})
		}

		// an explicit `widget` location may reference an unresolved node: `BlueprintWidgetDiagnosticLocation`
		// carries `BlueprintWidgetNode`, which includes the unresolved variant.
		const secondChild = children[1]
		if (secondChild !== undefined) {
			ctx.addDiagnostic({
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
	it('runs slot, then plugin, then system validateStructure, each producing correctly shaped structure diagnostics', () => {
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

		const diagnostics = blueprint.diagnostics
			.filter(diagnostic => diagnostic.code === 'invalid-widget-structure')
		expect(diagnostics)
			.toHaveLength(9)

		function sourceOf(message: string): BlueprintStructureDiagnostic {
			const diagnostic = diagnostics.find(candidate => candidate.message === message)
			if (diagnostic === undefined)
				throw new Error(`expected a structure diagnostic with message "${message}"`)
			return diagnostic as BlueprintStructureDiagnostic
		}

		// slot-level: widget + slot (no index) — the current slot is always implicit for this scope, so
		// a slot-level diagnostic can never be "widget only".
		const slotWidgetSlot = sourceOf('slot:widget-slot')
		expect(slotWidgetSlot.location.node)
			.toBe(root)
		expect('slot' in slotWidgetSlot.location && slotWidgetSlot.location.slot)
			.toBe('items')
		expect('index' in slotWidgetSlot.location)
			.toBe(false)

		// slot-level: widget + slot + index
		const slotWidgetSlotChild = sourceOf('slot:widget-slot-child')
		expect(slotWidgetSlotChild.location.node)
			.toBe(root)
		expect('slot' in slotWidgetSlotChild.location && slotWidgetSlotChild.location.slot)
			.toBe('items')
		expect('index' in slotWidgetSlotChild.location && slotWidgetSlotChild.location.index)
			.toBe(0)

		// plugin-level: widget only
		const pluginWidget = sourceOf('plugin:widget')
		expect(pluginWidget.location.node)
			.toBe(root)
		expect('slot' in pluginWidget.location)
			.toBe(false)
		expect('index' in pluginWidget.location)
			.toBe(false)

		// plugin-level: widget + slot
		const pluginWidgetSlot = sourceOf('plugin:widget-slot')
		expect('slot' in pluginWidgetSlot.location && pluginWidgetSlot.location.slot)
			.toBe('items')
		expect('index' in pluginWidgetSlot.location)
			.toBe(false)

		// plugin-level: widget + slot + index
		const pluginWidgetSlotChild = sourceOf('plugin:widget-slot-child')
		expect('slot' in pluginWidgetSlotChild.location && pluginWidgetSlotChild.location.slot)
			.toBe('items')
		expect('index' in pluginWidgetSlotChild.location && pluginWidgetSlotChild.location.index)
			.toBe(0)

		// system-level: explicit widget location
		const systemWidget = sourceOf('system:widget')
		expect(systemWidget.location.node)
			.toBe(root)
		expect('slot' in systemWidget.location)
			.toBe(false)

		// system-level: explicit slot location
		const systemWidgetSlot = sourceOf('system:widget-slot')
		expect('slot' in systemWidgetSlot.location && systemWidgetSlot.location.slot)
			.toBe('items')
		expect('index' in systemWidgetSlot.location)
			.toBe(false)

		// system-level: explicit slot-child location, with `related` restricted to a widget location
		const systemWidgetSlotChild = sourceOf('system:widget-slot-child')
		expect('slot' in systemWidgetSlotChild.location && systemWidgetSlotChild.location.slot)
			.toBe('items')
		expect('index' in systemWidgetSlotChild.location && systemWidgetSlotChild.location.index)
			.toBe(0)
		expect(systemWidgetSlotChild.related)
			.toHaveLength(1)
		expect(systemWidgetSlotChild.related![0]!.type)
			.toBe('widget')
		expect(systemWidgetSlotChild.related![0]!.node)
			.toBe(root.slots.items[0])

		// system-level: explicit widget location targeting an unresolved node still finalizes correctly.
		const systemUnresolvedWidget = sourceOf('system:unresolved-widget')
		expect(systemUnresolvedWidget.location.node)
			.toBe(root.slots.items[1])
		expect(systemUnresolvedWidget.location.node.resolved)
			.toBe(false)
	})

	it('a Blueprint with no structure violations remains valid', () => {
		const plainPlugin = createWidgetPlugin('plain')
			.description('Test widget')
			.interfaces<WidgetInterfaces>()
			.done()
		const plainSystem = createWidgetSystem({ plugins: [plainPlugin] })

		const blueprint = plainSystem.createBlueprint({ id: 'root', type: 'plain' })

		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})
})

describe('type contract: structure locations', () => {
	// Regression for finding 3773310859: a system-level `validateStructure` author only ever holds
	// compile-time node views (from `ctx.blueprint`'s queries), which have no `getDiagnostics()`; the
	// location/related types accept exactly that view shape, not the full finalized node shape.
	it('system-level location/related accept only widget, slot, and slot-child locations, carrying compile-time node views', () => {
		expectTypeOf<RelativeSystemStructureDiagnosticInput['location']>()
			.toEqualTypeOf<RelativeStructureDiagnosticLocation>()
		expectTypeOf<NonNullable<RelativeSystemStructureDiagnosticInput['related']>[number]>()
			.toEqualTypeOf<RelativeStructureDiagnosticLocation>()

		const propertyLocation = { type: 'property', node: {}, name: 'x' } as BlueprintPropertyDiagnosticLocation

		// @ts-expect-error a property location is not a valid structure location
		const invalidLocation: RelativeSystemStructureDiagnosticInput['location'] = propertyLocation
		expect(invalidLocation)
			.toBeDefined()
	})
})
