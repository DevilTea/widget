/**
 * Conformance group 17 (disposal/post-mortem), group 18 (immutability) and the remaining slice of group
 * 19 (arbitrary-string safety — a special WidgetId as a dependency target) from issue #10's inspection
 * amendments "readonly inspection subscription and disposal semantics" and "inspection exact API v1
 * (part 1/2)". The member-key and container-key slices of group 19 live in
 * `member-inventories.unit.test.ts` and `dependencies.unit.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, WidgetSystemRuntimeDisposedError } from '../index'
import { inspectBlueprint, inspectRuntime } from './index'

const PROTO_KEY = '__proto__' as const

interface HarnessInterfaces {
	state: {
		count: number
	}
	properties: {
		doubled: number
	}
}

function createHarness() {
	const plugin = createWidgetPlugin('disposal-harness')
		.interfaces<HarnessInterfaces>()
		.state(state => state.count({
			validate: (input): input is number => typeof input === 'number',
			default: () => 0,
		}))
		.properties(properties => properties.doubled({
			registerDeps: ({ dep }) => ({ count: dep.self.state.get('count') }),
			compute: ({ deps }) => {
				const result = deps.count()
				return result.success ? (result.value ?? 0) * 2 : -1
			},
		}))
		.done()

	const system = createWidgetSystem({ plugins: [plugin] })
	const blueprint = system.createBlueprint({ id: 'root', type: 'disposal-harness' })
	if (blueprint.status !== 'valid')
		throw new Error('test fixture: expected a valid blueprint')

	const runtime = blueprint.createRuntime()
	const widget = runtime.getWidget('root')
	if (widget === null)
		throw new Error('test fixture: expected the root widget to exist')

	return { blueprint, runtime, widget }
}

function rootIdOf(runtime: ReturnType<typeof createHarness>['runtime']) {
	return inspectRuntime(runtime).blueprint.rootNodeId
}

describe('disposal / post-mortem', () => {
	it('retained State/Property snapshots stay readable after dispose', () => {
		const { widget, runtime } = createHarness()
		widget.state.count.set(3)
		widget.properties.doubled.get()

		const widgetInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!
		const stateInspection = widgetInspection.getState('count')!
		const propertyInspection = widgetInspection.getProperty('doubled')!

		runtime.dispose()

		expect(stateInspection.getSnapshot())
			.toEqual({ value: 3 })
		expect(propertyInspection.getSnapshot())
			.toEqual({ status: 'completed', result: { success: true, value: 6 } })
	})

	it('getWidget()/blueprint stay usable after dispose', () => {
		const { runtime } = createHarness()
		const runtimeInspection = inspectRuntime(runtime)
		runtime.dispose()

		expect(() => runtimeInspection.getWidget(rootIdOf(runtime))).not.toThrow()
		expect(runtimeInspection.getWidget(rootIdOf(runtime)))
			.not.toBeNull()
		expect(() => runtimeInspection.blueprint.nodes).not.toThrow()
	})

	it('materializing a not-yet-obtained member facade post-dispose still works', () => {
		const { widget, runtime } = createHarness()
		widget.state.count.set(9)
		runtime.dispose()

		// First-ever `getState('count')` call happens after dispose.
		const stateInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getState('count')!
		expect(stateInspection.getSnapshot())
			.toEqual({ value: 9 })
	})

	it('the first inspectRuntime() call happening after dispose still returns a working facade over retained facts', () => {
		const { widget, runtime } = createHarness()
		widget.state.count.set(7)
		runtime.dispose()

		// No `inspectRuntime(runtime)` call happened before this line.
		const inspection = inspectRuntime(runtime)
		const stateInspection = inspection.getWidget(rootIdOf(runtime))!.getState('count')!
		expect(stateInspection.getSnapshot())
			.toEqual({ value: 7 })
	})

	it('a new subscribe() after dispose throws WidgetSystemRuntimeDisposedError', () => {
		const { runtime } = createHarness()
		const stateInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getState('count')!
		runtime.dispose()

		let caught: unknown
		try {
			stateInspection.subscribe(() => {})
		}
		catch (error) {
			caught = error
		}
		expect(caught)
			.toBeInstanceOf(WidgetSystemRuntimeDisposedError)
		expect((caught as Error).name)
			.toBe('WidgetSystemRuntimeDisposedError')
	})

	it('a pre-existing subscription is detached at dispose with no final emission, and its unsubscribe stays idempotent', () => {
		const { widget, runtime } = createHarness()
		const stateInspection = inspectRuntime(runtime)
			.getWidget(rootIdOf(runtime))!.getState('count')!
		const listener = vi.fn()
		const unsubscribe = stateInspection.subscribe(listener)

		widget.state.count.set(1)
		expect(listener)
			.toHaveBeenCalledTimes(1)

		runtime.dispose()

		// dispose() itself must not synthesize a final emission.
		expect(listener)
			.toHaveBeenCalledTimes(1)
		expect(() => unsubscribe()).not.toThrow()
		expect(() => unsubscribe()).not.toThrow()
	})
})

describe('immutability', () => {
	interface ImmutInterfaces {
		slots: 'items'
		state: {
			value: number
		}
		properties: {
			p: unknown
		}
		methods: {
			m: () => unknown
		}
	}

	const immutContainerPlugin = createWidgetPlugin('immut-container')
		.interfaces<ImmutInterfaces>()
		.slots({ items: {} })
		.state(state => state.value({ validate: (input): input is number => typeof input === 'number' }))
		.properties(properties => properties.p({
			registerDeps: ({ dep }) => ({ v: dep.self.state.get('value') }),
			compute: ({ deps }) => {
				const result = deps.v()
				return result.success ? result.value : null
			},
		}))
		.methods(methods => methods.m({
			registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p') }),
			validateArgs: (args): args is [] => args.length === 0,
			execute: () => null,
		}))
		.done()

	interface ImmutLeafInterfaces {
		state: {
			value: number
		}
	}

	const immutLeafPlugin = createWidgetPlugin('immut-leaf')
		.interfaces<ImmutLeafInterfaces>()
		.state(state => state.value({ validate: (input): input is number => typeof input === 'number' }))
		.done()

	interface ImmutCycleInterfaces {
		properties: {
			loop: unknown
		}
	}

	/** A Property self-loop, used only to populate `invalidCycles` for the nested-member-freeze test. */
	const immutCyclePlugin = createWidgetPlugin('immut-cycle')
		.interfaces<ImmutCycleInterfaces>()
		.properties(properties => properties.loop({
			registerDeps: ({ dep }) => ({ self: dep.self.properties.get('loop') }),
			compute: () => null,
		}))
		.done()

	const system = createWidgetSystem({ plugins: [immutContainerPlugin, immutLeafPlugin, immutCyclePlugin] })

	it('every framework-owned inspection structure is frozen: nodes, slots, members, dependencies, paths, cycles', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'immut-container',
			slots: { items: [{ id: 'child', type: 'immut-leaf' }] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(Object.isFrozen(inspection.nodes))
			.toBe(true)
		expect(Object.isFrozen(root))
			.toBe(true)
		expect(Object.isFrozen(root.sourceSlots))
			.toBe(true)
		expect(Object.isFrozen(root.sourceSlots[0]))
			.toBe(true)
		expect(Object.isFrozen(root.sourceSlots[0]!.children))
			.toBe(true)
		expect(Object.isFrozen(root.semanticSlots))
			.toBe(true)
		expect(Object.isFrozen(root.semanticSlots[0]))
			.toBe(true)
		expect(Object.isFrozen(root.state))
			.toBe(true)
		expect(Object.isFrozen(root.state[0]))
			.toBe(true)
		expect(Object.isFrozen(root.properties))
			.toBe(true)
		expect(Object.isFrozen(root.properties[0]))
			.toBe(true)

		const dep = root.properties[0]!.dependencies[0]!
		expect(Object.isFrozen(dep))
			.toBe(true)
		expect(Object.isFrozen(dep.path))
			.toBe(true)
		expect(Object.isFrozen(dep.reference))
			.toBe(true)
		expect(Object.isFrozen(dep.reference.target))
			.toBe(true)
		expect(Object.isFrozen(dep.reference.operation))
			.toBe(true)

		const methodDep = root.methods[0]!.dependencies[0]!
		expect(Object.isFrozen(methodDep))
			.toBe(true)
		expect(Object.isFrozen(methodDep.reference))
			.toBe(true)
		expect(Object.isFrozen(methodDep.reference.target))
			.toBe(true)
		expect(Object.isFrozen(methodDep.reference.operation))
			.toBe(true)

		expect(Object.isFrozen(inspection.invalidCycles))
			.toBe(true)
	})

	it('a resolved dependency reference (including nested target/operation) is a frozen, independent clone — mutation throws and cannot influence Runtime behavior (review round 1, finding 2)', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'immut-container',
			slots: { items: [] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		const dep = root.properties[0]!.dependencies[0]!
		expect(dep.status)
			.toBe('resolved')

		expect(() => {
			(dep.reference.operation as unknown as { key: string }).key = 'corrupted'
		})
			.toThrow()
		expect(() => {
			(dep.reference.target as unknown as { type: string }).type = 'corrupted'
		})
			.toThrow()
		// The attempted mutations above throw (frozen), so the reference itself never actually changes —
		// asserted here for completeness rather than because a successful mutation was ever possible.
		expect(dep.reference)
			.toEqual({ target: { type: 'self' }, operation: { type: 'state-get', key: 'value' } })

		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')
		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')!
		if (widget.type !== 'immut-container')
			throw new Error('test fixture: expected the "immut-container" widget')
		widget.state.value.set(41)
		// Runtime dependency resolution for `p` (the same declared dependency the inspection snapshot
		// above projects) still resolves correctly against the real, compiler-owned `reference` object —
		// proof the inspection-exposed clone was never aliased into Runtime materialization.
		expect(widget.properties.p.get())
			.toEqual({ success: true, value: 41 })
		expect(widget.properties.p.getIssues())
			.toEqual([])
	})

	it('invalidCycles[].members[].member is a frozen, independent clone (review round 1, finding 4)', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'immut-cycle' })
		const inspection = inspectBlueprint(blueprint)

		expect(inspection.invalidCycles)
			.toHaveLength(1)
		const memberRef = inspection.invalidCycles[0]!.members[0]!
		expect(Object.isFrozen(memberRef))
			.toBe(true)
		expect(Object.isFrozen(memberRef.member))
			.toBe(true)
		expect(() => {
			(memberRef.member as unknown as { name: string }).name = 'intruder'
		})
			.toThrow()
		expect(memberRef.member)
			.toEqual({ type: 'property', name: 'loop' })
	})

	it('mutating a frozen inspection array/object throws in strict mode or is a silent no-op, and never corrupts the snapshot', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'immut-leaf' })
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		expect(() => {
			(root.state as unknown as { push: (value: unknown) => void }).push({ type: 'state', name: 'intruder' })
		})
			.toThrow()
		expect(root.state)
			.toEqual([{ type: 'state', name: 'value' }])
	})

	it('caller/plugin payload values (rawDefinition) are never deep-frozen by inspection', () => {
		const rawDefinition = { id: 'root', type: 'immut-leaf', marker: { nested: true } }
		const blueprint = system.createBlueprint(rawDefinition)
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!

		expect(root.node.rawDefinition)
			.toBe(rawDefinition)
		expect(Object.isFrozen(rawDefinition))
			.toBe(false)
	})

	it('runtime inspection snapshot envelopes are frozen', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'immut-leaf' })
		if (blueprint.status !== 'valid')
			throw new Error('test fixture: expected a valid blueprint')
		const runtime = blueprint.createRuntime()
		const stateInspection = inspectRuntime(runtime)
			.getWidget(inspectRuntime(runtime).blueprint.rootNodeId)!.getState('value')!

		expect(Object.isFrozen(stateInspection.getSnapshot()))
			.toBe(true)
	})
})

