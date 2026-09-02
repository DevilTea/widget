/**
 * Conformance coverage for diagnostic #10 COMMENT 26 §5 ("Dependency compilation").
 *
 * Exercises only the public contract (`../index`): parent/widget target resolution cardinality,
 * `.optional()`'s target-existence-only meaning, missing-capability/member diagnostics, the
 * no-graph-edge behavior of an absent compiled dependency, and the exclusion of consumer `.validate()`
 * refinements from the stable `BlueprintDependencyReference`.
 *
 * Normative source: diagnostic #10 amendments "dependency resolution and compiled-edge invariants"
 * (COMMENT 11), "graph-analysis diagnostics" (COMMENT 12) and "Blueprint diagnostic locations and
 * dependency diagnostic surface" (COMMENT 13), consolidated handoff §8/§9.
 */

import type {
	AnyWidgetPluginTuple,
	BlueprintDependencyDiagnostic,
	BlueprintDependencyReference,
	BlueprintDiagnostic,
	DependencyBuilder,
	UnknownTargetDependencyOperations,
	WidgetSystemBlueprint,
} from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

// -------------------------------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------------------------------

interface ContainerInterfaces {
	slots: 'child'
}

const containerPlugin = createWidgetPlugin('container')
	.description('Test widget')
	.interfaces<ContainerInterfaces>()
	.slots({ child: { description: 'Test slot' } })
	.done()

interface LeafInterfaces {
	state: {
		count: number
	}
	properties: {
		double: number | null
	}
	methods: {
		bump: (amount: number) => number | null
	}
}

/** A target with every capability, used for "missing member" (capability present, member absent). */
const leafPlugin = createWidgetPlugin('leaf')
	.description('Test widget')
	.interfaces<LeafInterfaces>()
	.state(state => state.count({
		validate: (input): input is number => typeof input === 'number',
	}))
	.properties(properties => properties.double({
		compute: () => null,
	}))
	.methods(methods => methods.bump({
		registerDeps: ({ dep }) => ({ setCount: dep.self.state.set('count') }),
		validateArgs: (args): args is [number] => args.length === 1 && typeof args[0] === 'number',
		execute: () => null,
	}))
	.done()

interface ProbeRawConfig {
	readonly widgetId: string | null
	readonly optional: boolean
	readonly op: 'state' | 'property' | 'method'
	readonly key: string
	readonly withValidate?: boolean
}

interface ProberInterfaces {
	config: {
		raw: ProbeRawConfig
		resolved: ProbeRawConfig
	}
	properties: {
		probe: unknown
	}
}

function pickProberTarget(
	dep: DependencyBuilder<ProberInterfaces, 'property'>,
	probeConfig: ProbeRawConfig,
): UnknownTargetDependencyOperations<'property', boolean> {
	const base = probeConfig.widgetId === null ? dep.parent : dep.widget(probeConfig.widgetId)
	return (probeConfig.optional ? base.optional() : base) as unknown as UnknownTargetDependencyOperations<'property', boolean>
}

/**
 * A single configurable property whose one dependency leaf is entirely driven by resolved config, so
 * every parent/widget resolution scenario below is just a different raw `config` payload.
 */
const proberPlugin = createWidgetPlugin('prober')
	.description('Test widget')
	.interfaces<ProberInterfaces>()
	.config({
		description: 'Test config',
		validate: (input): input is ProbeRawConfig => typeof input === 'object' && input !== null,
		resolve: raw => raw ?? { widgetId: null, optional: false, op: 'property', key: '__missing__' },
	})
	.properties(properties => properties.probe({
		registerDeps: ({ dep, config }) => {
			const target = pickProberTarget(dep, config)
			if (config.op === 'state')
				return { probe: target.state.get(config.key) }
			if (config.op === 'method')
				return { probe: target.methods.invoke(config.key) }

			const propertyExpr = target.properties.get(config.key)
			return {
				probe: config.withValidate
					? propertyExpr.validate((_value): _value is unknown => true)
					: propertyExpr,
			}
		},
		compute: () => null,
	}))
	.done()

const system = createWidgetSystem({
	plugins: [containerPlugin, leafPlugin, proberPlugin],
})

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function dependencyDiagnosticsOf<Plugins extends AnyWidgetPluginTuple>(
	diagnostics: readonly BlueprintDiagnostic<Plugins>[],
): BlueprintDependencyDiagnostic<Plugins>[] {
	const result: BlueprintDependencyDiagnostic<Plugins>[] = []
	for (const diagnostic of diagnostics) {
		if (diagnostic.code.includes('dependency'))
			result.push(diagnostic as BlueprintDependencyDiagnostic<Plugins>)
	}
	return result
}

function dependencyOf(diagnostic: BlueprintDependencyDiagnostic): BlueprintDependencyReference | undefined {
	return 'dependency' in diagnostic ? diagnostic.dependency : undefined
}

