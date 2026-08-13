/**
 * Conformance coverage for issue #10 COMMENT 26 §2 (Blueprint recovery contract).
 *
 * Normative source: issue #10 checkpoint B (COMMENT 1), amendment "Blueprint recovery edge-case
 * contract" (COMMENT 24), and the U2 blueprint-compiler handoff notes. Only public Blueprint surface
 * imported from the package entry (`../index`) is exercised; internal modules and `blueprintInternals`
 * are out of scope.
 */

import type {
	AnyWidgetPluginTuple,
	BlueprintDefinitionIssueSource,
	BlueprintIssue,
	BlueprintWidgetNode,
	Issue,
	ResolvedBlueprintWidgetNode,
} from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_ISSUES } from '../index'

// -------------------------------------------------------------------------------------------------
// Fixture plugins/system
// -------------------------------------------------------------------------------------------------

interface LeafInterfaces {}

const leafPlugin = createWidgetPlugin('leaf')
	.interfaces<LeafInterfaces>()
	.done()

interface ContainerInterfaces {
	slots: 'children'
}

const containerPlugin = createWidgetPlugin('container')
	.interfaces<ContainerInterfaces>()
	.slots({
		children: {},
	})
	.done()

const system = createWidgetSystem({
	plugins: [leafPlugin, containerPlugin],
})

type OurPlugins = (typeof system)['plugins']
type OurBlueprintIssue = BlueprintIssue<OurPlugins>

// -------------------------------------------------------------------------------------------------
// Local helpers
// -------------------------------------------------------------------------------------------------

function at<T>(array: readonly T[], index: number): T {
	const value = array[index]
	if (value === undefined)
		throw new Error(`Expected an element at index ${index}, got undefined.`)
	return value
}

// `Plugins` is concrete (not a generic type parameter) so the `resolved` discriminant narrows the
// `BlueprintWidgetNode` union the same way it would for any other discriminated union.
function assertResolved(node: BlueprintWidgetNode<OurPlugins>): ResolvedBlueprintWidgetNode<OurPlugins> {
	if (!node.resolved)
		throw new Error('Expected a resolved node.')
	return node
}

function isDefinitionIssue<Plugins extends AnyWidgetPluginTuple>(
	issue: BlueprintIssue<Plugins>,
): issue is Issue<BlueprintDefinitionIssueSource<Plugins>> {
	return issue.source.type === 'definition'
}

function summarizeIssues(issues: readonly OurBlueprintIssue[]) {
	return issues.map((issue) => {
		const source = issue.source as { type: string, path?: readonly PropertyKey[], related?: readonly unknown[] }
		return {
			type: source.type,
			path: source.path,
			relatedCount: source.related?.length ?? 0,
		}
	})
}

// -------------------------------------------------------------------------------------------------
// Root and malformed node recovery
// -------------------------------------------------------------------------------------------------

describe('root recovery for non-object input', () => {
	it.each([
		['null', null],
		['a number', 42],
		['a string', 'not-a-widget'],
		['an array', [{ id: 'x', type: 'leaf' }]],
	])('recovers %s as an unresolved root inside an inspectable invalid Blueprint', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.root.resolved)
			.toBe(false)
		expect(blueprint.root.rawDefinition)
			.toBe(definition)

		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)
		expect(issues)
			.toHaveLength(1)
		const issue = at(issues, 0)
		expect(issue.source.node)
			.toBe(blueprint.root)
		expect(issue.source.path)
			.toBeUndefined()
	})
})

describe('unknown plugin type', () => {
	it('keeps a valid-id node unresolved while still indexing it by id', () => {
		const definition = { id: 'ghost', type: 'does-not-exist' }
		const blueprint = system.createBlueprint(definition)

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.root.resolved)
			.toBe(false)

		// A cardinality-1 lookup for a valid id must still resolve to the node, even though the
		// node itself never established plugin identity.
		const found = blueprint.getWidget('ghost')
		expect(found).not.toBeNull()
		expect(found)
			.toBe(blueprint.root)
		expect(found?.resolved)
			.toBe(false)
	})
})

