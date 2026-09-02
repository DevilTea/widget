/**
 * Conformance coverage for diagnostic #10 COMMENT 26 §4 (Definition diagnostics).
 *
 * Normative source: amendment "Blueprint definition diagnostic paths and exact recovery cases"
 * (COMMENT 25), amendment "Blueprint recovery edge-case contract" (COMMENT 24), and checkpoint C
 * (COMMENT 2) for the Diagnostic base model. Assertions lock the structured `source` fields
 * (`type`/`path`/`node`/`related`) only; `message` text is explicitly not part of the conformance
 * surface (COMMENT 26 §14).
 */

import type {
	AnyWidgetPluginTuple,
	BlueprintConfigDiagnostic,
	BlueprintDefinitionDiagnostic,
	BlueprintDiagnostic,
	JsonValue,
} from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

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

interface ConfiguredInterfaces {
	config: {
		raw: { label?: JsonValue }
		resolved: { label: string }
	}
}

const configuredPlugin = createWidgetPlugin('configured')
	.description('Test widget')
	.interfaces<ConfiguredInterfaces>()
	.config({
		description: 'Test config',
		validate: (input, ctx): input is { label?: JsonValue } => {
			if (typeof input !== 'object' || input === null || Array.isArray(input)) {
				ctx.addDiagnostic({ message: 'Config must be an object.' })
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

function isDefinitionDiagnostic<Plugins extends AnyWidgetPluginTuple>(
	diagnostic: BlueprintDiagnostic<Plugins>,
): diagnostic is BlueprintDefinitionDiagnostic<Plugins> {
	return ['invalid-widget-definition', 'invalid-widget-id', 'invalid-widget-type', 'unknown-widget-type', 'unexpected-widget-config', 'invalid-widget-slots', 'unexpected-widget-slots', 'undeclared-widget-slot', 'invalid-widget-slot'].includes(diagnostic.code)
}

function isConfigDiagnostic<Plugins extends AnyWidgetPluginTuple>(
	diagnostic: BlueprintDiagnostic<Plugins>,
): diagnostic is BlueprintConfigDiagnostic<Plugins> {
	return diagnostic.code === 'invalid-widget-config'
}

function pathOf(
	diagnostic: BlueprintDefinitionDiagnostic | BlueprintDiagnostic,
): readonly PropertyKey[] | undefined {
	return 'path' in diagnostic ? diagnostic.path : undefined
}

function relatedOf(
	diagnostic: BlueprintDefinitionDiagnostic,
): readonly unknown[] | undefined {
	return 'related' in diagnostic ? diagnostic.related : undefined
}

// -------------------------------------------------------------------------------------------------
// Whole-node shape
// -------------------------------------------------------------------------------------------------

describe('malformed whole widget', () => {
	it.each([
		['null', null],
		['a number', 7],
		['an array', ['not-a-widget']],
	])('emits exactly one definition diagnostic with no path for %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		const diagnostic = at(diagnostics, 0)
		expect(diagnostic.location.node)
			.toBe(blueprint.root)
		expect(pathOf(diagnostic))
			.toBeUndefined()
		expect(relatedOf(diagnostic))
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
	])('emits exactly one definition diagnostic at [\'id\'] when %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		const diagnostic = at(diagnostics, 0)
		expect(pathOf(diagnostic))
			.toEqual(['id'])
		expect(diagnostic.location.node)
			.toBe(blueprint.root)
	})
})

describe('type diagnostics', () => {
	it.each([
		['type is missing', { id: 'x' }],
		['type is a number', { id: 'x', type: 7 }],
		['type is null', { id: 'x', type: null }],
		['type is an unknown plugin type', { id: 'x', type: 'nonexistent-plugin' }],
	])('emits exactly one definition diagnostic at [\'type\'] when %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		const diagnostic = at(diagnostics, 0)
		expect(pathOf(diagnostic))
			.toEqual(['type'])
		expect(diagnostic.location.node)
			.toBe(blueprint.root)
	})
})

// -------------------------------------------------------------------------------------------------
// Duplicate id
// -------------------------------------------------------------------------------------------------

describe('duplicate id', () => {
	it('gives each of three colliders its own [\'id\'] diagnostic, related to all other colliders in source order', () => {
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

		function idDiagnosticsOf(node: (typeof children)[number]) {
			const diagnostics = node.diagnostics
				.filter(isDefinitionDiagnostic)
				.filter(diagnostic => arraysEqual(pathOf(diagnostic), ['id']))
			expect(diagnostics)
				.toHaveLength(1)
			return at(diagnostics, 0)
		}

		function arraysEqual(a: readonly PropertyKey[] | undefined, b: readonly PropertyKey[]): boolean {
			return a !== undefined && a.length === b.length && a.every((item, index) => item === b[index])
		}

		expect(relatedOf(idDiagnosticsOf(nodeA)))
			.toEqual([
				{ type: 'widget', node: nodeB },
				{ type: 'widget', node: nodeC },
			])
		expect(relatedOf(idDiagnosticsOf(nodeB)))
			.toEqual([
				{ type: 'widget', node: nodeA },
				{ type: 'widget', node: nodeC },
			])
		expect(relatedOf(idDiagnosticsOf(nodeC)))
			.toEqual([
				{ type: 'widget', node: nodeA },
				{ type: 'widget', node: nodeB },
			])

		// Exactly one ['id'] duplicate-id definition diagnostic per collider, no more, no fewer.
		const allDuplicateIdDiagnostics = blueprint.diagnostics
			.filter(isDefinitionDiagnostic)
			.filter(diagnostic => arraysEqual(pathOf(diagnostic), ['id']))
		expect(allDuplicateIdDiagnostics)
			.toHaveLength(3)
	})
})

// -------------------------------------------------------------------------------------------------
// config capability
// -------------------------------------------------------------------------------------------------

describe('config diagnostics', () => {
	it('emits exactly one definition diagnostic at [\'config\'] when config is supplied without the config capability', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'leaf', config: { anything: true } })
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		const diagnostic = at(diagnostics, 0)
		expect(pathOf(diagnostic))
			.toEqual(['config'])
		expect(diagnostic.location.node)
			.toBe(blueprint.root)
	})

	it('does not duplicate an invalid-but-capable config as a definition diagnostic', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'configured', config: 'not-an-object' })
		const allDiagnostics = blueprint.root.diagnostics

		expect(allDiagnostics.filter(isDefinitionDiagnostic))
			.toHaveLength(0)
		expect(allDiagnostics.filter(isConfigDiagnostic).length)
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
	])('emits exactly one definition diagnostic at [\'slots\'] for a malformed slots container (%s)', (_label, slots) => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'container', slots })
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		expect(pathOf(at(diagnostics, 0)))
			.toEqual(['slots'])
	})

	it('emits exactly one definition diagnostic at [\'slots\'] when slots are supplied without the slots capability', () => {
		const blueprint = system.createBlueprint({
			id: 'x',
			type: 'leaf',
			slots: { extra: [{ id: 'y', type: 'leaf' }] },
		})
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		expect(pathOf(at(diagnostics, 0)))
			.toEqual(['slots'])
	})
})

