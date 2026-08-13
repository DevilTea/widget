/**
 * Conformance coverage for COMMENT 26 §3 (slot projection) and COMMENT 24/25 (recovery edge cases for
 * declared/unknown/malformed raw slots).
 */

import type { BlueprintDefinitionIssueSource, WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

interface LeafInterfaces extends WidgetInterfaces {}

const leafPlugin = createWidgetPlugin('leaf')
	.interfaces<LeafInterfaces>()
	.done()

interface ContainerInterfaces extends WidgetInterfaces {
	slots: 'content' | 'header'
}

const containerPlugin = createWidgetPlugin('container')
	.interfaces<ContainerInterfaces>()
	.slots({
		header: {},
		content: {},
	})
	.done()

const system = createWidgetSystem({ plugins: [containerPlugin, leafPlugin] })

function getContainerRoot(definition: unknown) {
	const blueprint = system.createBlueprint(definition)
	const root = blueprint.root
	if (!root.resolved || root.type !== 'container')
		throw new Error('expected a resolved container root')
	return { blueprint, root }
}

describe('declared slot omission', () => {
	it('an entirely omitted raw slots field resolves every declared slot to []', () => {
		const { blueprint, root } = getContainerRoot({ id: 'root', type: 'container' })

		expect(Object.keys(root.slots))
			.toEqual(['header', 'content'])
		expect(root.slots.header)
			.toEqual([])
		expect(root.slots.content)
			.toEqual([])
		expect(blueprint.status)
			.toBe('valid')
	})

	it('a declared slot missing from a partially populated raw slots object resolves to [] independently', () => {
		const child = { id: 'h1', type: 'leaf' }
		const { blueprint, root } = getContainerRoot({ id: 'root', type: 'container', slots: { header: [child] } })

		expect(root.slots.header)
			.toHaveLength(1)
		expect(root.slots.header[0]!.rawDefinition)
			.toBe(child)
		expect(root.slots.content)
			.toEqual([])
		expect(blueprint.status)
			.toBe('valid')
	})
})

describe('malformed declared slot', () => {
	it('a non-array declared slot value resolves to [] and reports a definition issue at [\'slots\', slot]', () => {
		const { blueprint, root } = getContainerRoot({
			id: 'root',
			type: 'container',
			slots: { header: 'not-an-array', content: [] },
		})

		expect(root.slots.header)
			.toEqual([])
		expect(root.slots.content)
			.toEqual([])
		expect(blueprint.status)
			.toBe('invalid')

		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintDefinitionIssueSource
		expect(source.type)
			.toBe('definition')
		expect(source.path)
			.toEqual(['slots', 'header'])
		expect(source.node)
			.toBe(root)
	})

	it('a malformed slots container also resolves every declared slot to [] and reports a definition issue at [\'slots\']', () => {
		const { blueprint, root } = getContainerRoot({ id: 'root', type: 'container', slots: 'not-an-object' })

		expect(Object.keys(root.slots))
			.toEqual(['header', 'content'])
		expect(root.slots.header)
			.toEqual([])
		expect(root.slots.content)
			.toEqual([])
		expect(blueprint.status)
			.toBe('invalid')

		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintDefinitionIssueSource
		expect(source.type)
			.toBe('definition')
		expect(source.path)
			.toEqual(['slots'])
		expect(source.node)
			.toBe(root)
	})
})

describe('unknown raw slots', () => {
	it('an undeclared raw slot is excluded from the semantic slot map but stays navigable through raw-slot topology', () => {
		const child = { id: 'mystery-child', type: 'leaf' }
		const { blueprint, root } = getContainerRoot({ id: 'root', type: 'container', slots: { mystery: [child] } })

		expect(Object.keys(root.slots))
			.toEqual(['header', 'content'])
		expect('mystery' in root.slots)
			.toBe(false)
		expect(root.slots.header)
			.toEqual([])
		expect(root.slots.content)
			.toEqual([])

		const childrenAtMystery = blueprint.getChildrenAt(root, 'mystery')
		expect(childrenAtMystery)
			.toHaveLength(1)
		const childNode = childrenAtMystery[0]!
		expect(childNode.rawDefinition)
			.toBe(child)

		const location = blueprint.getLocation(childNode)
		expect(location?.type)
			.toBe('raw-slot')
		if (location?.type !== 'raw-slot')
			throw new Error('expected a raw-slot location')
		expect(location.parent)
			.toBe(root)
		expect(location.slot)
			.toBe('mystery')
		expect(location.index)
			.toBe(0)

		expect(blueprint.getChildren(root))
			.toContain(childNode)

		expect(blueprint.status)
			.toBe('invalid')
		const issues = blueprint.getCollectedIssues()
		const defIssue = issues.find(issue => issue.source.type === 'definition' && (issue.source as BlueprintDefinitionIssueSource).path?.[1] === 'mystery')
		expect(defIssue)
			.toBeDefined()
		expect((defIssue!.source as BlueprintDefinitionIssueSource).path)
			.toEqual(['slots', 'mystery'])
	})

	it('the semantic slot map on a resolved node contains only declared slot keys, regardless of extra raw slots', () => {
		const { root } = getContainerRoot({
			id: 'root',
			type: 'container',
			slots: {
				header: [{ id: 'h', type: 'leaf' }],
				mystery: [{ id: 'm', type: 'leaf' }],
			},
		})

		expect(Object.keys(root.slots)
			.sort())
			.toEqual(['content', 'header'])
		expect('mystery' in root.slots)
			.toBe(false)
	})
})

describe('plugin without slots capability', () => {
	it('still recovers raw slot children via raw-slot topology, with a definition diagnostic', () => {
		const grandchild = { id: 'gc', type: 'leaf' }
		const blueprint = system.createBlueprint({ id: 'root', type: 'leaf', slots: { anything: [grandchild] } })
		const root = blueprint.root

		expect(root.resolved)
			.toBe(true)
		if (!root.resolved || root.type !== 'leaf')
			throw new Error('expected a resolved leaf root')

		// no slots capability => semantic `.slots` is still `{}` (COMMENT 1/24), never undefined.
		expect(root.slots)
			.toEqual({})

		const children = blueprint.getChildren(root)
		expect(children)
			.toHaveLength(1)
		const child = children[0]!
		expect(child.rawDefinition)
			.toBe(grandchild)

		const location = blueprint.getLocation(child)
		expect(location?.type)
			.toBe('raw-slot')
		if (location?.type !== 'raw-slot')
			throw new Error('expected a raw-slot location')
		expect(location.parent)
			.toBe(root)
		expect(location.slot)
			.toBe('anything')
		expect(location.index)
			.toBe(0)

		expect(blueprint.status)
			.toBe('invalid')
		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintDefinitionIssueSource
		expect(source.type)
			.toBe('definition')
		expect(source.path)
			.toEqual(['slots'])
		expect(source.node)
			.toBe(root)
	})
})
