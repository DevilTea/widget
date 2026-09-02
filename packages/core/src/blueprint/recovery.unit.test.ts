/**
 * Conformance coverage for diagnostic #10 COMMENT 26 §2 (Blueprint recovery contract).
 *
 * Normative source: diagnostic #10 checkpoint B (COMMENT 1), amendment "Blueprint recovery edge-case
 * contract" (COMMENT 24), and the U2 blueprint-compiler handoff notes. Only public Blueprint surface
 * imported from the package entry (`../index`) is exercised; internal modules and `blueprintInternals`
 * are out of scope.
 */

import type {
	AnyWidgetPluginTuple,
	BlueprintDefinitionDiagnostic,
	BlueprintDiagnostic,
	BlueprintWidgetNode,
	ResolvedBlueprintWidgetNode,
} from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, EMPTY_DIAGNOSTICS } from '../index'

// -------------------------------------------------------------------------------------------------
// Fixture plugins/system
// -------------------------------------------------------------------------------------------------

interface LeafInterfaces {}

const leafPlugin = createWidgetPlugin('leaf')
	.description('Test widget')
	.interfaces<LeafInterfaces>()
	.done()

interface ContainerInterfaces {
	slots: 'children'
}

const containerPlugin = createWidgetPlugin('container')
	.description('Test widget')
	.interfaces<ContainerInterfaces>()
	.slots({
		children: { description: 'Test slot' },
	})
	.done()

const system = createWidgetSystem({
	plugins: [leafPlugin, containerPlugin],
})

type OurPlugins = (typeof system)['plugins']
type OurBlueprintDiagnostic = BlueprintDiagnostic<OurPlugins>

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

function isDefinitionDiagnostic<Plugins extends AnyWidgetPluginTuple>(
	diagnostic: BlueprintDiagnostic<Plugins>,
): diagnostic is BlueprintDefinitionDiagnostic<Plugins> {
	return ['invalid-widget-definition', 'invalid-widget-id', 'invalid-widget-type', 'unknown-widget-type', 'unexpected-widget-config', 'invalid-widget-slots', 'unexpected-widget-slots', 'undeclared-widget-slot', 'invalid-widget-slot'].includes(diagnostic.code)
}

function summarizeDiagnostics(diagnostics: readonly OurBlueprintDiagnostic[]) {
	return diagnostics.map((diagnostic) => {
		const source = diagnostic as { code: string, path?: readonly PropertyKey[], related?: readonly unknown[] }
		return {
			type: source.code,
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
		expect(blueprint.root.source)
			.toBe(definition)

		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)
		expect(diagnostics)
			.toHaveLength(1)
		const diagnostic = at(diagnostics, 0)
		expect(diagnostic.location.node)
			.toBe(blueprint.root)
		expect('path' in diagnostic ? diagnostic.path : undefined)
			.toBeUndefined()
	})
})

describe('hostile source recovery', () => {
	it('does not execute an accessor-backed id while recovering the exact source candidate', () => {
		let reads = 0
		const source = Object.defineProperty({ type: 'leaf' }, 'id', {
			get() {
				reads++
				throw new Error('must not execute')
			},
			enumerable: true,
		})

		const blueprint = system.createBlueprint(source)

		expect(reads)
			.toBe(0)
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		expect(blueprint.root.source)
			.toBe(source)
		expect(blueprint.root.diagnostics)
			.toContainEqual(expect.objectContaining({ code: 'invalid-widget-id', path: ['id'] }))
	})

	it('fails closed for a revoked Proxy root instead of throwing', () => {
		const { proxy, revoke } = Proxy.revocable({ id: 'root', type: 'leaf' }, {})
		revoke()

		const blueprint = system.createBlueprint(proxy)

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		expect(blueprint.root.source)
			.toBe(proxy)
		expect(blueprint.root.diagnostics)
			.toContainEqual(expect.objectContaining({ code: 'invalid-widget-definition' }))
	})

	it('breaks cyclic slot traversal into an inspectable unresolved child', () => {
		const source: { id: string, type: string, slots: { children: unknown[] } } = {
			id: 'root',
			type: 'container',
			slots: { children: [] },
		}
		source.slots.children.push(source)

		const blueprint = system.createBlueprint(source)
		const root = assertResolved(blueprint.root)
		const child = at(blueprint.getChildrenAt(root, 'children'), 0)

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.sourceJsonCompatible)
			.toBe(false)
		expect(child.source)
			.toBe(source)
		expect(child.resolved)
			.toBe(false)
		expect(child.diagnostics)
			.toContainEqual(expect.objectContaining({ code: 'invalid-widget-definition' }))
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
		expect(second.source)
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
		expect(fourth.source)
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
		expect(hole.source)
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
	it('retains unreserved extra fields in source by reference, without producing an diagnostic', () => {
		const definition = { id: 'root', type: 'leaf', extra: 42, nested: { a: [1, 2, 3] }, tag: 'meta' }
		const blueprint = system.createBlueprint(definition)

		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.root.source)
			.toBe(definition)
		expect(blueprint.root.diagnostics)
			.toEqual(EMPTY_DIAGNOSTICS)
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

		const paths = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)
			.map(diagnostic => 'path' in diagnostic ? diagnostic.path : undefined)
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

		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)
		expect(diagnostics)
			.toHaveLength(1)
		const diagnostic = at(diagnostics, 0)
		expect('path' in diagnostic ? diagnostic.path : undefined)
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
		expect(summarizeDiagnostics(viaRecompile.diagnostics))
			.toEqual(summarizeDiagnostics(viaFreshCompile.diagnostics))
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

		// The one reference-equality guarantee across a recompile boundary: the canonical empty-diagnostic
		// snapshot is reused by identity for every successful compile.
		expect(viaRecompile.diagnostics)
			.toBe(EMPTY_DIAGNOSTICS)
		expect(viaFreshCompile.diagnostics)
			.toBe(EMPTY_DIAGNOSTICS)
	})
})