function widgetIdOf(diagnostic: BlueprintDependencyDiagnostic): string | undefined {
	const dependency = dependencyOf(diagnostic)
	return dependency?.target.type === 'widget' ? dependency.target.widgetId : undefined
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
// Tests
// -------------------------------------------------------------------------------------------------

describe('target cardinality 0', () => {
	it('required dep.parent with no parent produces a dependency diagnostic with no related target', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'prober',
			config: { widgetId: null, optional: false, op: 'property', key: 'anything' },
		})

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
		const source = dependencyDiagnosticsOf(diagnostics)[0]!
		expect(source.location.type)
			.toBe('property')
		if (source.location.type !== 'property')
			throw new Error('test fixture: expected a property diagnostic location')
		expect(source.location.name)
			.toBe('probe')
		expect(dependencyOf(source))
			.toEqual({
				target: { type: 'parent', optional: false },
				operation: { type: 'property-get', name: 'anything' },
			})
		expect(source.related)
			.toBeUndefined()
	})

	it('optional dep.parent with no parent compiles to an absent dependency; the Blueprint stays valid', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'prober',
			config: { widgetId: null, optional: true, op: 'property', key: 'anything' },
		})

		expectValid(blueprint)
	})

	it('required dep.widget(id) with an unknown id produces a dependency diagnostic with no related target', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'prober',
			config: { widgetId: 'does-not-exist', optional: false, op: 'property', key: 'anything' },
		})

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(1)
		const source = dependencyDiagnosticsOf(diagnostics)[0]!
		expect(dependencyOf(source))
			.toEqual({
				target: { type: 'widget', widgetId: 'does-not-exist', optional: false },
				operation: { type: 'property-get', name: 'anything' },
			})
		expect(source.related)
			.toBeUndefined()
	})

	it('optional dep.widget(id) with an unknown id compiles to an absent dependency; the Blueprint stays valid', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'prober',
			config: { widgetId: 'does-not-exist', optional: true, op: 'property', key: 'anything' },
		})

		expectValid(blueprint)
	})
})

describe('target cardinality > 1 (duplicate widget id)', () => {
	it('produces a dependency diagnostic for both a required and an optional dep.widget(id); optional never suppresses ambiguity', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: {
				child: [
					{ id: 'dup', type: 'leaf' },
					{ id: 'dup', type: 'leaf' },
					{ id: 'p-required', type: 'prober', config: { widgetId: 'dup', optional: false, op: 'property', key: 'double' } },
					{ id: 'p-optional', type: 'prober', config: { widgetId: 'dup', optional: true, op: 'property', key: 'double' } },
				],
			},
		})

		const diagnostics = expectInvalid(blueprint)
		const children = blueprint.getChildrenAt(blueprint.root, 'child')
		const dupA = children[0]!
		const dupB = children[1]!

		const ambiguous = dependencyDiagnosticsOf(diagnostics)
			.filter(
				source => widgetIdOf(source) === 'dup',
			)
		expect(ambiguous)
			.toHaveLength(2)
		for (const source of ambiguous) {
			expect(source.related)
				.toHaveLength(2)
			const relatedNodes = source.related?.map(location => location.node)
			expect(relatedNodes)
				.toContain(dupA)
			expect(relatedNodes)
				.toContain(dupB)
		}

		const optionalFlags = ambiguous
			.map(source => (dependencyOf(source)!.target as { optional: boolean }).optional)
			.sort()
		expect(optionalFlags)
			.toEqual([false, true])
	})
})

describe('unresolved target', () => {
	it('produces a dependency diagnostic for both a required and an optional dep.widget(id); optional never suppresses it', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: {
				child: [
					{ id: 'ghost', type: 'not-a-registered-plugin' },
					{ id: 'p-required', type: 'prober', config: { widgetId: 'ghost', optional: false, op: 'property', key: 'x' } },
					{ id: 'p-optional', type: 'prober', config: { widgetId: 'ghost', optional: true, op: 'property', key: 'x' } },
				],
			},
		})

		const diagnostics = expectInvalid(blueprint)
		const ghostNode = blueprint.getChildrenAt(blueprint.root, 'child')[0]!

		const unresolved = dependencyDiagnosticsOf(diagnostics)
			.filter(
				source => widgetIdOf(source) === 'ghost',
			)
		expect(unresolved)
			.toHaveLength(2)
		for (const source of unresolved) {
			expect(source.related)
				.toHaveLength(1)
			expect(source.related?.[0]?.type)
				.toBe('widget')
			expect(source.related?.[0]?.node)
				.toBe(ghostNode)
		}
	})
})

