/**
 * Conformance coverage for diagnostic #10 COMMENT 26 §6 ("Property safety / graph analysis").
 *
 * Exercises only the public contract (`../index`): Method write-effect propagation observed through
 * Property purity diagnostics, and the evaluation-cycle validity rule that only a cyclic SCC containing
 * at least one Property invalidates the Blueprint (COMMENT 18 — method-only cycles, including ones a
 * Property can reach without the cycle returning to it, must stay valid).
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 amendments "graph-analysis diagnostics" (COMMENT 12) and "simplify method
 * graph semantics; only Property safety is normative" (COMMENT 18), consolidated handoff §9.
 */

import type { AnyWidgetPluginTuple, BlueprintDependencyDiagnostic, BlueprintDependencyReference, BlueprintDiagnostic, WidgetSystemBlueprint } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from '../inspection'

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
	.description('Test widget')
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
	.description('Test widget')
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
	.description('Test widget')
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

interface CrossWidgetWriterInterfaces {
	state: {
		value: number
	}
	methods: {
		write: (value: number) => unknown
	}
}

/** A child Widget whose Method writes State directly. */
const crossWidgetWriterPlugin = createWidgetPlugin('cross-widget-writer')
	.description('Cross-widget writer')
	.interfaces<CrossWidgetWriterInterfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.methods(methods => methods.write({
		registerDeps: ({ dep }) => ({ setValue: dep.self.state.set('value') }),
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: () => null,
	}))
	.done()

interface CrossWidgetRelayInterfaces {
	slots: 'children'
	properties: {
		reader: unknown
	}
	methods: {
		outer: (value: number) => unknown
	}
}

/** Parent `reader` -> `outer` -> child `write` -> child `state.set`. */
const crossWidgetRelayPlugin = createWidgetPlugin('cross-widget-relay')
	.description('Cross-widget relay')
	.interfaces<CrossWidgetRelayInterfaces>()
	.slots({ children: { description: 'Child widgets' } })
	.properties(properties => properties.reader({
		registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('outer') }),
		compute: () => null,
	}))
	.methods(methods => methods.outer({
		registerDeps: ({ dep }) => ({ call: dep.widget('writer').methods.invoke('write') }),
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: () => null,
	}))
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
	.description('Test widget')
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
	.description('Test widget')
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
	.description('Test widget')
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
	.description('Test widget')
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
	.description('Test widget')
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
	.description('Test widget')
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
		crossWidgetWriterPlugin,
		crossWidgetRelayPlugin,
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

function dependencyDiagnosticsOf<Plugins extends AnyWidgetPluginTuple>(
	diagnostics: readonly BlueprintDiagnostic<Plugins>[],
): BlueprintDependencyDiagnostic<Plugins>[] {
	const result: BlueprintDependencyDiagnostic<Plugins>[] = []
	for (const diagnostic of diagnostics) {
		if (diagnostic.code === 'property-dependency-has-write-effects' || diagnostic.code === 'property-evaluation-cycle')
			result.push(diagnostic as BlueprintDependencyDiagnostic<Plugins>)
	}
	return result
}

function memberOf(location: { readonly type: string, readonly name?: string }): { type: string, name?: string } {
	return location.type === 'property' || location.type === 'method' ? { type: location.type, name: location.name } : { type: location.type }
}

function dependencyOf(diagnostic: BlueprintDependencyDiagnostic): BlueprintDependencyReference | undefined {
	return 'dependency' in diagnostic ? diagnostic.dependency : undefined
}

function expectInvalid<Plugins extends AnyWidgetPluginTuple>(
	blueprint: WidgetSystemBlueprint<Plugins>,
): readonly BlueprintDiagnostic<Plugins>[] {
	expect(blueprint.status)
		.toBe('invalid')
	if (blueprint.status !== 'invalid')
		throw new Error('unreachable: blueprint expected to be invalid')
	return blueprint.diagnostics
}

function expectValid<Plugins extends AnyWidgetPluginTuple>(blueprint: WidgetSystemBlueprint<Plugins>): void {
	expect(blueprint.status)
		.toBe('valid')
	if (blueprint.status !== 'valid')
		throw new Error('unreachable: blueprint expected to be valid')
	expect(blueprint.diagnostics)
		.toEqual([])
}

