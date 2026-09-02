import type { WidgetSource } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, normalizeSeparatedWidgetSource, separateWidgetSource } from './index'

function createPlugins() {
	interface ContainerInterfaces {
		config: {
			raw: { readonly label?: string, readonly flags?: { readonly enabled: boolean } }
			resolved: { readonly label: string }
		}
		slots: 'items'
	}

	const container = createWidgetPlugin('container')
		.description('Container')
		.interfaces<ContainerInterfaces>()
		.config({
			description: 'Container configuration',
			validate: (input): input is { readonly label?: string, readonly flags?: { readonly enabled: boolean } } => typeof input === 'object' && input !== null,
			resolve: raw => ({ label: raw?.label ?? 'Container' }),
		})
		.slots({ items: { description: 'Items' } })
		.done()
	const leaf = createWidgetPlugin('leaf')
		.description('Leaf')
		.interfaces<Record<never, never>>()
		.done()
	return { container, leaf }
}

describe('separated widget source tooling', () => {
	it('projects canonical nested source and normalizes it back deterministically', () => {
		const fixture = createPlugins()
		const system = createWidgetSystem({ plugins: [fixture.container, fixture.leaf] })
		const source: WidgetSource<[typeof fixture.container, typeof fixture.leaf]> = {
			id: 'root',
			type: 'container',
			config: { label: 'Root', flags: { enabled: true } },
			slots: {
				items: [{ id: 'child', type: 'leaf' }],
			},
		}

		const separated = separateWidgetSource(source)
		expect(separated)
			.toEqual({
				structure: { id: 'root', slots: { items: [{ id: 'child' }] } },
				widgets: [
					{ id: 'root', type: 'container', config: { label: 'Root', flags: { enabled: true } } },
					{ id: 'child', type: 'leaf' },
				],
			})

		const normalized = normalizeSeparatedWidgetSource(separated)
		expect(system.createBlueprint(source).status)
			.toBe('valid')
		expect(normalized.diagnostics)
			.toEqual([])
		expect(normalized.source)
			.toEqual(source)
		expect(Object.isFrozen(separated))
			.toBe(true)
		expect(Object.isFrozen(separated.widgets))
			.toBe(true)
		expect(Object.isFrozen(separated.widgets[0]?.config))
			.toBe(true)
	})

	it('uses the first flat data entry, reports duplicates, and reports unused data without guessing', () => {
		const input = {
			structure: { id: 'root' },
			widgets: [
				{ id: 'root', type: 'first', config: { value: 1 } },
				{ id: 'root', type: 'second', config: { value: 2 } },
				{ id: 'orphan', type: 'orphan' },
			],
		}
		const normalized = normalizeSeparatedWidgetSource(input)

		expect(normalized.source)
			.toEqual({ id: 'root', type: 'first', config: { value: 1 } })
		expect(normalized.diagnostics.map(diagnostic => ({ code: diagnostic.code, location: diagnostic.location })))
			.toEqual([
				{ code: 'duplicate-widget-id', location: { area: 'widgets', index: 1 } },
				{ code: 'unused-widget-data', location: { area: 'widgets', index: 2 } },
			])
		expect(input.widgets)
			.toEqual([
				{ id: 'root', type: 'first', config: { value: 1 } },
				{ id: 'root', type: 'second', config: { value: 2 } },
				{ id: 'orphan', type: 'orphan' },
			])
	})

	it('materializes missing flat data as a partial node and preserves the subtree', () => {
		const normalized = normalizeSeparatedWidgetSource({
			structure: {
				id: 'root',
				slots: { items: [{ id: 'missing', slots: { nested: [{ id: 'grandchild' }] } }] },
			},
			widgets: [{ id: 'root', type: 'container' }],
		})

		expect(normalized.source)
			.toEqual({
				id: 'root',
				type: 'container',
				slots: { items: [{ id: 'missing', slots: { nested: [{ id: 'grandchild' }] } }] },
			})
		expect(normalized.diagnostics)
			.toEqual([
				expect.objectContaining({
					code: 'missing-widget-data',
					widgetId: 'missing',
					location: { area: 'structure', path: ['slots', 'items', 0, 'id'] },
				}),
				expect.objectContaining({
					code: 'missing-widget-data',
					widgetId: 'grandchild',
					location: { area: 'structure', path: ['slots', 'items', 0, 'slots', 'nested', 0, 'id'] },
				}),
			])
	})

	it('de-identifies repeated structural occurrences while retaining their available data and descendants', () => {
		const normalized = normalizeSeparatedWidgetSource({
			structure: {
				id: 'root',
				slots: {
					items: [
						{ id: 'child' },
						{ id: 'child', slots: { nested: [{ id: 'grandchild' }] } },
					],
				},
			},
			widgets: [
				{ id: 'root', type: 'container' },
				{ id: 'child', type: 'leaf', config: { label: 'retained' } },
				{ id: 'grandchild', type: 'leaf' },
			],
		})

		expect(normalized.source)
			.toEqual({
				id: 'root',
				type: 'container',
				slots: {
					items: [
						{ id: 'child', type: 'leaf', config: { label: 'retained' } },
						{ type: 'leaf', config: { label: 'retained' }, slots: { nested: [{ id: 'grandchild', type: 'leaf' }] } },
					],
				},
			})
		expect(normalized.diagnostics)
			.toEqual([
				expect.objectContaining({
					code: 'duplicate-structure-id',
					widgetId: 'child',
					location: { area: 'structure', path: ['slots', 'items', 1, 'id'] },
				}),
			])
	})

	it('is explicit and does not auto-detect a separated envelope at the Blueprint boundary', () => {
		const { leaf } = createPlugins()
		const system = createWidgetSystem({ plugins: [leaf] })
		const blueprint = system.createBlueprint({
			structure: { id: 'root' },
			widgets: [{ id: 'root', type: 'leaf' }],
		})

		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.root.resolved)
			.toBe(false)
	})

	it('reports malformed representation fields through diagnostics without invoking accessors', () => {
		let reads = 0
		const structure = Object.defineProperty({}, 'id', {
			get() {
				reads++
				throw new Error('must not execute')
			},
			enumerable: true,
		})
		const normalized = normalizeSeparatedWidgetSource({ structure, widgets: [] })

		expect(reads)
			.toBe(0)
		expect(normalized.source)
			.toEqual({})
		expect(normalized.diagnostics)
			.toEqual([
				expect.objectContaining({
					code: 'invalid-separated-structure',
					location: { area: 'structure', path: ['id'] },
				}),
			])
	})

	it('diagnoses accessible non-string structural ids without using them for data matching', () => {
		const normalized = normalizeSeparatedWidgetSource({
			structure: { id: 42 },
			widgets: [{ id: '42', type: 'leaf' }],
		})

		expect(normalized.source)
			.toEqual({ id: 42 })
		expect(normalized.diagnostics)
			.toEqual([
				expect.objectContaining({
					code: 'invalid-separated-structure',
					reason: 'invalid-node',
					location: { area: 'structure', path: ['id'] },
				}),
				expect.objectContaining({
					code: 'unused-widget-data',
					widgetId: '42',
				}),
			])
	})

	it('recovers cyclic structural references as partial nodes with a cycle diagnostic', () => {
		const root: { id: string, slots?: Record<string, unknown[]> } = { id: 'root' }
		const child: { id: string, slots?: Record<string, unknown[]> } = { id: 'child' }
		root.slots = { items: [child] }
		child.slots = { back: [root] }

		const normalized = normalizeSeparatedWidgetSource({
			structure: root,
			widgets: [
				{ id: 'root', type: 'container' },
				{ id: 'child', type: 'leaf' },
			],
		})

		expect(() => normalizeSeparatedWidgetSource({ structure: root, widgets: [] }))
			.not.toThrow()
		expect(normalized.source)
			.toEqual({
				id: 'root',
				type: 'container',
				slots: {
					items: [{ id: 'child', type: 'leaf', slots: { back: [{}] } }],
				},
			})
		expect(normalized.diagnostics)
			.toEqual([
				expect.objectContaining({
					code: 'invalid-separated-structure',
					reason: 'invalid-node',
					location: { area: 'structure', path: ['slots', 'items', 0, 'slots', 'back', 0] },
				}),
			])
	})

	it('fails closed for revoked proxies at source, array, entry, slots, and child-array boundaries', () => {
		const revokedSource = Proxy.revocable({ structure: { id: 'root' }, widgets: [] }, {})
		revokedSource.revoke()
		expect(() => normalizeSeparatedWidgetSource(revokedSource.proxy))
			.not.toThrow()

		const revokedWidgets = Proxy.revocable([], {})
		revokedWidgets.revoke()
		const arrayBoundary = normalizeSeparatedWidgetSource({ structure: { id: 'root' }, widgets: revokedWidgets.proxy })
		expect(arrayBoundary.diagnostics)
			.toContainEqual(expect.objectContaining({ code: 'invalid-separated-source', reason: 'invalid-widgets' }))

		const revokedEntry = Proxy.revocable({}, {})
		revokedEntry.revoke()
		const entryBoundary = normalizeSeparatedWidgetSource({ structure: { id: 'root' }, widgets: [revokedEntry.proxy] })
		expect(entryBoundary.diagnostics)
			.toContainEqual(expect.objectContaining({ code: 'invalid-separated-widget', reason: 'invalid-entry' }))

		const revokedSlots = Proxy.revocable({}, {})
		revokedSlots.revoke()
		const slotsBoundary = normalizeSeparatedWidgetSource({ structure: { id: 'root', slots: revokedSlots.proxy }, widgets: [] })
		expect(slotsBoundary.diagnostics)
			.toContainEqual(expect.objectContaining({ code: 'invalid-separated-structure', reason: 'invalid-slots' }))

		const revokedChildren = Proxy.revocable([], {})
		revokedChildren.revoke()
		const childBoundary = normalizeSeparatedWidgetSource({ structure: { id: 'root', slots: { items: revokedChildren.proxy } }, widgets: [] })
		expect(childBoundary.diagnostics)
			.toContainEqual(expect.objectContaining({ code: 'invalid-separated-structure', reason: 'invalid-slot-children' }))
	})

	it('diagnoses inaccessible config and slots without invoking their accessors', () => {
		let configReads = 0
		let slotsReads = 0
		const data = { id: 'root', type: 'leaf' }
		Object.defineProperty(data, 'config', {
			enumerable: true,
			get() {
				configReads++
				return { value: 1 }
			},
		})
		const structure = { id: 'root' }
		Object.defineProperty(structure, 'slots', {
			enumerable: true,
			get() {
				slotsReads++
				return { items: [] }
			},
		})

		const normalized = normalizeSeparatedWidgetSource({ structure, widgets: [data] })

		expect(configReads)
			.toBe(0)
		expect(slotsReads)
			.toBe(0)
		expect(normalized.source)
			.toEqual({ id: 'root', type: 'leaf' })
		expect(normalized.diagnostics)
			.toEqual([
				expect.objectContaining({
					code: 'invalid-separated-widget',
					reason: 'invalid-entry',
					location: { area: 'widgets', index: 0, path: ['config'] },
				}),
				expect.objectContaining({
					code: 'invalid-separated-structure',
					reason: 'invalid-slots',
					location: { area: 'structure', path: ['slots'] },
				}),
			])
	})

	it('retains and deep-copies non-enumerable JsonValue config properties', () => {
		type FixturePlugins = ReturnType<typeof createPlugins>
		const config: { label?: string, flags?: { enabled: boolean } } = { label: 'Root' }
		const hidden = { nested: { value: 1 } }
		Object.defineProperty(config, 'hidden', { value: hidden, enumerable: false })
		const source: WidgetSource<[FixturePlugins['container'], FixturePlugins['leaf']]> = {
			id: 'root',
			type: 'container',
			config,
		}

		const separated = separateWidgetSource(source)
		const separatedConfig = separated.widgets[0]!.config as Record<string, unknown>
		const separatedHidden = separatedConfig.hidden as Record<string, unknown>
		expect(Object.hasOwn(separatedConfig, 'hidden'))
			.toBe(true)
		expect(Object.getOwnPropertyDescriptor(separatedConfig, 'hidden')?.enumerable)
			.toBe(false)
		expect(separatedHidden)
			.not.toBe(hidden)
		expect(separatedHidden.nested)
			.not.toBe(hidden.nested)

		const normalized = normalizeSeparatedWidgetSource(separated)
		const normalizedConfig = (normalized.source as { config: Record<string, unknown> }).config
		expect(Object.hasOwn(normalizedConfig, 'hidden'))
			.toBe(true)
		expect((normalizedConfig.hidden as Record<string, unknown>).nested)
			.not.toBe(hidden.nested)
	})

	it('freezes nested separated diagnostic paths', () => {
		const normalized = normalizeSeparatedWidgetSource({
			structure: { id: 42 },
			widgets: [],
		})
		const location = normalized.diagnostics[0]!.location
		if (!('path' in location))
			throw new Error('expected a path-bearing diagnostic')

		expect(Object.isFrozen(location))
			.toBe(true)
		expect(Object.isFrozen(location.path))
			.toBe(true)
		expect(() => (location.path as PropertyKey[]).push('changed'))
			.toThrow(TypeError)
		expect(location.path)
			.toEqual(['id'])
	})
})
