/**
 * Conformance coverage for issue #10 COMMENT 26 §4 (Definition diagnostics).
 *
 * Normative source: amendment "Blueprint definition diagnostic paths and exact recovery cases"
 * (COMMENT 25), amendment "Blueprint recovery edge-case contract" (COMMENT 24), and checkpoint C
 * (COMMENT 2) for the Issue base model. Assertions lock the structured `source` fields
 * (`type`/`path`/`node`/`related`) only; `message` text is explicitly not part of the conformance
 * surface (COMMENT 26 §14).
 */

import type {
	AnyWidgetPluginTuple,
	BlueprintConfigIssueSource,
	BlueprintDefinitionIssueSource,
	BlueprintIssue,
	Issue,
} from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

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

interface ConfiguredInterfaces {
	config: {
		raw: { label?: unknown }
		resolved: { label: string }
	}
}

const configuredPlugin = createWidgetPlugin('configured')
	.interfaces<ConfiguredInterfaces>()
	.config({
		validate: (input, ctx): input is { label?: unknown } => {
			if (typeof input !== 'object' || input === null || Array.isArray(input)) {
				ctx.addIssue({ message: 'Config must be an object.' })
				return false
			}
			return true
		},
		resolve: rawConfig => ({ label: typeof rawConfig?.label === 'string' ? rawConfig.label : 'default' }),
	})
	.done()

const system = createWidgetSystem({
	plugins: [leafPlugin, containerPlugin, configuredPlugin],
})

// -------------------------------------------------------------------------------------------------
// Local helpers
// -------------------------------------------------------------------------------------------------

function at<T>(array: readonly T[], index: number): T {
	const value = array[index]
	if (value === undefined)
		throw new Error(`Expected an element at index ${index}, got undefined.`)
	return value
}

function isDefinitionIssue<Plugins extends AnyWidgetPluginTuple>(
	issue: BlueprintIssue<Plugins>,
): issue is Issue<BlueprintDefinitionIssueSource<Plugins>> {
	return issue.source.type === 'definition'
}

function isConfigIssue<Plugins extends AnyWidgetPluginTuple>(
	issue: BlueprintIssue<Plugins>,
): issue is Issue<BlueprintConfigIssueSource<Plugins>> {
	return issue.source.type === 'config'
}

// -------------------------------------------------------------------------------------------------
// Whole-node shape
// -------------------------------------------------------------------------------------------------

describe('malformed whole widget', () => {
	it.each([
		['null', null],
		['a number', 7],
		['an array', ['not-a-widget']],
	])('emits exactly one definition issue with no path for %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		const issue = at(issues, 0)
		expect(issue.source.node)
			.toBe(blueprint.root)
		expect(issue.source.path)
			.toBeUndefined()
		expect(issue.source.related)
			.toBeUndefined()
	})
})

// -------------------------------------------------------------------------------------------------
// id / type
// -------------------------------------------------------------------------------------------------

describe('id diagnostics', () => {
	it.each([
		['id is missing', { type: 'leaf' }],
		['id is a number', { id: 42, type: 'leaf' }],
		['id is null', { id: null, type: 'leaf' }],
		['id is an object', { id: {}, type: 'leaf' }],
	])('emits exactly one definition issue at [\'id\'] when %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		const issue = at(issues, 0)
		expect(issue.source.path)
			.toEqual(['id'])
		expect(issue.source.node)
			.toBe(blueprint.root)
	})
})

describe('type diagnostics', () => {
	it.each([
		['type is missing', { id: 'x' }],
		['type is a number', { id: 'x', type: 7 }],
		['type is null', { id: 'x', type: null }],
		['type is an unknown plugin type', { id: 'x', type: 'nonexistent-plugin' }],
	])('emits exactly one definition issue at [\'type\'] when %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		const issue = at(issues, 0)
		expect(issue.source.path)
			.toEqual(['type'])
		expect(issue.source.node)
			.toBe(blueprint.root)
	})
})

// -------------------------------------------------------------------------------------------------
// Duplicate id
// -------------------------------------------------------------------------------------------------

describe('duplicate id', () => {
	it('gives each of three colliders its own [\'id\'] issue, related to all other colliders in source order', () => {
		const definition = {
			id: 'root',
			type: 'container',
			slots: {
				children: [
					{ id: 'dup', type: 'leaf' },
					{ id: 'dup', type: 'leaf' },
					{ id: 'dup', type: 'leaf' },
				],
			},
		}
		const blueprint = system.createBlueprint(definition)
		const children = blueprint.getChildrenAt(blueprint.root, 'children')
		expect(children)
			.toHaveLength(3)
		const [nodeA, nodeB, nodeC] = [at(children, 0), at(children, 1), at(children, 2)]

		function idIssuesOf(node: (typeof children)[number]) {
			const issues = node.getIssues()
				.filter(isDefinitionIssue)
				.filter(issue => arraysEqual(issue.source.path, ['id']))
			expect(issues)
				.toHaveLength(1)
			return at(issues, 0)
		}

		function arraysEqual(a: readonly PropertyKey[] | undefined, b: readonly PropertyKey[]): boolean {
			return a !== undefined && a.length === b.length && a.every((item, index) => item === b[index])
		}

		expect(idIssuesOf(nodeA).source.related)
			.toEqual([
				{ type: 'widget', node: nodeB },
				{ type: 'widget', node: nodeC },
			])
		expect(idIssuesOf(nodeB).source.related)
			.toEqual([
				{ type: 'widget', node: nodeA },
				{ type: 'widget', node: nodeC },
			])
		expect(idIssuesOf(nodeC).source.related)
			.toEqual([
				{ type: 'widget', node: nodeA },
				{ type: 'widget', node: nodeB },
			])

		// Exactly one ['id'] duplicate-id definition issue per collider, no more, no fewer.
		const allDuplicateIdIssues = blueprint.getCollectedIssues()
			.filter(isDefinitionIssue)
			.filter(issue => arraysEqual(issue.source.path, ['id']))
		expect(allDuplicateIdIssues)
			.toHaveLength(3)
	})
})

