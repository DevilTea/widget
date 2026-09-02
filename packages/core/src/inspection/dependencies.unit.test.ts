/**
 * Conformance group 8 (dependency flatten/path), group 9 (dependency status truth table) and group 10
 * (resolved endpoint correctness) from diagnostic #10's inspection amendment "inspection exact API v1 (part
 * 1)".
 *
 * `.__proto__` container-key access is written through a `PROTO_KEY` string constant + computed
 * property syntax, same convention as `runtime/proto-safe-surfaces.unit.test.ts` — a computed key never
 * triggers the object-literal `__proto__`-sets-the-prototype special case, so it produces a genuine own
 * `"__proto__"` container key for `registerDeps()` to return.
 */

import type { BlueprintInspectionDependency, ResolvedBlueprintInspectionNode } from './types'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from './index'

const PROTO_KEY = '__proto__' as const

interface DepTargetInterfaces {
	state: {
		value: number
	}
	properties: {
		val: number
	}
	methods: {
		run: () => number
	}
}

const depTargetPlugin = createWidgetPlugin('dep-target')
	.description('Test widget')
	.interfaces<DepTargetInterfaces>()
	.state(state => state.value({
		validate: (input): input is number => typeof input === 'number',
		default: () => 1,
	}))
	.properties(properties => properties.val({ compute: () => 2 }))
	.methods(methods => methods.run({
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => 3,
	}))
	.done()

interface DepTargetNoStateInterfaces {
	properties: {
		val: number
	}
}

const depTargetNoStatePlugin = createWidgetPlugin('dep-target-no-state')
	.description('Test widget')
	.interfaces<DepTargetNoStateInterfaces>()
	.properties(properties => properties.val({ compute: () => 9 }))
	.done()

interface DepConsumerInterfaces {
	slots: 'children'
	properties: {
		resolvedProp: number
		optionalMissingProp: number
		requiredMissingProp: number
		ambiguousProp: number
		unresolvedTargetProp: number
		missingCapabilityProp: number
		missingMemberProp: number
		pathsProp: number
	}
	methods: {
		endpoints: () => number
	}
}

const depConsumerPlugin = createWidgetPlugin('dep-consumer')
	.description('Test widget')
	.interfaces<DepConsumerInterfaces>()
	.slots({ children: { description: 'Test slot' } })
	.properties(properties => properties
		.resolvedProp({
			registerDeps: ({ dep }) => ({ v: dep.widget('target').state.get('value') }),
			compute: () => 0,
		})
		.optionalMissingProp({
			registerDeps: ({ dep }) => ({ v: dep.widget('does-not-exist')
				.optional().state.get('value') }),
			compute: () => 0,
		})
		.requiredMissingProp({
			registerDeps: ({ dep }) => ({ v: dep.widget('does-not-exist').state.get('value') }),
			compute: () => 0,
		})
		.ambiguousProp({
			registerDeps: ({ dep }) => ({ v: dep.widget('dup').state.get('value') }),
			compute: () => 0,
		})
		.unresolvedTargetProp({
			registerDeps: ({ dep }) => ({ v: dep.widget('broken').state.get('value') }),
			compute: () => 0,
		})
		.missingCapabilityProp({
			registerDeps: ({ dep }) => ({ v: dep.widget('no-state-target').state.get('value') }),
			compute: () => 0,
		})
		.missingMemberProp({
			registerDeps: ({ dep }) => ({ v: dep.widget('target').state.get('nonexistent') }),
			compute: () => 0,
		})
		.pathsProp({
			registerDeps: ({ dep }) => ({
				pricing: { base: dep.widget('target').state.get('value') },
				nested: [
					dep.widget('target').properties.get('val'),
					{ invoke: dep.widget('target').methods.invoke('run') },
				],
				keyed: { 0: dep.widget('target').state.get('value') },
				special: {
					[PROTO_KEY]: dep.widget('target').state.get('value'),
					'constructor': dep.widget('target').state.get('value'),
					'a:b': dep.widget('target').state.get('value'),
					'a->b': dep.widget('target').state.get('value'),
					'a.b': dep.widget('target').state.get('value'),
				},
			}),
			compute: () => 0,
		}))
	.methods(methods => methods.endpoints({
		registerDeps: ({ dep }) => ({
			stateGet: dep.widget('target').state.get('value'),
			stateSet: dep.widget('target').state.set('value'),
			propGet: dep.widget('target').properties.get('val'),
			methodInvoke: dep.widget('target').methods.invoke('run'),
		}),
		validateArgs: (args): args is [] => args.length === 0,
		execute: () => 0,
	}))
	.done()

