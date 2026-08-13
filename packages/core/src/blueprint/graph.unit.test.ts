/**
 * Conformance coverage for issue #10 COMMENT 26 §6 ("Property safety / graph analysis").
 *
 * Exercises only the public contract (`../index`): Method write-effect propagation observed through
 * Property purity diagnostics, and the evaluation-cycle validity rule that only a cyclic SCC containing
 * at least one Property invalidates the Blueprint (COMMENT 18 — method-only cycles, including ones a
 * Property can reach without the cycle returning to it, must stay valid).
 *
 * Normative source: issue #10 amendments "graph-analysis diagnostics" (COMMENT 12) and "simplify method
 * graph semantics; only Property safety is normative" (COMMENT 18), consolidated handoff §9.
 */

import type { AnyWidgetPluginTuple, BlueprintDependencyIssueSource, BlueprintIssue, WidgetSystemBlueprint } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

// -------------------------------------------------------------------------------------------------
// Fixtures — every dependency below targets `self`, so cardinality/resolution concerns (covered by
// deps.unit.test.ts) never interfere with the graph-analysis semantics under test here.
// -------------------------------------------------------------------------------------------------

interface WriteDirectInterfaces {
	state: {
		value: number
	}
	properties: {
		reader: unknown
	}
	methods: {
		write: (value: number) => number | null
	}
}

/** Property `reader` directly invokes the directly-writeful method `write`. */
const writeDirectPlugin = createWidgetPlugin('write-direct')
	.interfaces<WriteDirectInterfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.properties(properties => properties.reader({
		registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('write') }),
		compute: () => null,
	}))
	.methods(methods => methods.write({
		registerDeps: ({ dep }) => ({ setValue: dep.self.state.set('value') }),
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: () => null,
	}))
	.done()

interface WriteNoInvokeInterfaces {
	state: {
		value: number
	}
	methods: {
		write: (value: number) => number | null
	}
}

/** A directly-writeful method that no Property depends on: writeful methods are valid by themselves. */
const writeNoInvokePlugin = createWidgetPlugin('write-no-invoke')
	.interfaces<WriteNoInvokeInterfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.methods(methods => methods.write({
		registerDeps: ({ dep }) => ({ setValue: dep.self.state.set('value') }),
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: () => null,
	}))
	.done()

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

/** Property `reader` -> method `a` -> method `b` -> method `c` -> direct `state.set` (3-layer chain). */
const writeChain3Plugin = createWidgetPlugin('write-chain-3')
	.interfaces<WriteChain3Interfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
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

interface DedupEdgeInterfaces {
	state: {
		value: number
	}
	properties: {
		reader: unknown
	}
	methods: {
		write: (value: number) => number | null
	}
}

/** Property `reader` registers the *same* Property->Method edge twice, through different container placements. */
const dedupEdgePlugin = createWidgetPlugin('dedup-edge')
	.interfaces<DedupEdgeInterfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.properties(properties => properties.reader({
		registerDeps: ({ dep }) => ({
			direct: dep.self.methods.invoke('write'),
			nested: {
				again: dep.self.methods.invoke('write'),
			},
		}),
		compute: () => null,
	}))
	.methods(methods => methods.write({
		registerDeps: ({ dep }) => ({ setValue: dep.self.state.set('value') }),
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: () => null,
	}))
	.done()

interface SelfLoopInterfaces {
	properties: {
		loop: unknown
	}
}

/** Property `loop` depends on its own `properties.get`: a self-loop singleton SCC. */
const selfLoopPlugin = createWidgetPlugin('self-loop-prop')
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

/** Property `p` -> method `m` -> property `p`: a 2-member cyclic SCC containing one Property. */
const propMethodCyclePlugin = createWidgetPlugin('prop-method-cycle')
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

interface MethodOnlyPureInterfaces {
	methods: {
		m1: () => unknown
		m2: () => unknown
	}
}

/** `m1` <-> `m2` mutual recursion with no Property participant: a standalone method-only cyclic SCC. */
const methodOnlyPurePlugin = createWidgetPlugin('method-only-pure')
	.interfaces<MethodOnlyPureInterfaces>()
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

interface PropReachSafeInterfaces {
	properties: {
		p: unknown
	}
	methods: {
		m1: () => unknown
		m2: () => unknown
	}
}

/**
 * Property `p` -> method `m1` <-> method `m2`. `p` reaches the method-only cyclic SCC `{m1, m2}` but the
 * cycle never returns to `p`. This is exactly the case the superseded property-frontier rule used to
 * invalidate; COMMENT 18 requires it to stay valid.
 */
const propReachSafePlugin = createWidgetPlugin('prop-reach-method-only-safe')
	.interfaces<PropReachSafeInterfaces>()
	.properties(properties => properties.p({
		registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('m1') }),
		compute: () => null,
	}))
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

interface MultiPropertyCycleInterfaces {
	properties: {
		p1: unknown
		p2: unknown
	}
	methods: {
		m: () => unknown
	}
}

/** `p1` -> `p2` -> `m` -> `p1`: a 3-member cyclic SCC containing two Properties and one Method. */
const multiPropertyCyclePlugin = createWidgetPlugin('multi-property-cycle')
	.interfaces<MultiPropertyCycleInterfaces>()
	.properties(properties =>
		properties
			.p1({
				registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p2') }),
				compute: () => null,
			})
			.p2({
				registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('m') }),
				compute: () => null,
			}),
	)
	.methods(methods => methods.m({
		registerDeps: ({ dep }) => ({ read: dep.self.properties.get('p1') }),
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => null,
	}))
	.done()