describe('missing capability', () => {
	it.each(['state', 'property', 'method'] as const)(
		'missing %s capability produces a dependency diagnostic for both required and optional targets, related to the resolved target widget',
		(op) => {
			const blueprint = system.createBlueprint({
				id: 'root',
				type: 'container',
				slots: {
					child: [
						{ id: 'no-cap', type: 'container' },
						{ id: 'p-required', type: 'prober', config: { widgetId: 'no-cap', optional: false, op, key: 'x' } },
						{ id: 'p-optional', type: 'prober', config: { widgetId: 'no-cap', optional: true, op, key: 'x' } },
					],
				},
			})

			const diagnostics = expectInvalid(blueprint)
			const noCapNode = blueprint.getChildrenAt(blueprint.root, 'child')[0]!

			const probeDiagnostics = dependencyDiagnosticsOf(diagnostics)
				.filter(
					source => widgetIdOf(source) === 'no-cap',
				)
			expect(probeDiagnostics)
				.toHaveLength(2)
			for (const source of probeDiagnostics) {
				expect(source.related)
					.toHaveLength(1)
				expect(source.related?.[0]?.type)
					.toBe('widget')
				expect(source.related?.[0]?.node)
					.toBe(noCapNode)
			}

			const optionalFlags = probeDiagnostics
				.map(source => (dependencyOf(source)!.target as { optional: boolean }).optional)
				.sort()
			expect(optionalFlags)
				.toEqual([false, true])
		},
	)
})

describe('missing member', () => {
	it.each(['state', 'property', 'method'] as const)(
		'missing %s member produces a dependency diagnostic for both required and optional targets, related to the resolved target widget',
		(op) => {
			const blueprint = system.createBlueprint({
				id: 'root',
				type: 'container',
				slots: {
					child: [
						{ id: 'leaf-target', type: 'leaf' },
						{ id: 'p-required', type: 'prober', config: { widgetId: 'leaf-target', optional: false, op, key: 'nope' } },
						{ id: 'p-optional', type: 'prober', config: { widgetId: 'leaf-target', optional: true, op, key: 'nope' } },
					],
				},
			})

			const diagnostics = expectInvalid(blueprint)
			const leafTargetNode = blueprint.getChildrenAt(blueprint.root, 'child')[0]!

			const probeDiagnostics = dependencyDiagnosticsOf(diagnostics)
				.filter(
					source => widgetIdOf(source) === 'leaf-target',
				)
			expect(probeDiagnostics)
				.toHaveLength(2)
			for (const source of probeDiagnostics) {
				expect(source.related)
					.toHaveLength(1)
				expect(source.related?.[0]?.type)
					.toBe('widget')
				expect(source.related?.[0]?.node)
					.toBe(leafTargetNode)
			}

			const optionalFlags = probeDiagnostics
				.map(source => (dependencyOf(source)!.target as { optional: boolean }).optional)
				.sort()
			expect(optionalFlags)
				.toEqual([false, true])
		},
	)
})

describe('absent compiled dependencies', () => {
	it('an optional absent dep.widget(id).methods.invoke on a Property creates no graph edge and does not invalidate the Blueprint', () => {
		// "writer" declares a directly-writeful method named "bump". The probing Property optionally
		// targets a widget id that does not exist in this tree at all, invoking a method with the same
		// name. If an absent dependency incorrectly contributed a graph/effect/cycle edge (e.g. through a
		// name-based rather than node-id-based resolution bug), this would surface as a purity diagnostic.
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: {
				child: [
					{ id: 'writer', type: 'leaf' },
					{ id: 'p', type: 'prober', config: { widgetId: 'does-not-exist', optional: true, op: 'method', key: 'bump' } },
				],
			},
		})

		expectValid(blueprint)
	})
})

describe('dependency reference stability', () => {
	it('a consumer .validate() refinement does not change the stable BlueprintDependencyReference', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: {
				child: [
					{ id: 'leaf-target', type: 'leaf' },
					{ id: 'pA', type: 'prober', config: { widgetId: 'leaf-target', optional: false, op: 'property', key: 'missingProp' } },
					{ id: 'pB', type: 'prober', config: { widgetId: 'leaf-target', optional: false, op: 'property', key: 'missingProp', withValidate: true } },
				],
			},
		})

		const diagnostics = expectInvalid(blueprint)
		expect(diagnostics)
			.toHaveLength(2)

		const sources = dependencyDiagnosticsOf(diagnostics)
		const sourceA = sources.find(source => source.location.type === 'property' && source.location.node.resolved && source.location.node.id === 'pA')
		const sourceB = sources.find(source => source.location.type === 'property' && source.location.node.resolved && source.location.node.id === 'pB')
		expect(sourceA ? dependencyOf(sourceA) : undefined)
			.toBeDefined()
		expect(sourceB ? dependencyOf(sourceB) : undefined)
			.toBeDefined()

		// Same target/operation, one built with a chained `.validate()` and one without: the stable
		// reference must be identical either way.
		expect(sourceA ? dependencyOf(sourceA) : undefined)
			.toEqual(sourceB ? dependencyOf(sourceB) : undefined)
		expect(Object.keys(dependencyOf(sourceA!)!)
			.sort())
			.toEqual(['operation', 'target'])
	})
})
