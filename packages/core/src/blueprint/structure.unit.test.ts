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

describe('structure diagnostic reason', () => {
	interface ReasonListInterfaces extends WidgetInterfaces {
		slots: 'items'
	}

	const reasonListPlugin = createWidgetPlugin('reason-list')
		.description('Test widget')
		.interfaces<ReasonListInterfaces>()
		.slots(
			{
				items: {
					description: 'Test slot',
					validateStructure: (ctx) => {
						ctx.addDiagnostic({ message: 'slot', reason: 'slot-reason' })
						ctx.addDiagnostic({ message: 'slot-child', index: 0, reason: 'slot-child-reason' })
					},
				},
			},
			(ctx) => {
				ctx.addDiagnostic({ message: 'plugin', reason: 'plugin-reason' })
				ctx.addDiagnostic({ message: 'plugin-slot', slot: 'items', reason: 'plugin-slot-reason' })
			},
		)
		.done()

	const reasonSystem = createWidgetSystem({
		plugins: [reasonListPlugin, itemPlugin],
		validateStructure: (ctx) => {
			const root = ctx.blueprint.root
			if (root.resolved)
				ctx.addDiagnostic({ message: 'system', location: { type: 'widget', node: root }, reason: 'system-reason' })
		},
	})

	it('keeps the reason authored at slot, plugin and system level', () => {
		const blueprint = reasonSystem.createBlueprint({ id: 'root', type: 'reason-list', slots: { items: [{ id: 'a', type: 'item' }] } })
		const reasons = (blueprint.diagnostics as readonly BlueprintStructureDiagnostic[])
			.map(diagnostic => [diagnostic.message, diagnostic.reason])

		expect(reasons)
			.toEqual([
				['slot', 'slot-reason'],
				['slot-child', 'slot-child-reason'],
				['plugin', 'plugin-reason'],
				['plugin-slot', 'plugin-slot-reason'],
				['system', 'system-reason'],
			])
	})

	it('omits reason when none was authored', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'list', slots: { items: [{ id: 'a', type: 'item' }] } })
		expect(blueprint.diagnostics.every(diagnostic => !('reason' in diagnostic)))
			.toBe(true)
	})
})

