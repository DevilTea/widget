import type { LayoutStorage } from './layout-storage'
import { describe, expect, it } from 'vitest'
import {
	clearSavedLayout,
	isPlausibleLayout,
	LAYOUT_STORAGE_KEY,
	LAYOUT_VERSION,
	loadSavedLayout,
	parseSavedLayout,
	saveLayout,
	stripLazyPanels,
} from './layout-storage'

/** A layout exactly as `DockviewApi.toJSON()` produced it in the browser (Tools tab active, 691px tool group). */
function realLayout(): Record<string, unknown> {
	const panel = (id: string, title: string, contentComponent = id) => [id, { id, contentComponent, tabComponent: 'nonClosable', title }] as const
	return {
		grid: {
			root: {
				type: 'branch',
				data: [
					{ type: 'leaf', data: { views: ['edit', 'explain', 'tools'], activeView: 'tools', id: '1' }, size: 691 },
					{ type: 'leaf', data: { views: ['preview'], activeView: 'preview', id: '2' }, size: 749 },
				],
				size: 859,
			},
			width: 1440,
			height: 859,
			orientation: 'HORIZONTAL',
		},
		panels: Object.fromEntries([
			panel('edit', 'Edit'),
			panel('explain', 'Explain'),
			panel('tools', 'Tools'),
			panel('preview', 'Preview'),
		]),
		activeGroup: '1',
	}
}

const stored = (layout: unknown, version: unknown = LAYOUT_VERSION): string => JSON.stringify({ version, layout })

function memoryStorage(initial: Record<string, string> = {}): LayoutStorage & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial))
	return {
		data,
		getItem: key => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, value),
		removeItem: key => void data.delete(key),
	}
}

describe('parseSavedLayout', () => {
	it('accepts a layout Dockview produced', () => {
		expect(parseSavedLayout(stored(realLayout())))
			.toEqual(realLayout())
	})

	it('accepts a layout that also holds a lazily opened panel', () => {
		const layout = realLayout()
		;(layout.panels as Record<string, unknown>).implementation = { id: 'implementation', contentComponent: 'implementation', title: 'Implementation' }
		expect(parseSavedLayout(stored(layout)))
			.not
			.toBeNull()
	})

	it('reads nothing as no layout', () => {
		expect(parseSavedLayout(null))
			.toBeNull()
	})

	it.each([
		['not JSON', '{not json'],
		['an empty string', ''],
		['JSON null', 'null'],
		['an array', '[]'],
		['a string', '"layout"'],
		['an object without a layout', '{"version":1}'],
	])('rejects %s', (_label, raw) => {
		expect(parseSavedLayout(raw))
			.toBeNull()
	})

	it('rejects a layout saved by another version, older or newer', () => {
		expect(parseSavedLayout(stored(realLayout(), LAYOUT_VERSION - 1)))
			.toBeNull()
		expect(parseSavedLayout(stored(realLayout(), LAYOUT_VERSION + 1)))
			.toBeNull()
		expect(parseSavedLayout(stored(realLayout(), String(LAYOUT_VERSION))))
			.toBeNull()
		expect(parseSavedLayout(JSON.stringify(realLayout())))
			.toBeNull()
	})
})

describe('isPlausibleLayout', () => {
	it('requires every canonical panel: Edit, Explain, Tools and Preview', () => {
		for (const id of ['edit', 'explain', 'tools', 'preview']) {
			const layout = realLayout()
			delete (layout.panels as Record<string, unknown>)[id]
			expect(isPlausibleLayout(layout), id)
				.toBe(false)
		}
	})

	it('does not use the six-tab layout of version 1 (Lab UX phase 3B), whatever version it is stored with', () => {
		const panel = (id: string) => [id, { id, contentComponent: id, tabComponent: 'nonClosable', title: id }] as const
		const old = {
			...realLayout(),
			panels: Object.fromEntries(['author', 'explain', 'widget', 'blueprint', 'runtime', 'events', 'dependencies', 'preview'].map(panel)),
		}
		expect(LAYOUT_VERSION)
			.toBe(2)
		expect(parseSavedLayout(stored(old, 1)))
			.toBeNull()
		// Even under the current version its panels are not the canonical ones, and Author is no longer a registered component.
		expect(isPlausibleLayout(old))
			.toBe(false)
		expect(loadSavedLayout({ getItem: () => stored(old, 1), setItem: () => {}, removeItem: () => {} }))
			.toBeNull()
	})

	it('rejects a panel that names a component the Lab does not register', () => {
		const layout = realLayout()
		;(layout.panels as Record<string, Record<string, unknown>>).tools!.contentComponent = 'somethingElse'
		expect(isPlausibleLayout(layout))
			.toBe(false)
	})

	it('rejects a panel whose id does not match its key, or with an unknown tab component', () => {
		const mismatched = realLayout()
		;(mismatched.panels as Record<string, Record<string, unknown>>).tools!.id = 'other'
		expect(isPlausibleLayout(mismatched))
			.toBe(false)
		const tab = realLayout()
		;(tab.panels as Record<string, Record<string, unknown>>).tools!.tabComponent = 'closable'
		expect(isPlausibleLayout(tab))
			.toBe(false)
	})

	it('rejects a grid without a root or usable sizes', () => {
		for (const grid of [undefined, {}, { root: {}, width: 0, height: 10 }, { root: {}, width: 10, height: Number.NaN }, { root: null, width: 10, height: 10 }, 'grid']) {
			expect(isPlausibleLayout({ ...realLayout(), grid }))
				.toBe(false)
		}
	})

	it('rejects non-objects', () => {
		for (const value of [null, undefined, 1, 'x', [], { panels: [] }]) {
			expect(isPlausibleLayout(value))
				.toBe(false)
		}
	})
})