describe('unresolved ancestors do not truncate recoverable descendants', () => {
	it('recovers a resolved grandchild beneath an unresolved root', () => {
		const definition = {
			id: 'ghost-root',
			type: 'does-not-exist',
			slots: {
				children: [
					{
						id: 'mid',
						type: 'container',
						slots: {
							children: [
								{ id: 'leaf-1', type: 'leaf' },
							],
						},
					},
				],
			},
		}
		const blueprint = system.createBlueprint(definition)

		expect(blueprint.root.resolved)
			.toBe(false)

		const midChildren = blueprint.getChildrenAt(blueprint.root, 'children')
		expect(midChildren)
			.toHaveLength(1)
		const mid = assertResolved(at(midChildren, 0))
		expect(mid.id)
			.toBe('mid')
		expect(mid.type)
			.toBe('container')

		const leafChildren = blueprint.getChildrenAt(mid, 'children')
		expect(leafChildren)
			.toHaveLength(1)
		const leaf = assertResolved(at(leafChildren, 0))
		expect(leaf.id)
			.toBe('leaf-1')
		expect(leaf.type)
			.toBe('leaf')
	})
})

// -------------------------------------------------------------------------------------------------
// Source array placement / sparse topology
// -------------------------------------------------------------------------------------------------

describe('array child recovery', () => {
	it('preserves source array placement and index across malformed children', () => {
		const definition = {
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'a', type: 'leaf' },
					null,
					{ id: 'b', type: 'leaf' },
					42,
				],
			},
		}
		const blueprint = system.createBlueprint(definition)
		const children = blueprint.getChildrenAt(blueprint.root, 'children')
		expect(children)
			.toHaveLength(4)

		const first = assertResolved(at(children, 0))
		expect(first.id)
			.toBe('a')
		expect(blueprint.getLocation(first))
			.toEqual({ type: 'slot', parent: blueprint.root, slot: 'children', index: 0 })

		const second = at(children, 1)
		expect(second.resolved)
			.toBe(false)
		expect(second.rawDefinition)
			.toBeNull()
		expect(blueprint.getLocation(second))
			.toEqual({ type: 'slot', parent: blueprint.root, slot: 'children', index: 1 })

		const third = assertResolved(at(children, 2))
		expect(third.id)
			.toBe('b')
		expect(blueprint.getLocation(third))
			.toEqual({ type: 'slot', parent: blueprint.root, slot: 'children', index: 2 })

		const fourth = at(children, 3)
		expect(fourth.resolved)
			.toBe(false)
		expect(fourth.rawDefinition)
			.toBe(42)
		expect(blueprint.getLocation(fourth))
			.toEqual({ type: 'slot', parent: blueprint.root, slot: 'children', index: 3 })
	})

	it('preserves sparse array positions, distinguishing a source hole from an explicit null entry', () => {
		const sparse: unknown[] = []
		sparse[0] = { id: 'x', type: 'leaf' }
		sparse[2] = { id: 'y', type: 'leaf' }
		// Index 1 is a genuine hole: no own property, unlike an explicit `null`/`undefined` entry.
		expect(Object.hasOwn(sparse, 1))
			.toBe(false)
		expect(sparse.length)
			.toBe(3)

		const definition = {
			id: 'root',
			type: 'container',
			slots: { children: sparse },
		}
		const blueprint = system.createBlueprint(definition)
		const children = blueprint.getChildrenAt(blueprint.root, 'children')
		expect(children)
			.toHaveLength(3)

		const first = assertResolved(at(children, 0))
		expect(first.id)
			.toBe('x')

		const hole = at(children, 1)
		expect(hole.resolved)
			.toBe(false)
		expect(hole.rawDefinition)
			.toBeUndefined()
		expect(blueprint.getLocation(hole))
			.toEqual({ type: 'slot', parent: blueprint.root, slot: 'children', index: 1 })

		const third = assertResolved(at(children, 2))
		expect(third.id)
			.toBe('y')
	})
})

// -------------------------------------------------------------------------------------------------
// Duplicate-id cardinality and getWidget collapsing
// -------------------------------------------------------------------------------------------------

describe('duplicate-id cardinality', () => {
	it('counts unresolved nodes with a valid id toward cardinality, not just resolved ones', () => {
		const definition = {
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'dup', type: 'leaf' }, // resolved
					{ id: 'dup', type: 'does-not-exist' }, // unresolved, but still a valid string id
				],
			},
		}
		const blueprint = system.createBlueprint(definition)
		expect(blueprint.status)
			.toBe('invalid')

		const children = blueprint.getChildrenAt(blueprint.root, 'children')
		expect(children)
			.toHaveLength(2)
		expect(at(children, 0).resolved)
			.toBe(true)
		expect(at(children, 1).resolved)
			.toBe(false)

		// A cardinality index that only tracked resolved nodes would wrongly treat "dup" as unique
		// (one resolved candidate) and return that sole resolved node instead of collapsing to null.
		expect(blueprint.getWidget('dup'))
			.toBeNull()
	})
})

