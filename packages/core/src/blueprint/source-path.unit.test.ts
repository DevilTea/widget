/**
 * `blueprint.getSourcePath(node)`: the compiler-computed structured `SourcePath` of every Blueprint node,
 * usable verbatim as a `SourcePatch` path against the same source.
 */

import type { BlueprintWidgetNode, SourcePath } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from '../index'
import { inspectBlueprint } from '../inspection'

const leafPlugin = createWidgetPlugin('leaf')
	.description('Test widget')
	.interfaces<Record<never, never>>()
	.done()

interface ContainerInterfaces {
	slots: 'children' | 'footer'
}

const containerPlugin = createWidgetPlugin('container')
	.description('Test widget')
	.interfaces<ContainerInterfaces>()
	.slots({
		children: { description: 'Test slot' },
		footer: { description: 'Test slot' },
	})
	.done()

const system = createWidgetSystem({ plugins: [leafPlugin, containerPlugin] })

type Node = BlueprintWidgetNode<(typeof system)['plugins']>

function followPath(source: unknown, path: readonly (string | number)[]): unknown {
	let current = source
	for (const segment of path)
		current = (current as Record<string | number, unknown>)[segment]
	return current
}

function collect(blueprint: ReturnType<typeof system.createBlueprint>): Node[] {
	const result: Node[] = []
	const visit = (node: Node): void => {
		result.push(node)
		for (const child of blueprint.getChildren(node))
			visit(child)
	}
	visit(blueprint.root)
	return result
}