describe('slot entry diagnostics', () => {
	it('emits a definition diagnostic at [\'slots\', slot] for a malformed declared slot value', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'container', slots: { children: 'not-an-array' } })
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		expect(pathOf(at(diagnostics, 0)))
			.toEqual(['slots', 'children'])
	})

	it('emits a definition diagnostic at [\'slots\', slot] for an undeclared raw slot name', () => {
		const blueprint = system.createBlueprint({
			id: 'x',
			type: 'container',
			slots: { extra: [{ id: 'y', type: 'leaf' }] },
		})
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(1)
		expect(pathOf(at(diagnostics, 0)))
			.toEqual(['slots', 'extra'])
	})

	it('lets a capability-mismatch diagnostic and a malformed-value diagnostic coexist independently', () => {
		const blueprint = system.createBlueprint({ id: 'x', type: 'leaf', slots: { anything: 'not-an-array' } })
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)

		expect(diagnostics)
			.toHaveLength(2)
		const paths = diagnostics.map(diagnostic => pathOf(diagnostic))
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
	it('reports a malformed child on the child itself, never as a duplicate parent array-index diagnostic', () => {
		const blueprint = system.createBlueprint({
			id: 'root',
			type: 'container',
			slots: { children: [null] },
		})

		const parentDiagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)
		expect(parentDiagnostics)
			.toHaveLength(0)

		const child = at(blueprint.getChildrenAt(blueprint.root, 'children'), 0)
		expect(child.resolved)
			.toBe(false)
		expect(child.source)
			.toBeNull()

		const childDiagnostics = child.diagnostics
			.filter(isDefinitionDiagnostic)
		expect(childDiagnostics)
			.toHaveLength(1)
		const diagnostic = at(childDiagnostics, 0)
		expect(diagnostic.location.node)
			.toBe(child)
		expect(pathOf(diagnostic))
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
	])('produces no definition diagnostic for %s', (_label, definition) => {
		const blueprint = system.createBlueprint(definition)
		expect(blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic))
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
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)
		expect(diagnostics.map(diagnostic => pathOf(diagnostic)))
			.toEqual([['id'], ['type'], ['slots']])
	})

	it('orders independent diagnostics on a resolved node as config -> slots', () => {
		const blueprint = system.createBlueprint({
			id: 'x',
			type: 'container',
			config: { foo: 1 },
			slots: 'not-an-object',
		})
		const diagnostics = blueprint.root.diagnostics
			.filter(isDefinitionDiagnostic)
		expect(diagnostics.map(diagnostic => pathOf(diagnostic)))
			.toEqual([['config'], ['slots']])
	})
})