const system = createWidgetSystem({
	plugins: [
		writeDirectPlugin,
		writeNoInvokePlugin,
		writeChain3Plugin,
		dedupEdgePlugin,
		selfLoopPlugin,
		propMethodCyclePlugin,
		methodOnlyPurePlugin,
		propReachSafePlugin,
		multiPropertyCyclePlugin,
	],
})

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function dependencyIssuesOf<Plugins extends AnyWidgetPluginTuple>(
	issues: readonly BlueprintIssue<Plugins>[],
): BlueprintDependencyIssueSource<Plugins>[] {
	const result: BlueprintDependencyIssueSource<Plugins>[] = []
	for (const issue of issues) {
		if (issue.source.type === 'dependency')
			result.push(issue.source)
	}
	return result
}

function expectInvalid<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
): readonly BlueprintIssue<Plugins>[] {
	expect(blueprint.status)
		.toBe('invalid')
	if (blueprint.status !== 'invalid')
		throw new Error('unreachable: blueprint expected to be invalid')
	return blueprint.getCollectedIssues()
}

function expectValid<Plugins extends AnyWidgetPluginTuple>(blueprint: WidgetSystemBlueprint<Plugins>): void {
	expect(blueprint.status)
		.toBe('valid')
	if (blueprint.status !== 'valid')
		throw new Error('unreachable: blueprint expected to be valid')
	expect(blueprint.getCollectedIssues())
		.toEqual([])
}

// -------------------------------------------------------------------------------------------------
// Write-effect cases
// -------------------------------------------------------------------------------------------------

describe('write-effect analysis', () => {
	it('a direct state.set makes a Method writeful, invalidating a Property that invokes it directly', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'write-direct' })

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(1)
		const source = dependencyIssuesOf(issues)[0]!
		expect(source.member)
			.toEqual({ type: 'property', name: 'reader' })
		expect(source.dependency?.target)
			.toEqual({ type: 'self' })
		expect(source.dependency?.operation)
			.toEqual({ type: 'method-invoke', name: 'write' })
		expect(source.related)
			.toEqual([{ type: 'method', node: blueprint.root, name: 'write' }])
	})

	it('a writeful Method that no Property invokes does not invalidate the Blueprint', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'write-no-invoke' })

		expectValid(blueprint)
	})

	it('write effect propagates transitively through a 3-layer Method invocation chain, but the purity issue stays localized to the direct edge', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'write-chain-3' })

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(1)
		const source = dependencyIssuesOf(issues)[0]!
		expect(source.member)
			.toEqual({ type: 'property', name: 'reader' })
		expect(source.dependency?.operation)
			.toEqual({ type: 'method-invoke', name: 'a' })
		// Only the direct target ("a") is related; the transitive chain ("b", "c") is not expanded.
		expect(source.related)
			.toEqual([{ type: 'method', node: blueprint.root, name: 'a' }])
	})

	it('registering the same semantic Property->Method edge through two different container placements still yields exactly one purity issue', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'dedup-edge' })

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(1)
	})
})

// -------------------------------------------------------------------------------------------------
// Evaluation-cycle cases
// -------------------------------------------------------------------------------------------------

describe('evaluation cycles', () => {
	it('a Property that reads its own value forms an invalid self-cycle with no related member', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'self-loop-prop' })

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(1)
		const source = dependencyIssuesOf(issues)[0]!
		expect(source.member)
			.toEqual({ type: 'property', name: 'loop' })
		expect(source.dependency)
			.toBeUndefined()
		expect(source.related)
			.toBeUndefined()
	})

	it('property -> Method -> same Property is an invalid cycle owned only by the Property', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'prop-method-cycle' })

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(1)
		const source = dependencyIssuesOf(issues)[0]!
		expect(source.member)
			.toEqual({ type: 'property', name: 'p' })
		expect(source.dependency)
			.toBeUndefined()
		expect(source.related)
			.toEqual([{ type: 'method', node: blueprint.root, name: 'm' }])
	})

	it('a Method<->Method cycle with no Property participant is valid (COMMENT 18 regression)', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'method-only-pure' })

		expectValid(blueprint)
	})

	it('a Property reaching a method-only cyclic SCC without the cycle returning to it stays valid', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'prop-reach-method-only-safe' })

		expectValid(blueprint)
	})

	it('an invalid SCC produces one cycle issue per Property participant and none for Method participants', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'multi-property-cycle' })

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(2)
		const sources = dependencyIssuesOf(issues)

		expect(sources.every(source => source.dependency === undefined))
			.toBe(true)
		expect(sources.some(source => source.member.type === 'method'))
			.toBe(false)

		const p1Issue = sources.find(source => source.member.type === 'property' && source.member.name === 'p1')
		const p2Issue = sources.find(source => source.member.type === 'property' && source.member.name === 'p2')
		expect(p1Issue?.related)
			.toEqual([
				{ type: 'property', node: blueprint.root, name: 'p2' },
				{ type: 'method', node: blueprint.root, name: 'm' },
			])
		expect(p2Issue?.related)
			.toEqual([
				{ type: 'property', node: blueprint.root, name: 'p1' },
				{ type: 'method', node: blueprint.root, name: 'm' },
			])
	})
})