const system = createWidgetSystem({ plugins: [depTargetPlugin, depTargetNoStatePlugin, depConsumerPlugin] })

function createFixtureBlueprint() {
	return system.createBlueprint({
		id: 'root',
		type: 'dep-consumer',
		slots: {
			children: [
				{ id: 'target', type: 'dep-target' },
				{ id: 'no-state-target', type: 'dep-target-no-state' },
				{ id: 'dup', type: 'dep-target' },
				{ id: 'dup', type: 'dep-target' },
				{ id: 'broken', type: 'unknown-type-xyz' },
			],
		},
	})
}

function inspectRootOf(blueprint: ReturnType<typeof createFixtureBlueprint>): ResolvedBlueprintInspectionNode {
	const inspection = inspectBlueprint(blueprint)
	const root = inspection.getNode(inspection.rootNodeId)!
	if (!root.resolved)
		throw new Error('test fixture: expected a resolved root')
	return root
}

function propertyDep(root: ResolvedBlueprintInspectionNode, name: string): BlueprintInspectionDependency {
	const property = root.properties.find(candidate => candidate.name === name)!
	return property.dependencies[0]!
}

describe('dependency status truth table', () => {
	it('resolved: a uniquely-resolved target with the member present', () => {
		const root = inspectRootOf(createFixtureBlueprint())
		expect(propertyDep(root, 'resolvedProp').status)
			.toBe('resolved')
	})

	it('optional-missing target (cardinality 0, optional) is absent, with no dependency Diagnostic', () => {
		const blueprint = createFixtureBlueprint()
		const root = inspectRootOf(blueprint)
		expect(propertyDep(root, 'optionalMissingProp').status)
			.toBe('absent')

		const diagnostics = blueprint.diagnostics
		expect(diagnostics.some(diagnostic => diagnostic.code.includes('dependency') && diagnostic.location.type === 'property' && diagnostic.location.name === 'optionalMissingProp'))
			.toBe(false)
	})

	it('required-missing target (cardinality 0, not optional) is invalid with no targetNodeId, and an Diagnostic exists', () => {
		const blueprint = createFixtureBlueprint()
		const root = inspectRootOf(blueprint)
		const dep = propertyDep(root, 'requiredMissingProp')
		expect(dep.status)
			.toBe('invalid')
		expect(dep.status === 'invalid' ? dep.targetNodeId : 'not-invalid')
			.toBeUndefined()

		const diagnostics = blueprint.diagnostics
		expect(diagnostics.some(diagnostic => diagnostic.code.includes('dependency') && diagnostic.location.type === 'property' && diagnostic.location.name === 'requiredMissingProp'))
			.toBe(true)
	})

	it('ambiguous target (duplicate WidgetId, cardinality > 1) is invalid with no targetNodeId', () => {
		const blueprint = createFixtureBlueprint()
		const root = inspectRootOf(blueprint)
		const dep = propertyDep(root, 'ambiguousProp')
		expect(dep.status)
			.toBe('invalid')
		expect(dep.status === 'invalid' ? dep.targetNodeId : 'not-invalid')
			.toBeUndefined()
	})

	it('unique but unresolved target is invalid with a targetNodeId', () => {
		const blueprint = createFixtureBlueprint()
		const root = inspectRootOf(blueprint)
		const dep = propertyDep(root, 'unresolvedTargetProp')
		expect(dep.status)
			.toBe('invalid')
		expect(dep.status === 'invalid' ? dep.targetNodeId : undefined)
			.not.toBeUndefined()
	})

	it('unique resolved target missing the capability is invalid with a targetNodeId', () => {
		const blueprint = createFixtureBlueprint()
		const root = inspectRootOf(blueprint)
		const dep = propertyDep(root, 'missingCapabilityProp')
		expect(dep.status)
			.toBe('invalid')
		expect(dep.status === 'invalid' ? dep.targetNodeId : undefined)
			.not.toBeUndefined()
	})

	it('unique resolved target missing the member is invalid with a targetNodeId', () => {
		const blueprint = createFixtureBlueprint()
		const root = inspectRootOf(blueprint)
		const dep = propertyDep(root, 'missingMemberProp')
		expect(dep.status)
			.toBe('invalid')
		expect(dep.status === 'invalid' ? dep.targetNodeId : undefined)
			.not.toBeUndefined()
	})

	it('every invalid/absent status is cross-checked against the existing Blueprint Diagnostic surface, never derived from it', () => {
		const blueprint = createFixtureBlueprint()
		const root = inspectRootOf(blueprint)
		// Every one of these six properties fails resolution for a different reason; the Blueprint's own
		// collected Diagnostics independently confirm six matching dependency diagnostics (one per failing
		// property, `optionalMissingProp` legitimately excluded).
		const failing = ['requiredMissingProp', 'ambiguousProp', 'unresolvedTargetProp', 'missingCapabilityProp', 'missingMemberProp']
		for (const name of failing) {
			expect(propertyDep(root, name).status)
				.toBe('invalid')
		}

		const diagnostics = blueprint.diagnostics
		const namesWithDiagnostics = new Set(
			diagnostics
				.filter(diagnostic => diagnostic.code.includes('dependency') && diagnostic.location.type === 'property')
				.map(diagnostic => (diagnostic as unknown as { location: { name: string } }).location.name),
		)
		for (const name of failing) {
			expect(namesWithDiagnostics.has(name))
				.toBe(true)
		}
	})
})

