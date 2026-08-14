/**
 * Conformance group 11 (`transitivelyWrites`) and group 12 (invalid SCC projection) from issue #10's
 * inspection amendment "inspection exact API v1 (part 1)".
 *
 * Every fact here is read straight off `CompiledGraphAnalysis` (`../blueprint/graph.ts`); this module
 * performs no own SCC/write-effect traversal — see `blueprint.ts`'s `buildInvalidCycles`, which merely
 * projects `compiled.analysis.invalidCycles` verbatim.
 */

import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from './index'

interface WriteChain3Interfaces {
	state: {
		value: number
	}
	properties: {
		reader: unknown
	}
	methods: {
		a: () => unknown
		b: () => unknown
		c: (value: number) => number | null
	}
}

/** `reader` -> method `a` -> method `b` -> method `c` -> direct `state.set` (3-layer chain). */
const writeChain3Plugin = createWidgetPlugin('graph-write-chain-3')
	.interfaces<WriteChain3Interfaces>()
	.state(state => state.value({ validate: (input): input is number => typeof input === 'number' }))
	.properties(properties => properties.reader({
		registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('a') }),
		compute: () => null,
	}))
	.methods(methods =>
		methods
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
				validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
				execute: () => null,
			}),
	)
	.done()

interface PureMethodInterfaces {
	methods: {
		noop: () => unknown
	}
}

const pureMethodPlugin = createWidgetPlugin('graph-pure-method')
	.interfaces<PureMethodInterfaces>()
	.methods(methods => methods.noop({
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => null,
	}))
	.done()

interface SelfLoopInterfaces {
	properties: {
		loop: unknown
	}
}

const selfLoopPlugin = createWidgetPlugin('graph-self-loop')
	.interfaces<SelfLoopInterfaces>()
	.properties(properties => properties.loop({
		registerDeps: ({ dep }) => ({ self: dep.self.properties.get('loop') }),
		compute: () => null,
	}))
	.done()

interface PropMethodCycleInterfaces {
	properties: {
		p: unknown
	}
	methods: {
		m: () => unknown
	}
}

/** `p` -> method `m` -> `p`: a 2-member mixed cyclic SCC containing one Property and one Method. */
const propMethodCyclePlugin = createWidgetPlugin('graph-prop-method-cycle')
	.interfaces<PropMethodCycleInterfaces>()
	.properties(properties => properties.p({
		registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('m') }),
		compute: () => null,
	}))
	.methods(methods => methods.m({
		registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p') }),
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => null,
	}))
	.done()

interface PropPropCycleInterfaces {
	properties: {
		p1: unknown
		p2: unknown
	}
}

/** `p1` <-> `p2`: a 2-member Property<->Property cyclic SCC. */
const propPropCyclePlugin = createWidgetPlugin('graph-prop-prop-cycle')
	.interfaces<PropPropCycleInterfaces>()
	.properties(properties =>
		properties
			.p1({
				registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p2') }),
				compute: () => null,
			})
			.p2({
				registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p1') }),
				compute: () => null,
			}),
	)
	.done()

interface MethodOnlyCycleInterfaces {
	methods: {
		m1: () => unknown
		m2: () => unknown
	}
}

/** `m1` <-> `m2` with no Property participant: a valid, standalone method-only cyclic SCC. */
const methodOnlyCyclePlugin = createWidgetPlugin('graph-method-only-cycle')
	.interfaces<MethodOnlyCycleInterfaces>()
	.methods(methods =>
		methods
			.m1({
				registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('m2') }),
				validateArgs: (args): args is [] => args.length === 0,
				execute: () => null,
			})
			.m2({
				registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('m1') }),
				validateArgs: (args): args is [] => args.length === 0,
				execute: () => null,
			}),
	)
	.done()