// -------------------------------------------------------------------------------------------------
// Write-effect cases
// -------------------------------------------------------------------------------------------------

describe('write-effect analysis', () => {
	it('a direct state.set makes a Method writeful, invalidating a Property that invokes it directly', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'write-direct' })

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
		const source = dependencyDiagnosticsOf(diagnostics)[0]!
		expect(source.location.type)
			.toBe('property')
		if (source.location.type !== 'property')
			throw new Error('test fixture: expected a property location')
		expect(source.location.name)
			.toBe('reader')
		expect(dependencyOf(source)?.target)
			.toEqual({ type: 'self' })
		expect(dependencyOf(source)?.operation)
			.toEqual({ type: 'method-invoke', name: 'write' })
		expect(source.related?.map(location => location.type === 'method' ? { type: location.type, name: location.name } : { type: location.type }))
			.toEqual([{ type: 'method', name: 'write' }])
	})

	it('a writeful Method that no Property invokes does not invalidate the Blueprint', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'write-no-invoke' })

		expectValid(blueprint)
	})

	it('write effect propagates transitively through a 3-layer Method invocation chain, but the purity diagnostic stays localized to the direct edge', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'write-chain-3' })

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
		const source = dependencyDiagnosticsOf(diagnostics)[0]!
		expect(source.location.type)
			.toBe('property')
		if (source.location.type !== 'property')
			throw new Error('test fixture: expected a property location')
		expect(source.location.name)
			.toBe('reader')
		expect(dependencyOf(source)?.operation)
			.toEqual({ type: 'method-invoke', name: 'a' })
		// Only the direct target ("a") is related; the transitive chain ("b", "c") is not expanded.
		expect(source.related?.map(location => location.type === 'method' ? { type: location.type, name: location.name } : { type: location.type }))
			.toEqual([{ type: 'method', name: 'a' }])
	})

	it('registering the same semantic Property->Method edge through two different container placements still yields exactly one purity diagnostic', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'dedup-edge' })

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
	})

	it('propagates Method write effects across Widgets before rejecting a Property that reaches the writer', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'cross-widget-relay',
			slots: { children: [{ id: 'writer', type: 'cross-widget-writer' }] },
		})

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
		const source = dependencyDiagnosticsOf(diagnostics)[0]!
		expect(source.code)
			.toBe('property-dependency-has-write-effects')
		expect(source.location)
			.toMatchObject({ type: 'property', name: 'reader' })
		expect(dependencyOf(source))
			.toMatchObject({ target: { type: 'self' }, operation: { type: 'method-invoke', name: 'outer' } })
		expect(source.related?.map(location => location.type === 'method' ? { type: location.type, name: location.name } : { type: location.type }))
			.toEqual([{ type: 'method', name: 'outer' }])
	})
})

// -------------------------------------------------------------------------------------------------
// Evaluation-cycle cases
// -------------------------------------------------------------------------------------------------

describe('evaluation cycles', () => {
	it('a Property that reads its own value forms an invalid self-cycle whose related list holds only itself', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'self-loop-prop' })

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
		const source = dependencyDiagnosticsOf(diagnostics)[0]!
		expect(source.location.type)
			.toBe('property')
		if (source.location.type !== 'property')
			throw new Error('test fixture: expected a property location')
		expect(source.location.name)
			.toBe('loop')
		expect(dependencyOf(source))
			.toBeUndefined()
		expect(source.related?.map(memberOf))
			.toEqual([{ type: 'property', name: 'loop' }])
		expect(source.related?.[0]?.node)
			.toBe(source.location.node)
	})

	it('property -> Method -> same Property is an invalid cycle owned only by the Property', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'prop-method-cycle' })

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
		const source = dependencyDiagnosticsOf(diagnostics)[0]!
		expect(source.location.type)
			.toBe('property')
		if (source.location.type !== 'property')
			throw new Error('test fixture: expected a property location')
		expect(source.location.name)
			.toBe('p')
		expect(dependencyOf(source))
			.toBeUndefined()
		expect(source.related?.map(memberOf))
			.toEqual([{ type: 'property', name: 'p' }, { type: 'method', name: 'm' }])
	})

	it('a Method<->Method cycle with no Property participant is valid (COMMENT 18 regression)', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'method-only-pure' })

		expectValid(blueprint)
	})

	it('a Property reaching a method-only cyclic SCC without the cycle returning to it stays valid', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'prop-reach-method-only-safe' })

		expectValid(blueprint)
	})

	it('an invalid SCC produces one cycle diagnostic per Property participant and none for Method participants', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'multi-property-cycle' })

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(2)
		const sources = dependencyDiagnosticsOf(diagnostics)

		expect(sources.every(source => dependencyOf(source) === undefined))
			.toBe(true)
		expect(sources.some(source => source.location.type === 'method'))
			.toBe(false)

		const p1Diagnostic = sources.find(source => source.location.type === 'property' && source.location.name === 'p1')
		const p2Diagnostic = sources.find(source => source.location.type === 'property' && source.location.name === 'p2')
		const everyMember = [
			{ type: 'property', name: 'p1' },
			{ type: 'property', name: 'p2' },
			{ type: 'method', name: 'm' },
		]
		expect(p1Diagnostic?.related?.map(memberOf))
			.toEqual(everyMember)
		expect(p2Diagnostic?.related?.map(memberOf))
			.toEqual(everyMember)
		expect(p2Diagnostic?.related)
			.toBe(p1Diagnostic?.related)
	})
})