describe('load, save and clear', () => {
	it('round-trips a layout through storage', () => {
		const storage = memoryStorage()
		expect(saveLayout(realLayout(), storage))
			.toBe(true)
		expect(JSON.parse(storage.data.get(LAYOUT_STORAGE_KEY)!))
			.toEqual({ version: LAYOUT_VERSION, layout: realLayout() })
		expect(loadSavedLayout(storage))
			.toEqual(realLayout())
	})

	it('never stores a maximized group (the Tools group\'s Maximize is not restored, like the group itself)', () => {
		const storage = memoryStorage()
		const layout = realLayout()
		;(layout.grid as Record<string, unknown>).maximizedNode = { location: [1, 1] }
		expect(saveLayout(layout, storage))
			.toBe(true)
		const stored = JSON.parse(storage.data.get(LAYOUT_STORAGE_KEY)!)
		expect(stored.layout.grid)
			.not
			.toHaveProperty('maximizedNode')
		expect(stored.layout)
			.toEqual(realLayout())
		// The layout handed in is not modified.
		expect(layout.grid)
			.toHaveProperty('maximizedNode')
	})

	it('does not store something it would not read back', () => {
		const storage = memoryStorage()
		expect(saveLayout({ grid: {}, panels: {} }, storage))
			.toBe(false)
		expect(storage.data.size)
			.toBe(0)
	})

	it('loads nothing from corrupt or old stored data', () => {
		expect(loadSavedLayout(memoryStorage({ [LAYOUT_STORAGE_KEY]: '{oops' })))
			.toBeNull()
		expect(loadSavedLayout(memoryStorage({ [LAYOUT_STORAGE_KEY]: stored(realLayout(), 0) })))
			.toBeNull()
		expect(loadSavedLayout(memoryStorage()))
			.toBeNull()
	})

	it('clears the stored layout', () => {
		const storage = memoryStorage({ [LAYOUT_STORAGE_KEY]: stored(realLayout()) })
		clearSavedLayout(storage)
		expect(storage.data.has(LAYOUT_STORAGE_KEY))
			.toBe(false)
	})

	it('treats unavailable or throwing storage as "nothing saved" and never throws', () => {
		const throwing: LayoutStorage = {
			getItem: () => {
				throw new Error('blocked')
			},
			setItem: () => {
				throw new Error('quota')
			},
			removeItem: () => {
				throw new Error('blocked')
			},
		}
		expect(loadSavedLayout(throwing))
			.toBeNull()
		expect(saveLayout(realLayout(), throwing))
			.toBe(false)
		expect(() => clearSavedLayout(throwing))
			.not
			.toThrow()
		expect(loadSavedLayout(null))
			.toBeNull()
		expect(saveLayout(realLayout(), null))
			.toBe(false)
		expect(() => clearSavedLayout(null))
			.not
			.toThrow()
	})
})

interface GroupData { views: string[], activeView: string }
interface GridLayout { grid: { root: { data: { type?: string, data: GroupData, size?: number }[] } }, panels: Record<string, unknown> }

/** The real layout with Implementation (active by default) and Document Tools opened in the tool group. */
function layoutWithLazyPanels(active = 'implementation'): GridLayout {
	const layout = realLayout() as unknown as GridLayout
	const tool = layout.grid.root.data[0]!.data
	tool.views.push('implementation', 'document-tools')
	tool.activeView = active
	layout.panels.implementation = { id: 'implementation', contentComponent: 'implementation', title: 'Implementation' }
	layout.panels['document-tools'] = { id: 'document-tools', contentComponent: 'documentTools', title: 'Document Tools' }
	return layout
}

const toolGroup = (layout: unknown): GroupData => (layout as GridLayout).grid.root.data[0]!.data