const system = createWidgetSystem({
	plugins: [
		writeChain3Plugin,
		pureMethodPlugin,
		selfLoopPlugin,
		propMethodCyclePlugin,
		propPropCyclePlugin,
		methodOnlyCyclePlugin,
	],
})

function inspectRootOf(type: string) {
	const blueprint = system.createBlueprint({ id: 'root', type })
	const inspection = inspectBlueprint(blueprint)
	const root = inspection.getNode(inspection.rootNodeId)!
	if (!root.resolved)
		throw new Error('test fixture: expected a resolved root')
	return { inspection, root }
}

/** Normalizes one invalid cycle's members into a comparable set (order is a compiler detail, not identity). */
function memberSet(members: readonly { readonly nodeId: unknown, readonly member: { readonly type: string, readonly name: string } }[]): string[] {
	return members.map(ref => `${ref.member.type}:${ref.member.name}`)
		.sort()
}

describe('transitivelyWrites', () => {
	it('propagates true through an A -> B -> C -> state.set chain', () => {
		const { root } = inspectRootOf('graph-write-chain-3')
		const byName = (name: string) => root.methods.find(method => method.name === name)!

		expect(byName('a').transitivelyWrites)
			.toBe(true)
		expect(byName('b').transitivelyWrites)
			.toBe(true)
		expect(byName('c').transitivelyWrites)
			.toBe(true)
	})

	it('is false for a pure method with no write effect', () => {
		const { root } = inspectRootOf('graph-pure-method')
		expect(root.methods.find(method => method.name === 'noop')!.transitivelyWrites)
			.toBe(false)
	})
})

describe('invalid SCC projection', () => {
	it('a Property self-loop is present as a one-member invalid cycle', () => {
		const { inspection } = inspectRootOf('graph-self-loop')
		expect(inspection.invalidCycles)
			.toHaveLength(1)
		expect(memberSet(inspection.invalidCycles[0]!.members))
			.toEqual(['property:loop'])
	})

	it('a Property<->Method mixed cycle is present with both members as a set', () => {
		const { inspection } = inspectRootOf('graph-prop-method-cycle')
		expect(inspection.invalidCycles)
			.toHaveLength(1)
		expect(memberSet(inspection.invalidCycles[0]!.members))
			.toEqual(['method:m', 'property:p'])
	})

	it('invalidCycles[].members follows the normative semantic member order verbatim — properties before methods, declaration order — never sorted away (review round 1, finding 5)', () => {
		const { inspection: mixedInspection, root: mixedRoot } = inspectRootOf('graph-prop-method-cycle')
		expect(mixedInspection.invalidCycles[0]!.members)
			.toEqual([
				{ nodeId: mixedRoot.nodeId, member: { type: 'property', name: 'p' } },
				{ nodeId: mixedRoot.nodeId, member: { type: 'method', name: 'm' } },
			])

		const { inspection: propPropInspection, root: propPropRoot } = inspectRootOf('graph-prop-prop-cycle')
		expect(propPropInspection.invalidCycles[0]!.members)
			.toEqual([
				{ nodeId: propPropRoot.nodeId, member: { type: 'property', name: 'p1' } },
				{ nodeId: propPropRoot.nodeId, member: { type: 'property', name: 'p2' } },
			])
	})

	it('a Property<->Property cycle is present with both members', () => {
		const { inspection } = inspectRootOf('graph-prop-prop-cycle')
		expect(inspection.invalidCycles)
			.toHaveLength(1)
		expect(memberSet(inspection.invalidCycles[0]!.members))
			.toEqual(['property:p1', 'property:p2'])
	})

	it('a Method-only cycle never appears in invalidCycles', () => {
		const { inspection } = inspectRootOf('graph-method-only-cycle')
		expect(inspection.invalidCycles)
			.toEqual([])
	})

	it('a valid Blueprint (no cycles at all) has an empty invalidCycles list', () => {
		const { inspection } = inspectRootOf('graph-pure-method')
		expect(inspection.invalidCycles)
			.toEqual([])
	})
})