describe('resolved endpoint correctness', () => {
	it('resolves all four operation kinds to the correct endpoint; state-get/state-set both target {type:"state"}', () => {
		const root = inspectRootOf(createFixtureBlueprint())
		const method = root.methods.find(candidate => candidate.name === 'endpoints')!

		const stateGet = method.dependencies.find(dep => dep.path[0] === 'stateGet')!
		const stateSet = method.dependencies.find(dep => dep.path[0] === 'stateSet')!
		const propGet = method.dependencies.find(dep => dep.path[0] === 'propGet')!
		const methodInvoke = method.dependencies.find(dep => dep.path[0] === 'methodInvoke')!

		if (stateGet.status !== 'resolved' || stateSet.status !== 'resolved' || propGet.status !== 'resolved' || methodInvoke.status !== 'resolved')
			throw new Error('test fixture: expected every endpoint dependency to resolve')

		expect(stateGet.target.member)
			.toEqual({ type: 'state', name: 'value' })
		expect(stateGet.reference.operation)
			.toEqual({ type: 'state-get', key: 'value' })

		expect(stateSet.target.member)
			.toEqual({ type: 'state', name: 'value' })
		expect(stateSet.reference.operation)
			.toEqual({ type: 'state-set', key: 'value' })
		expect(stateSet.target)
			.toEqual(stateGet.target)

		expect(propGet.target.member)
			.toEqual({ type: 'property', name: 'val' })
		expect(propGet.reference.operation)
			.toEqual({ type: 'property-get', name: 'val' })

		expect(methodInvoke.target.member)
			.toEqual({ type: 'method', name: 'run' })
		expect(methodInvoke.reference.operation)
			.toEqual({ type: 'method-invoke', name: 'run' })
	})
})

describe('dependency flatten/path', () => {
	it('flattens a recursive dependency container into exact leaf paths, in leaf traversal order', () => {
		const root = inspectRootOf(createFixtureBlueprint())
		const property = root.properties.find(candidate => candidate.name === 'pathsProp')!

		expect(property.dependencies.map(dep => dep.path))
			.toEqual([
				['pricing', 'base'],
				['nested', 0],
				['nested', 1, 'invoke'],
				['keyed', '0'],
				['special', PROTO_KEY],
				['special', 'constructor'],
				['special', 'a:b'],
				['special', 'a->b'],
				['special', 'a.b'],
			])
	})

	it('distinguishes a string "0" object key from a numeric 0 array index', () => {
		const root = inspectRootOf(createFixtureBlueprint())
		const property = root.properties.find(candidate => candidate.name === 'pathsProp')!

		const arrayIndexPath = property.dependencies.find(dep => dep.path.length === 2 && dep.path[0] === 'nested')!.path
		const stringKeyPath = property.dependencies.find(dep => dep.path.length === 2 && dep.path[0] === 'keyed')!.path

		expect(typeof arrayIndexPath[1])
			.toBe('number')
		expect(arrayIndexPath[1])
			.toBe(0)
		expect(typeof stringKeyPath[1])
			.toBe('string')
		expect(stringKeyPath[1])
			.toBe('0')
	})
})