describe('getWidget id cardinality collapsing', () => {
	it('returns null for zero matches and for more than one match, and the node for exactly one', () => {
		const definition = {
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'dup', type: 'leaf' },
					{ id: 'dup', type: 'leaf' },
				],
			},
		}
		const blueprint = system.createBlueprint(definition)

		expect(blueprint.getWidget('does-not-exist'))
			.toBeNull()
		expect(blueprint.getWidget('dup'))
			.toBeNull()
		expect(blueprint.getWidget('root'))
			.toBe(blueprint.root)
	})
})

// -------------------------------------------------------------------------------------------------
// Unreserved fields and own-property semantics
// -------------------------------------------------------------------------------------------------

describe('unreserved extra fields', () => {
	it('retains unreserved extra fields in rawDefinition by reference, without producing an issue', () => {
		const definition = { id: 'root', type: 'leaf', extra: 42, nested: { a: [1, 2, 3] }, tag: 'meta' }
		const blueprint = system.createBlueprint(definition)

		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.root.rawDefinition)
			.toBe(definition)
		expect(blueprint.root.getIssues())
			.toEqual(EMPTY_ISSUES)
	})
})

describe('own-property semantics for id/type', () => {
	it('ignores id and type when they are only inherited through the prototype chain', () => {
		const proto = { id: 'from-proto', type: 'leaf' }
		const raw = Object.create(proto) as Record<string, unknown>
		expect(Object.hasOwn(raw, 'id'))
			.toBe(false)
		expect(Object.hasOwn(raw, 'type'))
			.toBe(false)

		const blueprint = system.createBlueprint(raw)
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.root.resolved)
			.toBe(false)

		const paths = blueprint.root.getIssues()
			.filter(isDefinitionIssue)
			.map(issue => issue.source.path)
		expect(paths)
			.toEqual([['id'], ['type']])
	})

	it('does not resolve type through the prototype chain even when id is an own property', () => {
		const proto = { type: 'leaf' }
		const raw = Object.create(proto) as Record<string, unknown>
		raw.id = 'own-id'
		expect(Object.hasOwn(raw, 'id'))
			.toBe(true)
		expect(Object.hasOwn(raw, 'type'))
			.toBe(false)

		const blueprint = system.createBlueprint(raw)
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.root.resolved)
			.toBe(false)

		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)
		expect(issues)
			.toHaveLength(1)
		expect(at(issues, 0).source.path)
			.toEqual(['type'])
	})
})

// -------------------------------------------------------------------------------------------------
// recompile(next) observable equivalence to system.createBlueprint(next)
// -------------------------------------------------------------------------------------------------

describe('recompile', () => {
	it('is observably equivalent to system.createBlueprint(next) for an invalid definition', () => {
		const definition = {
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'dup', type: 'leaf' },
					{ id: 'dup', type: 'leaf' },
				],
			},
		}
		const initial = system.createBlueprint({ id: 'unrelated-root', type: 'leaf' })
		const viaRecompile = initial.recompile(definition)
		const viaFreshCompile = system.createBlueprint(definition)

		// No structural sharing/memoization is contracted: two compiles of the same source produce
		// genuinely distinct object graphs.
		expect(viaRecompile).not.toBe(viaFreshCompile)

		expect(viaRecompile.status)
			.toBe('invalid')
		expect(viaRecompile.status)
			.toBe(viaFreshCompile.status)
		expect(summarizeIssues(viaRecompile.getCollectedIssues()))
			.toEqual(summarizeIssues(viaFreshCompile.getCollectedIssues()))
	})

	it('is observably equivalent to system.createBlueprint(next) for a valid definition', () => {
		const definition = { id: 'root', type: 'leaf' }
		const initial = system.createBlueprint({ id: 'unrelated-root', type: 'leaf' })
		const viaRecompile = initial.recompile(definition)
		const viaFreshCompile = system.createBlueprint(definition)

		expect(viaRecompile.status)
			.toBe('valid')
		expect(viaFreshCompile.status)
			.toBe('valid')

		// The one reference-equality guarantee across a recompile boundary: the canonical empty-issue
		// snapshot is reused by identity for every successful compile.
		expect(viaRecompile.getCollectedIssues())
			.toBe(EMPTY_ISSUES)
		expect(viaFreshCompile.getCollectedIssues())
			.toBe(EMPTY_ISSUES)
	})
})
