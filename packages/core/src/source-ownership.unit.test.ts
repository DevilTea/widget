/**
 * Conformance for authored-source ownership, as recorded in the Discussion #12 amendment
 * "authored source is handed to Core by reference; callers must not mutate it afterwards".
 *
 * Only the observable by-reference contract is pinned. Behavior after an external mutation of an
 * accepted source graph is unspecified and deliberately not tested.
 */
import { describe, expect, it } from 'vitest'
import { createWidgetDocument, createWidgetPlugin, createWidgetSystem } from './index'
import { inspectBlueprint } from './inspection'

const leafPlugin = createWidgetPlugin('leaf')
	.description('Leaf')
	.interfaces<Record<never, never>>()
	.done()

const containerPlugin = createWidgetPlugin('container')
	.description('Container')
	.interfaces<{ slots: 'children' }>()
	.slots({ children: { description: 'Children' } })
	.done()

const system = createWidgetSystem({ plugins: [leafPlugin, containerPlugin] })

function createSource() {
	const first = { id: 'first', type: 'leaf' }
	const second = { id: 'second', type: 'leaf' }
	const children = [first, second]
	const source = { id: 'root', type: 'container', slots: { children } }
	return { source, first, second }
}

describe('authored source ownership', () => {
	it('keeps createBlueprint source by reference, including each recovered node source', () => {
		const { source, first, second } = createSource()

		const blueprint = system.createBlueprint(source)

		expect(blueprint.source)
			.toBe(source)
		expect(blueprint.root.source)
			.toBe(source)
		const nodeSources = inspectBlueprint(blueprint).nodes.map(node => node.node.source)
		expect(nodeSources)
			.toHaveLength(3)
		expect(nodeSources[0])
			.toBe(source)
		expect(nodeSources)
			.toContain(first)
		expect(nodeSources)
			.toContain(second)
	})

	it('keeps recompile source by reference', () => {
		const initial = createSource().source
		const next = createSource()

		const recompiled = system.createBlueprint(initial)
			.recompile(next.source)

		expect(recompiled.source)
			.toBe(next.source)
		const nodeSources = inspectBlueprint(recompiled).nodes.map(node => node.node.source)
		expect(nodeSources)
			.toContain(next.first)
		expect(nodeSources)
			.toContain(next.second)
	})

	it('keeps createWidgetDocument revision 0 source by reference', () => {
		const { source } = createSource()

		const document = createWidgetDocument({ system, source })

		expect(document.getSnapshot().blueprint.source)
			.toBe(source)
	})

	it('shares untouched subtrees between revisions and never reuses patch operand containers', () => {
		const { source, first, second } = createSource()
		const document = createWidgetDocument({ system, source })
		const operand = { nested: { value: 1 } }

		const result = document.applyPatch([
			{ op: 'add', path: '/slots/children/0/extra', value: operand },
		])

		expect(result)
			.toEqual({ ok: true, changed: true })
		const next = document.getSnapshot().blueprint.source as typeof source & {
			slots: { children: [Record<string, unknown>, unknown] }
		}
		expect(next)
			.not
			.toBe(source)
		expect(next.slots.children[0])
			.not
			.toBe(first)
		expect(next.slots.children[1])
			.toBe(second)
		expect(next.slots.children[0].extra)
			.toEqual(operand)
		expect(next.slots.children[0].extra)
			.not
			.toBe(operand)
		expect((next.slots.children[0].extra as typeof operand).nested)
			.not
			.toBe(operand.nested)
	})

	it('does not modify the previous accepted source when a patch commits', () => {
		const { source } = createSource()
		const snapshotBefore = structuredClone(source)
		const document = createWidgetDocument({ system, source })

		document.applyPatch([{ op: 'replace', path: '/slots/children/1/id', value: 'renamed' }])

		expect(source)
			.toEqual(snapshotBefore)
		expect(document.getSnapshot().blueprint.source)
			.not
			.toEqual(snapshotBefore)
	})
})