// -------------------------------------------------------------------------------------------------
// Write-effect propagation along a long Method chain
// -------------------------------------------------------------------------------------------------

interface ChainLinkInterfaces {
	config: {
		raw: { readonly next: string | null, readonly writes: boolean }
		resolved: { readonly next: string | null, readonly writes: boolean }
	}
	state: {
		value: number
	}
	methods: {
		step: () => unknown
	}
}

/**
 * Method `step` invokes the next link's `step`; the link without a successor writes State only when its
 * config says so, so one chain can end in a write while another one stays pure.
 */
const chainLinkPlugin = createWidgetPlugin('chain-link')
	.description('Test widget')
	.interfaces<ChainLinkInterfaces>()
	.config({
		description: 'Test config',
		validate: (input): input is ChainLinkInterfaces['config']['raw'] => typeof input === 'object' && input !== null,
		resolve: raw => raw ?? { next: null, writes: false },
	})
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.methods(methods => methods.step({
		registerDeps: ({ dep, config }) => ({
			effect: config.next !== null
				? dep.widget(config.next).methods.invoke('step')
				: config.writes ? dep.self.state.set('value') : dep.self.state.get('value'),
		}),
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => null,
	}))
	.done()

const chainHolderPlugin = createWidgetPlugin('chain-holder')
	.description('Test widget')
	.interfaces<{ slots: 'items' }>()
	.slots({ items: { description: 'Test slot' } })
	.done()

describe('write-effect propagation along a long Method chain', () => {
	it('marks every link transitivelyWrites when only the last Method writes State, and none of an independent pure chain', () => {
		const chainSystem = createWidgetSystem({ plugins: [chainLinkPlugin, chainHolderPlugin] })
		const writingLength = 300
		const pureLength = 40
		const link = (prefix: string, index: number, length: number, writes: boolean) => ({
			id: `${prefix}${index}`,
			type: 'chain-link',
			config: { next: index + 1 < length ? `${prefix}${index + 1}` : null, writes },
		})
		const blueprint = chainSystem.createBlueprint({
			id: 'root',
			type: 'chain-holder',
			slots: {
				items: [
					...Array.from({ length: writingLength }, (_, index) => link('w', index, writingLength, true)),
					...Array.from({ length: pureLength }, (_, index) => link('p', index, pureLength, false)),
				],
			},
		})
		expectValid(blueprint)

		const inspection = inspectBlueprint(blueprint)
		const writesById = new Map<string, boolean>()
		for (const entry of inspection.nodes) {
			if (entry.resolved && entry.node.type === 'chain-link')
				writesById.set(entry.node.id, entry.methods.find(method => method.name === 'step')!.transitivelyWrites)
		}

		expect(writesById.size)
			.toBe(writingLength + pureLength)
		for (let index = 0; index < writingLength; index++) {
			expect(writesById.get(`w${index}`))
				.toBe(true)
		}
		for (let index = 0; index < pureLength; index++) {
			expect(writesById.get(`p${index}`))
				.toBe(false)
		}
	})
})

