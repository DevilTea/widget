/**
 * Regression coverage for PR #12 review finding 3773310817 (`runtime/deps.ts` eager dependency-target
 * lookup).
 *
 * `createWidgetSystemRuntime` builds member primitives progressively (all state, then all properties,
 * then all methods, per node, in ascending compiled-node order). Dependency-tree materialization used to
 * resolve its target primitive eagerly while *building* the returned callable, which only works when
 * the target already exists at that exact point in construction order. Runtime correctness must not
 * depend on member/widget declaration order — diagnostic #10 consolidated handoff §12 only promises that a
 * `resolved` compiled dependency materializes into a usable runtime callable, and COMMENT 18 requires
 * valid Method-only cycles to work.
 *
 * Every case below would previously throw `resolved ... target is missing` inside `createRuntime()`.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

// -------------------------------------------------------------------------------------------------
// Fixture 1: forward Property -> later Property, and Property -> read-only Method (same widget).
// -------------------------------------------------------------------------------------------------

interface OrderingInterfaces {
	properties: {
		first: number
		second: number
		viaMethod: number
	}
	methods: {
		readOnly: () => number
	}
}

const orderingPlugin = createWidgetPlugin('ordering')
	.description('Test widget')
	.interfaces<OrderingInterfaces>()
	.properties(properties => properties
		// Declared first, but depends on `second`, declared after it.
		.first({
			registerDeps: ({ dep }) => ({ second: dep.self.properties.get('second') }),
			compute: ({ deps }) => {
				const result = deps.second()
				return result.ok ? (result.value ?? 0) + 1 : -1
			},
		})
		.second({
			compute: () => 41,
		})
		// Depends on a Method, which is only materialized after every Property regardless of
		// declaration order.
		.viaMethod({
			registerDeps: ({ dep }) => ({ readOnly: dep.self.methods.invoke('readOnly') }),
			compute: ({ deps }) => {
				const result = deps.readOnly()
				return result.ok ? (result.value ?? 0) : -1
			},
		}))
	.methods(methods => methods.readOnly({
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => 99,
	}))
	.done()

// -------------------------------------------------------------------------------------------------
// Fixture 2: a cross-widget dependency on a widget compiled later than the consumer.
// -------------------------------------------------------------------------------------------------

interface LeafBInterfaces {
	properties: {
		value: number
	}
}

const leafBPlugin = createWidgetPlugin('leaf-b')
	.description('Test widget')
	.interfaces<LeafBInterfaces>()
	.properties(properties => properties.value({
		compute: () => 5,
	}))
	.done()

interface LeafAInterfaces {
	properties: {
		viaB: number
	}
}

const leafAPlugin = createWidgetPlugin('leaf-a')
	.description('Test widget')
	.interfaces<LeafAInterfaces>()
	.properties(properties => properties.viaB({
		registerDeps: ({ dep }) => ({ value: dep.widget('b').properties.get('value') }),
		compute: ({ deps }) => {
			const result = deps.value()
			return result.ok && typeof result.value === 'number' ? result.value : -1
		},
	}))
	.done()

interface ContainerInterfaces {
	slots: 'children'
}

const containerPlugin = createWidgetPlugin('container')
	.description('Test widget')
	.interfaces<ContainerInterfaces>()
	.slots({ children: { description: 'Test slot' } })
	.done()

// -------------------------------------------------------------------------------------------------
// Fixture 3: a legal Method-only cycle (`a <-> b`), each direction actually invoked at runtime.
// -------------------------------------------------------------------------------------------------

interface CycleInterfaces {
	methods: {
		a: (invokeOther: boolean) => number
		b: (invokeOther: boolean) => number
	}
}

const cyclePlugin = createWidgetPlugin('cycle')
	.description('Test widget')
	.interfaces<CycleInterfaces>()
	.methods(methods => methods
		.a({
			registerDeps: ({ dep }) => ({ callB: dep.self.methods.invoke('b') }),
			validateArgs: (args): args is [boolean] => args.length === 1 && typeof args[0] === 'boolean',
			execute: ({ args, deps }) => {
				if (!args[0])
					return 1
				const result = deps.callB(false)
				return result.ok ? (result.value ?? 0) + 1 : -1
			},
		})
		.b({
			registerDeps: ({ dep }) => ({ callA: dep.self.methods.invoke('a') }),
			validateArgs: (args): args is [boolean] => args.length === 1 && typeof args[0] === 'boolean',
			execute: ({ args, deps }) => {
				if (!args[0])
					return 2
				const result = deps.callA(false)
				return result.ok ? (result.value ?? 0) + 1 : -1
			},
		}))
	.done()

describe('dependency materialization does not depend on member/widget declaration order', () => {
	it('a Property depending on a later-declared Property in the same widget materializes and computes correctly', () => {
		const system = createWidgetSystem({ plugins: [orderingPlugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'ordering' })
		if (blueprint.status !== 'valid')
			throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

		expect(() => blueprint.createRuntime())
			.not.toThrow()

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('Expected the "root" widget to exist.')

		expect(widget.properties.first.get())
			.toEqual({ ok: true, value: 42 })
		expect(widget.properties.second.get())
			.toEqual({ ok: true, value: 41 })
	})

	it('a Property depending on a read-only Method (materialized only after every Property) works', () => {
		const system = createWidgetSystem({ plugins: [orderingPlugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'ordering' })
		if (blueprint.status !== 'valid')
			throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('Expected the "root" widget to exist.')

		expect(widget.properties.viaMethod.get())
			.toEqual({ ok: true, value: 99 })
	})

	it('a dependency on a widget compiled later than the consumer materializes and reads correctly', () => {
		const system = createWidgetSystem({ plugins: [containerPlugin, leafAPlugin, leafBPlugin] })
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'a', type: 'leaf-a' },
					{ id: 'b', type: 'leaf-b' },
				],
			},
		})
		if (blueprint.status !== 'valid')
			throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

		expect(() => blueprint.createRuntime())
			.not.toThrow()

		const runtime = blueprint.createRuntime()
		const widgetA = runtime.getWidget('a')
		if (widgetA === null || widgetA.type !== 'leaf-a')
			throw new Error('Expected widget "a" to exist and be a "leaf-a" widget.')

		expect(widgetA.properties.viaB.get())
			.toEqual({ ok: true, value: 5 })
	})

	it('a legal Method-only cycle (A <-> B) materializes under createRuntime() and both directions invoke correctly', () => {
		const system = createWidgetSystem({ plugins: [cyclePlugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'cycle' })
		if (blueprint.status !== 'valid')
			throw new Error(`Expected a valid blueprint, got diagnostics: ${JSON.stringify(blueprint.diagnostics)}`)

		expect(() => blueprint.createRuntime())
			.not.toThrow()

		const runtime = blueprint.createRuntime()
		const widget = runtime.getWidget('root')
		if (widget === null)
			throw new Error('Expected the "root" widget to exist.')

		// Direct, non-recursive calls exercise each method's own materialized dependency callable.
		expect(widget.methods.a(false))
			.toEqual({ ok: true, value: 1 })
		expect(widget.methods.b(false))
			.toEqual({ ok: true, value: 2 })

		// `a` actually invokes its dependency on `b` (materialized while `b` did not exist yet).
		expect(widget.methods.a(true))
			.toEqual({ ok: true, value: 3 })
		// `b` actually invokes its dependency on `a` (materialized while `a` was still mid-construction).
		expect(widget.methods.b(true))
			.toEqual({ ok: true, value: 2 })
	})
})