describe('structure validator locations must exist in the Blueprint being compiled', () => {
	const foreign = createWidgetSystem({ plugins: [itemPlugin] })
		.createBlueprint({ id: 'other', type: 'item' })

	function listWith(options: {
		slot?: (ctx: { addDiagnostic: (input: { message: string, index?: number }) => void }) => void
		plugin?: (ctx: { addDiagnostic: (input: any) => void }) => void
		system?: (ctx: { blueprint: any, addDiagnostic: (input: any) => void }) => void
	}) {
		const plugin = createWidgetPlugin('guarded-list')
			.description('Test widget')
			.interfaces<ListInterfaces>()
			.slots({ items: { description: 'Test slot', validateStructure: ctx => options.slot?.(ctx) } }, ctx => options.plugin?.(ctx))
			.done()
		return createWidgetSystem({ plugins: [plugin, itemPlugin], validateStructure: ctx => options.system?.(ctx as never) })
	}

	const source = { id: 'root', type: 'guarded-list', slots: { items: [{ id: 'a', type: 'item' }, { id: 'b', type: 'item' }] } }

	it.each([
		['an index beyond the slot', 999],
		['a negative index', -1],
		['a fractional index', 0.5],
		['an index equal to the child count', 2],
	])('throws a TypeError naming `index` when a slot validator reports %s', (_label, index) => {
		const guarded = listWith({ slot: ctx => ctx.addDiagnostic({ message: 'bad', index }) })

		expect(() => guarded.createBlueprint(source))
			.toThrow(TypeError)
		expect(() => guarded.createBlueprint(source))
			.toThrow(/\bindex\b/)
	})

	it('throws when a slot validator reports an index on an empty slot', () => {
		const guarded = listWith({ slot: ctx => ctx.addDiagnostic({ message: 'bad', index: 0 }) })

		expect(() => guarded.createBlueprint({ id: 'root', type: 'guarded-list' }))
			.toThrow(/\bindex\b/)
	})

	it('accepts every existing child index from a slot validator', () => {
		const guarded = listWith({ slot: ctx => ctx.addDiagnostic({ message: 'ok', index: 1 }) })

		expect(guarded.createBlueprint(source).diagnostics)
			.toHaveLength(1)
	})

	it('throws a TypeError naming `slot` when a plugin validator reports an undeclared slot', () => {
		const guarded = listWith({ plugin: ctx => ctx.addDiagnostic({ message: 'bad', slot: 'nope' }) })

		expect(() => guarded.createBlueprint(source))
			.toThrow(TypeError)
		expect(() => guarded.createBlueprint(source))
			.toThrow(/\bslot\b/)
	})

	it('throws a TypeError naming `index` when a plugin validator reports an out-of-range slot child', () => {
		const guarded = listWith({ plugin: ctx => ctx.addDiagnostic({ message: 'bad', slot: 'items', index: 2 }) })

		expect(() => guarded.createBlueprint(source))
			.toThrow(TypeError)
		expect(() => guarded.createBlueprint(source))
			.toThrow(/\bindex\b/)
	})

	it('throws when a plugin validator reports an index without a slot', () => {
		const guarded = listWith({ plugin: ctx => ctx.addDiagnostic({ message: 'bad', index: 0 }) })

		expect(() => guarded.createBlueprint(source))
			.toThrow(/\bindex\b/)
	})

	it('throws a TypeError naming `location.node` for a node of another Blueprint or a fabricated node', () => {
		for (const node of [foreign.root, { fake: true }]) {
			const guarded = listWith({ system: ctx => ctx.addDiagnostic({ message: 'bad', location: { type: 'widget', node } }) })

			expect(() => guarded.createBlueprint(source))
				.toThrow(TypeError)
			expect(() => guarded.createBlueprint(source))
				.toThrow(/location\.node/)
		}
	})

	it('throws naming `location.slot` for an undeclared slot and for a slot of an unresolved node', () => {
		const undeclared = listWith({ system: ctx => ctx.addDiagnostic({ message: 'bad', location: { type: 'slot', node: ctx.blueprint.root, slot: 'zzz' } }) })
		expect(() => undeclared.createBlueprint(source))
			.toThrow(/location\.slot/)

		const unresolved = listWith({
			system: (ctx) => {
				const ghost = ctx.blueprint.getChildrenAt(ctx.blueprint.root, 'items')[0]
				ctx.addDiagnostic({ message: 'bad', location: { type: 'slot', node: ghost, slot: 'items' } })
			},
		})
		expect(() => unresolved.createBlueprint({ id: 'root', type: 'guarded-list', slots: { items: [{ id: 'g', type: 'unknown' }] } }))
			.toThrow(/location\.slot/)
	})

	it('throws naming `location.index` for a slot-child index outside the slot', () => {
		const guarded = listWith({ system: ctx => ctx.addDiagnostic({ message: 'bad', location: { type: 'slot-child', node: ctx.blueprint.root, slot: 'items', index: 999 } }) })

		expect(() => guarded.createBlueprint(source))
			.toThrow(/location\.index/)
	})

	it('validates related locations and names the offending entry', () => {
		const guarded = listWith({
			system: ctx => ctx.addDiagnostic({
				message: 'bad',
				location: { type: 'widget', node: ctx.blueprint.root },
				related: [{ type: 'widget', node: ctx.blueprint.root }, { type: 'slot-child', node: ctx.blueprint.root, slot: 'items', index: 5 }],
			}),
		})

		expect(() => guarded.createBlueprint(source))
			.toThrow(/related\[1\]\.index/)
	})

	it('still accepts every valid system location', () => {
		const guarded = listWith({
			system: (ctx) => {
				const root = ctx.blueprint.root
				const [first] = ctx.blueprint.getChildrenAt(root, 'items')
				ctx.addDiagnostic({
					message: 'ok',
					location: { type: 'slot-child', node: root, slot: 'items', index: 1 },
					related: [{ type: 'widget', node: first }, { type: 'slot', node: root, slot: 'items' }],
				})
			},
		})

		expect(guarded.createBlueprint(source).diagnostics)
			.toHaveLength(1)
	})
})