// -------------------------------------------------------------------------------------------------
// Evaluation cycles across Widgets
// -------------------------------------------------------------------------------------------------

interface RingInterfaces {
	config: {
		raw: { readonly next: string | null }
		resolved: { readonly next: string | null }
	}
	state: {
		value: number
	}
	properties: {
		p: unknown
	}
}

/** Property `p` reads the next ring member's `p`; the member without a successor reads its own State. */
const ringPlugin = createWidgetPlugin('ring')
	.description('Test widget')
	.interfaces<RingInterfaces>()
	.config({
		description: 'Test config',
		validate: (input): input is RingInterfaces['config']['raw'] => typeof input === 'object' && input !== null,
		resolve: raw => raw ?? { next: null },
	})
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
	}))
	.properties(properties => properties.p({
		registerDeps: ({ dep, config }) => ({
			read: config.next !== null
				? dep.widget(config.next).properties.get('p')
				: dep.self.state.get('value'),
		}),
		compute: () => null,
	}))
	.done()

describe('evaluation cycles across Widgets', () => {
	it('reports one diagnostic per ring member, each listing every member in document order, and leaves acyclic readers of the ring alone', () => {
		const ringSystem = createWidgetSystem({ plugins: [ringPlugin, chainHolderPlugin] })
		const ring = (id: string, next: string | null) => ({ id, type: 'ring', config: { next } })
		const blueprint = ringSystem.createBlueprint({
			id: 'root',
			type: 'chain-holder',
			slots: {
				items: [
					ring('c', 'a'),
					ring('a', 'b'),
					ring('b', 'c'),
					ring('reader', 'a'),
					ring('tail', null),
				],
			},
		})

		const diagnostics = expectInvalid(blueprint)
		const relatedIds = (source: BlueprintDependencyDiagnostic) => (source.related ?? []).map((location) => {
			if (location.type !== 'property')
				throw new Error('test fixture: expected a property location')
			return location.node.id
		})
		const cycles = dependencyDiagnosticsOf(diagnostics)
		const ownerOf = (source: BlueprintDependencyDiagnostic) => {
			if (source.location.type !== 'property')
				throw new Error('test fixture: expected a property location')
			return source.location.node.id
		}

		expect(cycles.map(ownerOf))
			.toEqual(['c', 'a', 'b'])
		expect(cycles.map(relatedIds))
			.toEqual([['c', 'a', 'b'], ['c', 'a', 'b'], ['c', 'a', 'b']])
	})

	describe('the related list of a cycle', () => {
		const ringSystem = createWidgetSystem({ plugins: [ringPlugin, chainHolderPlugin] })
		const ring = (id: string, next: string | null) => ({ id, type: 'ring', config: { next } })
		const cyclesOf = (items: readonly object[]) => dependencyDiagnosticsOf(expectInvalid(ringSystem.createBlueprint({ id: 'root', type: 'chain-holder', slots: { items } })))

		it('is one frozen array shared by every diagnostic of the cycle, holding one frozen location per member, the subject included', () => {
			const cycles = cyclesOf([ring('a', 'b'), ring('b', 'c'), ring('c', 'a')])

			expect(cycles)
				.toHaveLength(3)
			const related = cycles[0]!.related
			expect(related)
				.toHaveLength(3)
			for (const diagnostic of cycles) {
				expect(diagnostic.related)
					.toBe(related)
				expect(diagnostic.related)
					.toContain(related![cycles.indexOf(diagnostic)])
				expect(Object.isFrozen(diagnostic))
					.toBe(true)
				expect(Object.isFrozen(diagnostic.location))
					.toBe(true)
			}
			expect(related!.map(location => location.type === 'property' ? [location.node.id, location.name] : null))
				.toEqual([['a', 'p'], ['b', 'p'], ['c', 'p']])
			expect(Object.isFrozen(related))
				.toBe(true)
			expect(related!.every(location => Object.isFrozen(location)))
				.toBe(true)
			expect(new Set(related).size)
				.toBe(3)
		})

		it('is not shared between two separate cycles of one document', () => {
			const cycles = cyclesOf([ring('a', 'b'), ring('b', 'a'), ring('c', 'd'), ring('d', 'c')])

			expect(cycles)
				.toHaveLength(4)
			expect(cycles[1]!.related)
				.toBe(cycles[0]!.related)
			expect(cycles[3]!.related)
				.toBe(cycles[2]!.related)
			expect(cycles[2]!.related)
				.not
				.toBe(cycles[0]!.related)
			const ids = (diagnostic: BlueprintDependencyDiagnostic) => diagnostic.related!.map(location => location.type === 'property' ? location.node.id : null)
			expect(ids(cycles[0]!))
				.toEqual(['a', 'b'])
			expect(ids(cycles[2]!))
				.toEqual(['c', 'd'])
			for (const diagnostic of cycles) {
				expect(Object.isFrozen(diagnostic.related))
					.toBe(true)
				expect(diagnostic.related!.every(location => Object.isFrozen(location)))
					.toBe(true)
			}
		})

		it('stays one shared array for a ring of 5 000 Properties (a per-diagnostic copy took seconds and a gigabyte)', () => {
			const size = 5_000
			const cycles = cyclesOf(Array.from({ length: size }, (_, index) => ring(`n${index}`, `n${(index + 1) % size}`)))

			expect(cycles)
				.toHaveLength(size)
			const related = cycles[0]!.related
			expect(related)
				.toHaveLength(size)
			expect(cycles.every(diagnostic => diagnostic.related === related))
				.toBe(true)
			expect(Object.isFrozen(related))
				.toBe(true)
			expect(related!.every(location => Object.isFrozen(location)))
				.toBe(true)
		})

		it('is the same frozen array on the diagnostics the aggregate and the per-widget lists expose', () => {
			const blueprint = ringSystem.createBlueprint({ id: 'root', type: 'chain-holder', slots: { items: [ring('a', 'b'), ring('b', 'a')] } })
			const aggregate = dependencyDiagnosticsOf(expectInvalid(blueprint))
			const perWidget = blueprint.getChildrenAt(blueprint.root, 'items')
				.flatMap(node => node.diagnostics)
				.filter(diagnostic => diagnostic.code === 'property-evaluation-cycle')

			expect(perWidget)
				.toHaveLength(2)
			for (const diagnostic of perWidget) {
				expect((diagnostic as BlueprintDependencyDiagnostic).related)
					.toBe(aggregate[0]!.related)
			}
		})
	})
})

