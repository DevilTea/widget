import type { WidgetSource } from './index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem, MAX_JSON_DEPTH, normalizeSeparatedWidgetSource, separateWidgetSource } from './index'

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

		const projection = separateWidgetSource(source)
		expect(projection.diagnostics)
			.toEqual([])
		const separated = projection.separated!
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

	it('recovers cyclic structural references as partial nodes with missing-data and cycle diagnostics', () => {
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

		const missingData = normalizeSeparatedWidgetSource({ structure: root, widgets: [] })
		expect(missingData.source)
			.toEqual({
				id: 'root',
				slots: {
					items: [{ id: 'child', slots: { back: [{}] } }],
				},
			})
		expect(missingData.diagnostics)
			.toEqual([
				expect.objectContaining({
					code: 'missing-widget-data',
					widgetId: 'root',
					location: { area: 'structure', path: ['id'] },
				}),
				expect.objectContaining({
					code: 'missing-widget-data',
					widgetId: 'child',
					location: { area: 'structure', path: ['slots', 'items', 0, 'id'] },
				}),
				expect.objectContaining({
					code: 'invalid-separated-structure',
					reason: 'invalid-node',
					location: { area: 'structure', path: ['slots', 'items', 0, 'slots', 'back', 0] },
				}),
			])
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

		const separated = separateWidgetSource(source).separated!
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
		expect((separatedHidden.nested as { value: number }).value)
			.toBe(1)

		const normalized = normalizeSeparatedWidgetSource(separated)
		const normalizedConfig = (normalized.source as { config: Record<string, unknown> }).config
		expect(Object.hasOwn(normalizedConfig, 'hidden'))
			.toBe(true)
		expect(Object.getOwnPropertyDescriptor(normalizedConfig, 'hidden')?.enumerable)
			.toBe(false)
		const normalizedHidden = normalizedConfig.hidden as Record<string, unknown>
		expect(normalizedHidden)
			.not.toBe(hidden)
		expect(normalizedHidden.nested)
			.not.toBe(hidden.nested)
		expect((normalizedHidden.nested as { value: number }).value)
			.toBe(1)
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

describe('separated envelope diagnostics', () => {
	it('words envelope messages without a stray leading space', () => {
		const missing = normalizeSeparatedWidgetSource({ widgets: [] })
		const badWidgets = normalizeSeparatedWidgetSource({ structure: { id: 'a' }, widgets: 'x' })

		for (const diagnostic of [...missing.diagnostics, ...badWidgets.diagnostics]) {
			expect(diagnostic.message)
				.toBe(diagnostic.message.trim())
		}
	})

	it('locates a non-Array widgets value at the widgets area without fabricating an entry index', () => {
		const normalized = normalizeSeparatedWidgetSource({ structure: { id: 'a' }, widgets: 'x' })
		const diagnostic = normalized.diagnostics.find(candidate => candidate.code === 'invalid-separated-source')

		expect(diagnostic)
			.toMatchObject({ reason: 'invalid-widgets', location: { area: 'widgets' } })
		expect(diagnostic?.location)
			.toEqual({ area: 'widgets' })
		expect(diagnostic?.location && 'index' in diagnostic.location)
			.toBe(false)
	})
})

describe('separateWidgetSource on arbitrary input', () => {
	it('never throws, reporting malformed shapes as located diagnostics', () => {
		const result = separateWidgetSource({
			id: 'root',
			type: 'container',
			slots: { 'items': [null, 7, { id: 'ok', type: 'leaf' }], 'broken': 'nope', 'also-broken': { not: 'an array' } },
		})

		expect(result.separated?.widgets.map(widget => widget.id))
			.toEqual(['root', 'ok'])
		expect(result.separated?.structure)
			.toEqual({ id: 'root', slots: { items: [{ id: 'ok' }] } })
		expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.location, 'reason' in diagnostic ? diagnostic.reason : undefined]))
			.toEqual([
				['invalid-separated-structure', { area: 'source', path: ['slots', 'items', 0] }, 'invalid-node'],
				['invalid-separated-structure', { area: 'source', path: ['slots', 'items', 1] }, 'invalid-node'],
				['invalid-separated-structure', { area: 'source', path: ['slots', 'broken'] }, 'invalid-slot-children'],
				['invalid-separated-structure', { area: 'source', path: ['slots', 'also-broken'] }, 'invalid-slot-children'],
			])
	})

	it.each([
		['null', null],
		['a number', 3],
		['an array', [{ id: 'a', type: 'leaf' }]],
		['an object without id', { type: 'leaf' }],
		['an object with a non-string id', { id: 1, type: 'leaf' }],
	])('returns no separated tree and a diagnostic for a root that is %s', (_label, source) => {
		const result = separateWidgetSource(source)

		expect(result.separated)
			.toBeNull()
		expect(result.diagnostics.length)
			.toBeGreaterThan(0)
	})

	it('reports a missing or non-string type without dropping the structure', () => {
		const result = separateWidgetSource({ id: 'root', slots: { items: [{ id: 'child', type: 4 }] } })

		expect(result.separated)
			.toEqual({ structure: { id: 'root', slots: { items: [{ id: 'child' }] } }, widgets: [] })
		expect(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.location, 'reason' in diagnostic ? diagnostic.reason : undefined]))
			.toEqual([
				['invalid-separated-widget', { area: 'source', path: ['type'] }, 'invalid-type'],
				['invalid-separated-widget', { area: 'source', path: ['slots', 'items', 0, 'type'] }, 'invalid-type'],
			])
	})

	it('reports a cyclic source instead of overflowing, omitting the repeated node', () => {
		const root: Record<string, unknown> = { id: 'root', type: 'container', slots: { items: [] } }
		;(root.slots as { items: unknown[] }).items.push({ id: 'child', type: 'leaf' }, root)

		const result = separateWidgetSource(root)

		expect(result.separated?.structure)
			.toEqual({ id: 'root', slots: { items: [{ id: 'child' }] } })
		expect(result.diagnostics)
			.toEqual([expect.objectContaining({ code: 'invalid-separated-structure', reason: 'invalid-node', location: { area: 'source', path: ['slots', 'items', 1] } })])
	})

	it('reports duplicate ids once per repeated occurrence, giving only the first one flat data', () => {
		const source = {
			id: 'root',
			type: 'container',
			slots: { items: [{ id: 'x', type: 'container', config: { v: 1 } }, { id: 'x', type: 'leaf' }] },
		}
		const result = separateWidgetSource(source)

		expect(result.diagnostics)
			.toEqual([expect.objectContaining({ code: 'duplicate-widget-id', widgetId: 'x', location: { area: 'source', path: ['slots', 'items', 1, 'id'] } })])
		expect(result.separated?.widgets)
			.toEqual([{ id: 'root', type: 'container' }, { id: 'x', type: 'container', config: { v: 1 } }])
		// The diagnostic is what tells the caller the round trip would otherwise change the second widget.
		expect(normalizeSeparatedWidgetSource(result.separated).source)
			.not
			.toEqual(source)
	})

	it.each([
		['a Date', { when: new Date(0) }],
		['undefined', undefined],
		['NaN', { n: Number.NaN }],
		['a function', { f: () => 1 }],
		['an accessor', Object.defineProperty({}, 'x', { get: () => 1, enumerable: true })],
	])('reports non-JSON config (%s) instead of silently converting it', (_label, config) => {
		const result = separateWidgetSource({ id: 'root', type: 'leaf', config })

		expect(result.diagnostics)
			.toEqual([expect.objectContaining({ code: 'invalid-separated-widget', reason: 'invalid-config', location: { area: 'source', path: ['config'] } })])
		expect(result.separated?.widgets)
			.toEqual([{ id: 'root', type: 'leaf' }])
	})

	it('reports non-JSON meta and unrecognized fields instead of dropping them silently', () => {
		const result = separateWidgetSource({ id: 'root', type: 'leaf', meta: new Map(), label: 'x', [Symbol('s')]: 1 })

		expect(result.diagnostics.map(diagnostic => [diagnostic.code, 'reason' in diagnostic ? diagnostic.reason : undefined, (diagnostic.location as unknown as { path: PropertyKey[] }).path.map(String)]))
			.toEqual([
				['invalid-separated-widget', 'unexpected-field', ['label']],
				['invalid-separated-widget', 'unexpected-field', ['Symbol(s)']],
				['invalid-separated-widget', 'invalid-meta', ['meta']],
			])
	})

	it('reports a source nested deeper than the bound without throwing', () => {
		let node: Record<string, unknown> = { id: 'n-last', type: 'leaf' }
		for (let index = 4_999; index >= 0; index--)
			node = { id: `n${index}`, type: 'container', slots: { items: [node] } }

		const result = separateWidgetSource(node)

		expect(result.diagnostics.map(diagnostic => ('reason' in diagnostic ? diagnostic.reason : undefined)))
			.toEqual(['max-depth-exceeded'])
		expect(result.separated?.widgets.length)
			.toBe(Math.floor(MAX_JSON_DEPTH / 3) + 1)
	})

	it('normalizes a structure nested deeper than the bound without throwing', () => {
		let structure: Record<string, unknown> = { id: 'last' }
		for (let index = 4_999; index >= 0; index--)
			structure = { id: `n${index}`, slots: { items: [structure] } }

		const normalized = normalizeSeparatedWidgetSource({ structure, widgets: [] })

		expect(normalized.diagnostics.some(diagnostic => diagnostic.code === 'invalid-separated-structure' && diagnostic.reason === 'max-depth-exceeded'))
			.toBe(true)
	})

	it('carries meta through the separated data losslessly', () => {
		const meta = { createdBy: 'someone', tags: ['a', 1, null], nested: { deep: [true] } }
		const source = { id: 'root', type: 'container', meta, slots: { items: [{ id: 'child', type: 'leaf', meta: 'note' }] } }

		const { separated, diagnostics } = separateWidgetSource(source)

		expect(diagnostics)
			.toEqual([])
		expect(separated?.widgets)
			.toEqual([{ id: 'root', type: 'container', meta }, { id: 'child', type: 'leaf', meta: 'note' }])
		expect(separated?.widgets[0]?.meta)
			.not
			.toBe(meta)
		expect(normalizeSeparatedWidgetSource(separated).source)
			.toEqual(source)
	})

	it('never invokes accessors on the input', () => {
		let reads = 0
		const node = { id: 'root', type: 'leaf' }
		for (const key of ['config', 'meta', 'slots']) {
			Object.defineProperty(node, key, {
				enumerable: true,
				get() {
					reads++
					return {}
				},
			})
		}

		const result = separateWidgetSource(node)

		expect(reads)
			.toBe(0)
		expect(result.diagnostics.length)
			.toBe(3)
	})

	it('round-trips every generated source that projects without diagnostics, including meta', () => {
		let seed = 0x2F6E2B1
		const random = (): number => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			return seed / 0x100000000
		}
		const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!

		function jsonValue(depth: number): unknown {
			const kind = depth <= 0 ? pick(['string', 'number', 'boolean', 'null']) : pick(['string', 'number', 'boolean', 'null', 'array', 'object'])
			switch (kind) {
				case 'string': return pick(['', 'a', '__proto__', 'a/b', 'é'])
				case 'number': return pick([0, -0, 1, -1.5, 1e21])
				case 'boolean': return random() < 0.5
				case 'null': return null
				case 'array': return Array.from({ length: Math.floor(random() * 3) }, () => jsonValue(depth - 1))
				default: {
					const object: Record<string, unknown> = {}
					for (let index = Math.floor(random() * 3); index > 0; index--)
						Object.defineProperty(object, pick(['k', '__proto__', 'constructor', 'x y']), { value: jsonValue(depth - 1), enumerable: true, writable: true, configurable: true })
					return object
				}
			}
		}

		let counter = 0
		function widget(depth: number): Record<string, unknown> {
			const node: Record<string, unknown> = { id: `w${counter++}`, type: pick(['container', 'leaf', 'other']) }
			if (random() < 0.5)
				node.config = jsonValue(3)
			if (random() < 0.5)
				node.meta = jsonValue(3)
			if (depth > 0 && random() < 0.7) {
				const slots: Record<string, unknown[]> = {}
				for (const name of ['items', '__proto__', 'a b'].slice(0, 1 + Math.floor(random() * 3)))
					Object.defineProperty(slots, name, { value: Array.from({ length: Math.floor(random() * 3) }, () => widget(depth - 1)), enumerable: true, writable: true, configurable: true })
				node.slots = slots
			}
			return node
		}

		for (let run = 0; run < 200; run++) {
			counter = 0
			const source = widget(3)
			const { separated, diagnostics } = separateWidgetSource(source)

			expect(diagnostics)
				.toEqual([])
			const normalized = normalizeSeparatedWidgetSource(separated)
			expect(normalized.diagnostics)
				.toEqual([])
			expect(normalized.source)
				.toEqual(source)
		}
	})
})