describe('arbitrary-string safety: WidgetId as a dependency target', () => {
	interface TargetInterfaces {
		state: {
			value: number
		}
	}

	interface ConsumerInterfaces {
		slots: 'children'
		properties: {
			viaProtoId: unknown
		}
	}

	const targetPlugin = createWidgetPlugin('special-id-target')
		.interfaces<TargetInterfaces>()
		.state(state => state.value({
			validate: (input): input is number => typeof input === 'number',
			default: () => 4,
		}))
		.done()

	const consumerPlugin = createWidgetPlugin('special-id-consumer')
		.interfaces<ConsumerInterfaces>()
		.slots({ children: {} })
		.properties(properties => properties.viaProtoId({
			registerDeps: ({ dep }) => ({ v: dep.widget(PROTO_KEY).state.get('value') }),
			compute: () => null,
		}))
		.done()

	const system = createWidgetSystem({ plugins: [targetPlugin, consumerPlugin] })

	it('resolves a dependency whose target WidgetId is the special string "__proto__"', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'special-id-consumer',
			slots: { children: [{ id: PROTO_KEY, type: 'special-id-target' }] },
		})
		const inspection = inspectBlueprint(blueprint)
		const root = inspection.getNode(inspection.rootNodeId)!
		if (!root.resolved)
			throw new Error('test fixture: expected a resolved root')

		const dep = root.properties[0]!.dependencies[0]!
		expect(dep.status)
			.toBe('resolved')
		expect(dep.reference.target)
			.toEqual({ type: 'widget', widgetId: PROTO_KEY, optional: false })
		if (dep.status === 'resolved') {
			expect(dep.target.member)
				.toEqual({ type: 'state', name: 'value' })
		}
	})
})