// -------------------------------------------------------------------------------------------------
// Dependency chains far longer than the engine's call stack
// -------------------------------------------------------------------------------------------------

describe('compiling very long dependency chains', () => {
	// Well above the depth at which a recursive analysis overflows the stack in Node (a few thousand)
	// and on QuickJS's default stack (under a thousand). These tests only compile, they never read.
	const chainLength = 20_000
	const ring = (id: string, next: string | null) => ({ id, type: 'ring', config: { next } })

	it('compiles a valid Blueprint whose Properties form one dependency chain of 20 000 links without throwing', () => {
		const ringSystem = createWidgetSystem({ plugins: [ringPlugin, chainHolderPlugin] })
		const items = Array.from({ length: chainLength }, (_, index) => ring(`n${index}`, index + 1 < chainLength ? `n${index + 1}` : null))

		const blueprint = ringSystem.createBlueprint({ id: 'root', type: 'chain-holder', slots: { items } })

		expectValid(blueprint)
	})

	it('reports the evaluation cycle at the end of a 20 000-link chain without throwing, and only for the cycle members', () => {
		const ringSystem = createWidgetSystem({ plugins: [ringPlugin, chainHolderPlugin] })
		const items = [
			...Array.from({ length: chainLength }, (_, index) => ring(`n${index}`, index + 1 < chainLength ? `n${index + 1}` : 'x')),
			ring('x', 'y'),
			ring('y', 'x'),
		]

		const blueprint = ringSystem.createBlueprint({ id: 'root', type: 'chain-holder', slots: { items } })

		const cycles = dependencyDiagnosticsOf(expectInvalid(blueprint))
		expect(cycles.map(diagnostic => diagnostic.code))
			.toEqual(['property-evaluation-cycle', 'property-evaluation-cycle'])
		expect(cycles.map((diagnostic) => {
			if (diagnostic.location.type !== 'property')
				throw new Error('test fixture: expected a property location')
			return diagnostic.location.node.id
		}))
			.toEqual(['x', 'y'])
	})
})