describe('stripLazyPanels', () => {
	it('removes panels opened on request from the groups and the panel table', () => {
		const stripped = stripLazyPanels(layoutWithLazyPanels() as never)!
		expect(toolGroup(stripped).views)
			.toEqual(['edit', 'explain', 'tools'])
		expect(Object.keys((stripped as unknown as GridLayout).panels))
			.toEqual(['edit', 'explain', 'tools', 'preview'])
		expect(isPlausibleLayout(stripped))
			.toBe(true)
	})

	it('makes the first canonical panel active when the saved active panel was one of them', () => {
		// Closing Implementation after the restore would have left its neighbour (Tools) active.
		expect(toolGroup(stripLazyPanels(layoutWithLazyPanels('implementation') as never)).activeView)
			.toBe('edit')
		expect(toolGroup(stripLazyPanels(layoutWithLazyPanels('document-tools') as never)).activeView)
			.toBe('edit')
	})

	it('keeps a canonical active panel, and leaves a layout without such panels as it was', () => {
		expect(toolGroup(stripLazyPanels(layoutWithLazyPanels('explain') as never)).activeView)
			.toBe('explain')
		expect(stripLazyPanels(realLayout()))
			.toEqual(realLayout())
	})

	it('does not modify its input', () => {
		const layout = layoutWithLazyPanels()
		const before = JSON.stringify(layout)
		stripLazyPanels(layout as never)
		expect(JSON.stringify(layout))
			.toBe(before)
	})

	describe('a lazy panel alone in its group (the rest of the layout is kept)', () => {
		const lazyLeaf = (size: number, id = '9') => ({ type: 'leaf', data: { views: ['implementation'], activeView: 'implementation', id }, size })
		const canonicalLeaf = (views: string[], size: number, id: string) => ({ type: 'leaf', data: { views, activeView: views[0], id }, size })
		const TOOLS = ['edit', 'explain', 'tools']
		const grid = (layout: unknown) => (layout as { grid: { root: { data: { type: string, size: number, data: unknown }[], size: number }, orientation: string } }).grid
		const withRoot = (root: unknown, extra: Record<string, unknown> = {}) => ({ ...layoutWithLazyPanels(), ...extra, grid: { ...(realLayout().grid as object), root } })

		it('removes the group beside the others and gives its size to the previous sibling', () => {
			const layout = withRoot({ type: 'branch', size: 859, data: [canonicalLeaf(TOOLS, 600, '1'), canonicalLeaf(['preview'], 540, '2'), lazyLeaf(300)] }, { activeGroup: '9' })
			const stripped = stripLazyPanels(layout as never)!
			expect(grid(stripped).root.data.map(child => child.size))
				.toEqual([600, 840])
			expect(grid(stripped).root.data)
				.toHaveLength(2)
			expect(stripped.activeGroup)
				.toBeUndefined()
			expect(isPlausibleLayout(stripped))
				.toBe(true)
		})

		it('gives the size to the next sibling when the removed group came first', () => {
			const layout = withRoot({ type: 'branch', size: 859, data: [lazyLeaf(200), canonicalLeaf(TOOLS, 600, '1'), canonicalLeaf(['preview'], 640, '2')] })
			expect(grid(stripLazyPanels(layout as never)).root.data.map(child => child.size))
				.toEqual([800, 640])
		})

		it('collapses a stack that is left with one group into that group, with the stack\'s size', () => {
			// Tool group above the Implementation panel, Preview on the right.
			const stack = { type: 'branch', size: 691, data: [canonicalLeaf(TOOLS, 500, '1'), lazyLeaf(359)] }
			const layout = withRoot({ type: 'branch', size: 859, data: [stack, canonicalLeaf(['preview'], 749, '2')] })
			const stripped = stripLazyPanels(layout as never)!
			expect(grid(stripped).root.data.map(child => [child.type, child.size]))
				.toEqual([['leaf', 691], ['leaf', 749]])
			expect(grid(stripped).orientation)
				.toBe('HORIZONTAL')
		})

		it('lifts the rows of a column that is left with a single row into the parent, scaled to fill the column', () => {
			// root(H): [ column(V): [ row(H): [tools, preview], lazy ] ]  ->  root(H): [tools, preview]
			const row = { type: 'branch', size: 700, data: [canonicalLeaf(TOOLS, 400, '1'), canonicalLeaf(['preview'], 1040, '2')] }
			const layout = withRoot({ type: 'branch', size: 859, data: [{ type: 'branch', size: 1440, data: [row, lazyLeaf(159)] }] })
			const stripped = stripLazyPanels(layout as never)!
			expect(grid(stripped).orientation)
				.toBe('HORIZONTAL')
			expect(grid(stripped).root.data.map(child => child.size))
				.toEqual([400, 1040])
			expect(isPlausibleLayout(stripped))
				.toBe(true)
		})

		it('flips the root axis when its only remaining child is a branch', () => {
			// root(H): [ column(V): [ row(H), row(H) ], lazy ]  ->  root(V): [ row(H), row(H) ]
			const top = { type: 'branch', size: 400, data: [canonicalLeaf(TOOLS, 700, '1'), canonicalLeaf(['preview'], 740, '2')] }
			const bottom = { type: 'branch', size: 459, data: [canonicalLeaf(['edit'], 1440, '3')] }
			const layout = withRoot({ type: 'branch', size: 859, data: [{ type: 'branch', size: 1240, data: [top, bottom] }, lazyLeaf(200)] })
			const stripped = stripLazyPanels(layout as never)!
			expect(grid(stripped).orientation)
				.toBe('VERTICAL')
			expect(grid(stripped).root.size)
				.toBe(1440)
			expect(grid(stripped).root.data.map(child => child.size))
				.toEqual([400, 459])
		})

		it('lifts the children of a branch that is left with a single branch into its parent, scaled to fill it', () => {
			// root(H): [ A(V): [ B(H): [x, y], lazy ], preview ] -> root(H): [ x, y, preview ]
			const b = { type: 'branch', size: 600, data: [canonicalLeaf(['edit', 'explain'], 200, '1'), canonicalLeaf(['tools'], 200, '3')] }
			const a = { type: 'branch', size: 800, data: [b, lazyLeaf(200)] }
			const layout = withRoot({ type: 'branch', size: 859, data: [a, canonicalLeaf(['preview'], 640, '2')] })
			const stripped = stripLazyPanels(layout as never)!
			expect(grid(stripped).root.data.map(child => child.size))
				.toEqual([400, 400, 640])
			expect(grid(stripped).orientation)
				.toBe('HORIZONTAL')
		})

		it('is null when nothing but lazy panels would be left, or the grid is not a recognisable shape', () => {
			expect(stripLazyPanels(withRoot({ type: 'branch', size: 859, data: [lazyLeaf(100)] }) as never))
				.toBeNull()
			expect(stripLazyPanels(withRoot({ type: 'branch', size: 859, data: [{ type: 'leaf', data: 'x' }] }) as never))
				.toBeNull()
			expect(stripLazyPanels(withRoot({ type: 'leaf', size: 859, data: { views: ['preview'] } }) as never))
				.toBeNull()
		})
	})

	it('drops floating groups that held only lazy panels and filters the others', () => {
		const layout = {
			...layoutWithLazyPanels(),
			floatingGroups: [
				{ data: { views: ['implementation'], activeView: 'implementation', id: '9' }, position: {} },
				{ data: { views: ['explain', 'document-tools'], activeView: 'document-tools', id: '10' }, position: {} },
			],
		}
		const stripped = stripLazyPanels(layout as never) as unknown as { floatingGroups: { data: GroupData }[] }
		expect(stripped.floatingGroups)
			.toHaveLength(1)
		expect(stripped.floatingGroups[0]!.data)
			.toMatchObject({ views: ['explain'], activeView: 'explain' })
	})

	it('is applied when a saved layout is loaded', () => {
		const loaded = loadSavedLayout(memoryStorage({ [LAYOUT_STORAGE_KEY]: stored(layoutWithLazyPanels()) }))
		expect(toolGroup(loaded).views)
			.not
			.toContain('implementation')
		expect(toolGroup(loaded).activeView)
			.toBe('edit')
	})

	it('removes the Tools group below the Preview with every expert view in it, so a reload starts without it', () => {
		// root(H): [ left, column(V): [ preview, tools group ] ]  ->  root(H): [ left, preview ]
		const toolsGroup = { type: 'leaf', data: { views: ['runtime', 'events', 'implementation'], activeView: 'events', id: '3' }, size: 430 }
		const column = { type: 'branch', size: 749, data: [{ type: 'leaf', data: { views: ['preview'], activeView: 'preview', id: '2' }, size: 429 }, toolsGroup] }
		const layout = realLayout() as unknown as { grid: { root: { data: unknown[] } }, panels: Record<string, unknown> }
		layout.grid.root.data[1] = column
		for (const id of ['runtime', 'events', 'implementation'])
			layout.panels[id] = { id, contentComponent: id, title: id }
		const stripped = stripLazyPanels(layout as never) as unknown as { grid: { root: { data: { type: string, size: number, data: GroupData }[] } }, panels: Record<string, unknown> }
		expect(stripped.grid.root.data.map(child => [child.type, child.size, child.data.views]))
			.toEqual([['leaf', 691, ['edit', 'explain', 'tools']], ['leaf', 749, ['preview']]])
		expect(Object.keys(stripped.panels))
			.toEqual(['edit', 'explain', 'tools', 'preview'])
	})
})