describe('blueprint.getSourcePath', () => {
	it('addresses the root with the empty path and nested slot children with slots/<slot>/<index>', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'a', type: 'leaf' },
					{ id: 'b', type: 'container', slots: { footer: [{ id: 'b0', type: 'leaf' }, { id: 'b1', type: 'leaf' }] } },
				],
			},
		})

		expect(blueprint.getSourcePath(blueprint.root))
			.toEqual([])
		expect(blueprint.getSourcePath(blueprint.getWidget('a')!))
			.toEqual(['slots', 'children', 0])
		expect(blueprint.getSourcePath(blueprint.getWidget('b')!))
			.toEqual(['slots', 'children', 1])
		expect(blueprint.getSourcePath(blueprint.getWidget('b1')!))
			.toEqual(['slots', 'children', 1, 'slots', 'footer', 1])
	})

	it('resolves to the exact authored object of every node, resolved or unresolved, including undeclared slots', () => {
		const source = {
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'mystery', type: 'nope', slots: { children: [{ id: 'deep', type: 'leaf' }] } },
					{ type: 'leaf' },
					'not-a-widget',
				],
				extra: [{ id: 'raw', type: 'leaf' }],
			},
		}
		const blueprint = system.createBlueprint(source)
		const nodes = collect(blueprint)

		expect(nodes.length)
			.toBe(6)
		for (const node of nodes) {
			const path = blueprint.getSourcePath(node)
			expect(path)
				.not
				.toBeNull()
			expect(followPath(blueprint.source, path!))
				.toBe(node.source)
		}
		expect(blueprint.getSourcePath(blueprint.getWidget('raw')!))
			.toEqual(['slots', 'extra', 0])
	})

	it('keeps slot names verbatim, including special JavaScript names', () => {
		const slotSystem = createWidgetSystem({ plugins: [leafPlugin] })
		const source = JSON.parse('{"id":"r","type":"leaf","slots":{"__proto__":[{"id":"x","type":"leaf"}],"a/b":[{"id":"y","type":"leaf"}]}}')
		const blueprint = slotSystem.createBlueprint(source)

		expect(blueprint.getSourcePath(blueprint.getWidget('x')!))
			.toEqual(['slots', '__proto__', 0])
		expect(blueprint.getSourcePath(blueprint.getWidget('y')!))
			.toEqual(['slots', 'a/b', 0])
	})

	it('round-trips through a SourcePatch against the same source', () => {
		const document = createWidgetDocument({
			system,
			source: {
				id: 'root',
				type: 'container',
				slots: {
					children: [
						{ id: 'a', type: 'leaf' },
						{ id: 'b', type: 'container', slots: { children: [{ id: 'c', type: 'leaf' }, { id: 'ghost', type: 'unknown' }] } },
					],
				},
			},
		})
		const before = document.getSnapshot().blueprint

		for (const id of ['root', 'a', 'b', 'c', 'ghost']) {
			const node = before.getWidget(id)!
			const path = before.getSourcePath(node) as SourcePath
			const result = document.applyPatch([{ op: 'add', path: [...(path as readonly (string | number)[]), 'meta'], value: `marked:${id}` }])
			expect(result)
				.toEqual({ ok: true, changed: true })
		}

		const after = document.getSnapshot().blueprint
		for (const node of collect(after)) {
			const marker = (node.source as { meta?: unknown }).meta
			expect(marker)
				.toBe(`marked:${node.id}`)
		}
	})

	it('also reaches nodes through a patch `test` against their own source', () => {
		const document = createWidgetDocument({ system, source: { id: 'root', type: 'container', slots: { footer: [{ id: 'f', type: 'leaf' }] } } })
		const blueprint = document.getSnapshot().blueprint
		const node = blueprint.getWidget('f')!

		expect(document.applyPatch([{ op: 'test', path: blueprint.getSourcePath(node)!, value: node.source as never }]))
			.toEqual({ ok: true, changed: false })
	})

	it('rejects a node of another Blueprint like getLocation does', () => {
		const one = system.createBlueprint({ id: 'root', type: 'leaf' })
		const other = system.createBlueprint({ id: 'root', type: 'leaf' })

		expect(one.getLocation(other.root))
			.toBeNull()
		expect(one.getSourcePath(other.root))
			.toBeNull()
		expect(one.getSourcePath({ resolved: false, source: null, diagnostics: [], id: null, type: null }))
			.toBeNull()
	})

	it('is exposed on every Blueprint status variant and on inspection nodes', () => {
		const valid = system.createBlueprint({ id: 'root', type: 'leaf' })
		const invalid = system.createBlueprint({ id: 'root', type: 'nope' })
		const nonJson = system.createBlueprint({ id: 'root', type: 'container', slots: { children: [{ id: 'x', type: 'leaf', meta: Number.NaN }] } })

		expect(valid.status)
			.toBe('valid')
		expect(invalid.status)
			.toBe('invalid')
		expect(nonJson.sourceJsonCompatible)
			.toBe(false)
		expect(valid.getSourcePath(valid.root))
			.toEqual([])
		expect(invalid.getSourcePath(invalid.root))
			.toEqual([])
		expect(nonJson.getSourcePath(nonJson.getWidget('x')!))
			.toEqual(['slots', 'children', 0])

		const inspection = inspectBlueprint(nonJson)
		for (const node of inspection.nodes) {
			expect(node.sourcePath)
				.toEqual(nonJson.getSourcePath(node.node))
		}
		expect(inspection.nodes.map(node => node.sourcePath))
			.toEqual([[], ['slots', 'children', 0]])
	})

	it('gives unresolved inspection nodes their own source path too', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: { children: [{ id: 'a', type: 'leaf' }, { id: 'ghost', type: 'unknown', slots: { footer: [{ type: 'leaf' }] } }] },
		})
		const inspection = inspectBlueprint(blueprint)
		const unresolved = inspection.nodes.filter(node => !node.resolved)

		expect(unresolved.map(node => node.sourcePath))
			.toEqual([['slots', 'children', 1], ['slots', 'children', 1, 'slots', 'footer', 0]])
		for (const node of unresolved) {
			expect(node.sourcePath)
				.toEqual(blueprint.getSourcePath(node.node))
		}
	})

	it('returns an immutable path', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'container', slots: { children: [{ id: 'a', type: 'leaf' }] } })
		const path = blueprint.getSourcePath(blueprint.getWidget('a')!)!

		expect(Object.isFrozen(path))
			.toBe(true)
	})
})
