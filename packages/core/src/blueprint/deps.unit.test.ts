/**
 * Conformance coverage for issue #10 COMMENT 26 §5 ("Dependency compilation").
 *
 * Exercises only the public contract (`../index`): parent/widget target resolution cardinality,
 * `.optional()`'s target-existence-only meaning, missing-capability/member diagnostics, the
 * no-graph-edge behavior of an absent compiled dependency, and the exclusion of consumer `.validate()`
 * refinements from the stable `BlueprintDependencyReference`.
 *
 * Normative source: issue #10 amendments "dependency resolution and compiled-edge invariants"
 * (COMMENT 11), "graph-analysis diagnostics" (COMMENT 12) and "Blueprint diagnostic locations and
 * dependency issue surface" (COMMENT 13), consolidated handoff §8/§9.
 */

import type {
	AnyWidgetPluginTuple,
	BlueprintDependencyIssueSource,
	BlueprintIssue,
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
	.interfaces<ContainerInterfaces>()
	.slots({ child: {} })
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
	.interfaces<ProberInterfaces>()
	.config({
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
// Tests
// -------------------------------------------------------------------------------------------------

describe('target cardinality 0', () => {
	it('required dep.parent with no parent produces a dependency issue with no related target', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'prober',
			config: { widgetId: null, optional: false, op: 'property', key: 'anything' },
		})

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(1)
		const source = dependencyIssuesOf(issues)[0]!
		expect(source.member)
			.toEqual({ type: 'property', name: 'probe' })
		expect(source.dependency)
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

	it('required dep.widget(id) with an unknown id produces a dependency issue with no related target', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'prober',
			config: { widgetId: 'does-not-exist', optional: false, op: 'property', key: 'anything' },
		})

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(1)
		const source = dependencyIssuesOf(issues)[0]!
		expect(source.dependency)
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
	it('produces a dependency issue for both a required and an optional dep.widget(id); optional never suppresses ambiguity', () => {
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

		const issues = expectInvalid(blueprint)
		const children = blueprint.getChildrenAt(blueprint.root, 'child')
		const dupA = children[0]!
		const dupB = children[1]!

		const ambiguous = dependencyIssuesOf(issues)
			.filter(
				source => source.dependency?.target.type === 'widget' && source.dependency.target.widgetId === 'dup',
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
			.map(source => (source.dependency!.target as { optional: boolean }).optional)
			.sort()
		expect(optionalFlags)
			.toEqual([false, true])
	})
})

describe('unresolved target', () => {
	it('produces a dependency issue for both a required and an optional dep.widget(id); optional never suppresses it', () => {
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

		const issues = expectInvalid(blueprint)
		const ghostNode = blueprint.getChildrenAt(blueprint.root, 'child')[0]!

		const unresolved = dependencyIssuesOf(issues)
			.filter(
				source => source.dependency?.target.type === 'widget' && source.dependency.target.widgetId === 'ghost',
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
		'missing %s capability produces a dependency issue for both required and optional targets, related to the resolved target widget',
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

			const issues = expectInvalid(blueprint)
			const noCapNode = blueprint.getChildrenAt(blueprint.root, 'child')[0]!

			const probeIssues = dependencyIssuesOf(issues)
				.filter(
					source => source.dependency?.target.type === 'widget' && source.dependency.target.widgetId === 'no-cap',
				)
			expect(probeIssues)
				.toHaveLength(2)
			for (const source of probeIssues) {
				expect(source.related)
					.toHaveLength(1)
				expect(source.related?.[0]?.type)
					.toBe('widget')
				expect(source.related?.[0]?.node)
					.toBe(noCapNode)
			}

			const optionalFlags = probeIssues
				.map(source => (source.dependency!.target as { optional: boolean }).optional)
				.sort()
			expect(optionalFlags)
				.toEqual([false, true])
		},
	)
})

describe('missing member', () => {
	it.each(['state', 'property', 'method'] as const)(
		'missing %s member produces a dependency issue for both required and optional targets, related to the resolved target widget',
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

			const issues = expectInvalid(blueprint)
			const leafTargetNode = blueprint.getChildrenAt(blueprint.root, 'child')[0]!

			const probeIssues = dependencyIssuesOf(issues)
				.filter(
					source => source.dependency?.target.type === 'widget' && source.dependency.target.widgetId === 'leaf-target',
				)
			expect(probeIssues)
				.toHaveLength(2)
			for (const source of probeIssues) {
				expect(source.related)
					.toHaveLength(1)
				expect(source.related?.[0]?.type)
					.toBe('widget')
				expect(source.related?.[0]?.node)
					.toBe(leafTargetNode)
			}

			const optionalFlags = probeIssues
				.map(source => (source.dependency!.target as { optional: boolean }).optional)
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
		// name-based rather than node-id-based resolution bug), this would surface as a purity issue.
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

		const issues = expectInvalid(blueprint)
		expect(issues)
			.toHaveLength(2)

		const sources = dependencyIssuesOf(issues)
		const sourceA = sources.find(source => source.node.id === 'pA')
		const sourceB = sources.find(source => source.node.id === 'pB')
		expect(sourceA?.dependency)
			.toBeDefined()
		expect(sourceB?.dependency)
			.toBeDefined()

		// Same target/operation, one built with a chained `.validate()` and one without: the stable
		// reference must be identical either way.
		expect(sourceA?.dependency)
			.toEqual(sourceB?.dependency)
		expect(Object.keys(sourceA!.dependency!)
			.sort())
			.toEqual(['operation', 'target'])
	})
})