// -------------------------------------------------------------------------------------------------
// config capability
// -------------------------------------------------------------------------------------------------

describe('config diagnostics', () => {
	it('emits exactly one definition issue at [\'config\'] when config is supplied without the config capability', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'leaf', config: { anything: true } })
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		const issue = at(issues, 0)
		expect(issue.source.path)
			.toEqual(['config'])
		expect(issue.source.node)
			.toBe(blueprint.root)
	})

	it('does not duplicate an invalid-but-capable config as a definition issue', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'configured', config: 'not-an-object' })
		const allIssues = blueprint.root.getIssues()

		expect(allIssues.filter(isDefinitionIssue))
			.toHaveLength(0)
		expect(allIssues.filter(isConfigIssue).length)
			.toBeGreaterThan(0)
	})
})

// -------------------------------------------------------------------------------------------------
// slots container / capability / entries
// -------------------------------------------------------------------------------------------------

describe('slots container diagnostics', () => {
	it.each([
		['a string', 'not-an-object'],
		['an array', []],
	])('emits exactly one definition issue at [\'slots\'] for a malformed slots container (%s)', (_label, slots) => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'container', slots })
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		expect(at(issues, 0).source.path)
			.toEqual(['slots'])
	})

	it('emits exactly one definition issue at [\'slots\'] when slots are supplied without the slots capability', () => {
		const blueprint = system.createBlueprint({
			id: 'x',
			type: 'leaf',
			slots: { extra: [{ id: 'y', type: 'leaf' }] },
		})
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		expect(at(issues, 0).source.path)
			.toEqual(['slots'])
	})
})

describe('slot entry diagnostics', () => {
	it('emits a definition issue at [\'slots\', slot] for a malformed declared slot value', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'container', slots: { children: 'not-an-array' } })
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		expect(at(issues, 0).source.path)
			.toEqual(['slots', 'children'])
	})

	it('emits a definition issue at [\'slots\', slot] for an undeclared raw slot name', () => {
		const blueprint = system.createBlueprint({
			id: 'x',
			type: 'container',
			slots: { extra: [{ id: 'y', type: 'leaf' }] },
		})
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(1)
		expect(at(issues, 0).source.path)
			.toEqual(['slots', 'extra'])
	})

	it('lets a capability-mismatch issue and a malformed-value issue coexist independently', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'leaf', slots: { anything: 'not-an-array' } })
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)

		expect(issues)
			.toHaveLength(2)
		const paths = issues.map(issue => issue.source.path)
		expect(paths)
			.toContainEqual(['slots'])
		expect(paths)
			.toContainEqual(['slots', 'anything'])
	})
})

// -------------------------------------------------------------------------------------------------
// Malformed child attribution
// -------------------------------------------------------------------------------------------------

describe('malformed child attribution', () => {
	it('reports a malformed child on the child itself, never as a duplicate parent array-index issue', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: { children: [null] },
		})

		const parentIssues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)
		expect(parentIssues)
			.toHaveLength(0)

		const child = at(blueprint.getChildrenAt(blueprint.root, 'children'), 0)
		expect(child.resolved)
			.toBe(false)
		expect(child.rawDefinition)
			.toBeNull()

		const childIssues = child.getIssues()
			.filter(isDefinitionIssue)
		expect(childIssues)
			.toHaveLength(1)
		const issue = at(childIssues, 0)
		expect(issue.source.node)
			.toBe(child)
		expect(issue.source.path)
			.toBeUndefined()
	})
})

// -------------------------------------------------------------------------------------------------
// Unreserved fields
// -------------------------------------------------------------------------------------------------

describe('unreserved extra fields', () => {
	it.each([
		['a primitive extra field', { id: 'x', type: 'leaf', revision: 3 }],
		['an object extra field', { id: 'x', type: 'leaf', meta: { createdBy: 'someone' } }],
		['a function-valued extra field', { id: 'x', type: 'leaf', onSomething: () => {} }],
	])('produces no definition issue for %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		expect(blueprint.root.getIssues()
			.filter(isDefinitionIssue))
			.toHaveLength(0)
	})
})

// -------------------------------------------------------------------------------------------------
// Deterministic ordering
// -------------------------------------------------------------------------------------------------

describe('deterministic diagnostic ordering', () => {
	it('orders independent whole-node diagnostics as id -> type -> slots', () => {
		const blueprint = system.createBlueprint({
			type: 'nonexistent-plugin',
			slots: 'not-an-object',
		})
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)
		expect(issues.map(issue => issue.source.path))
			.toEqual([['id'], ['type'], ['slots']])
	})

	it('orders independent diagnostics on a resolved node as config -> slots', () => {
		const blueprint = system.createBlueprint({
			id: 'x',
			type: 'container',
			config: { foo: 1 },
			slots: 'not-an-object',
		})
		const issues = blueprint.root.getIssues()
			.filter(isDefinitionIssue)
		expect(issues.map(issue => issue.source.path))
			.toEqual([['config'], ['slots']])
	})
})
