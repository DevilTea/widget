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
} from './layout-storage'

/** A layout exactly as `DockviewApi.toJSON()` produced it in the browser (Runtime tab active, 691px tool group). */
function realLayout(): Record<string, unknown> {
	const panel = (id: string, title: string, contentComponent = id) => [id, { id, contentComponent, tabComponent: 'nonClosable', title }] as const
	return {
		grid: {
			root: {
				type: 'branch',
				data: [
					{ type: 'leaf', data: { views: ['author', 'widget', 'blueprint', 'runtime', 'dependencies'], activeView: 'runtime', id: '1' }, size: 691 },
					{ type: 'leaf', data: { views: ['preview'], activeView: 'preview', id: '2' }, size: 749 },
				],
				size: 859,
			},
			width: 1440,
			height: 859,
			orientation: 'HORIZONTAL',
		},
		panels: Object.fromEntries([
			panel('author', 'Author'),
			panel('widget', 'Selected widget'),
			panel('blueprint', 'Blueprint'),
			panel('runtime', 'Runtime'),
			panel('dependencies', 'Dependencies'),
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
	it('requires every canonical panel (a layout from before the Selected widget panel is incompatible)', () => {
		const layout = realLayout()
		delete (layout.panels as Record<string, unknown>).widget
		expect(isPlausibleLayout(layout))
			.toBe(false)
	})

	it('rejects a panel that names a component the Lab does not register', () => {
		const layout = realLayout()
		;(layout.panels as Record<string, Record<string, unknown>>).runtime!.contentComponent = 'somethingElse'
		expect(isPlausibleLayout(layout))
			.toBe(false)
	})

	it('rejects a panel whose id does not match its key, or with an unknown tab component', () => {
		const mismatched = realLayout()
		;(mismatched.panels as Record<string, Record<string, unknown>>).runtime!.id = 'other'
		expect(isPlausibleLayout(mismatched))
			.toBe(false)
		const tab = realLayout()
		;(tab.panels as Record<string, Record<string, unknown>>).runtime!.tabComponent = 'closable'
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
