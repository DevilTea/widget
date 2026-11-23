/**
 * Persistence of the Dockview workbench layout across reloads (audit U12).
 *
 * Framework-agnostic and storage-injected so it is unit-testable without a browser. The saved value is
 * `{ version, layout }`, where `layout` is whatever `DockviewApi.toJSON()` produced. Anything this module
 * cannot positively recognise (invalid JSON, another `version`, a missing canonical panel, a panel that names a
 * component this Lab does not register, a grid without sizes) reads back as `null`, so the caller builds the
 * default layout instead of feeding Dockview data it may choke on. Dockview's own `fromJSON` can still throw
 * for a structurally plausible layout; the caller catches that and calls `clearSavedLayout()`.
 *
 * Every storage access is wrapped: blocked or full storage means "no saved layout" and "not saved", never an
 * error that stops the Lab from loading.
 */

import { TOOL_COMPONENTS, TOOL_IDS } from './tools'

/**
 * Bump when a change to the panels or their components makes an older saved layout meaningless. Version 2 (Lab UX phase 3B):
 * the tool group became Edit / Explain / Tools, and the expert views moved into a Tools group that is opened on request.
 */
export const LAYOUT_VERSION = 2

export const LAYOUT_STORAGE_KEY = 'widget-lab:layout'

/** The panels every layout holds; none of them can be closed. */
export const CANONICAL_PANEL_IDS: readonly string[] = ['edit', 'explain', 'tools', 'preview']

/**
 * Panels a user may open and close (added on request): the expert views of the Tools tab (`lab/tools.ts`). They are never
 * restored, see `stripLazyPanels`, so the Tools group beside the Preview is created on demand.
 */
export const LAZY_PANEL_IDS: readonly string[] = TOOL_IDS

/** Every Dockview component name `Workbench.vue` registers. */
const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(['edit', 'explain', 'tools', 'preview', ...Object.values(TOOL_COMPONENTS)])
const KNOWN_TAB_COMPONENTS: ReadonlySet<string> = new Set(['nonClosable'])

/** The subset of the Web Storage API this module needs. */
export interface LayoutStorage {
	getItem: (key: string) => string | null
	setItem: (key: string, value: string) => void
	removeItem: (key: string) => void
}

/** Opaque to this module beyond the checks in `isPlausibleLayout`; it is Dockview's `SerializedDockview`. */
export type SavedLayout = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Structural sanity check of a Dockview serialisation; deliberately shallow, see the file header. */
export function isPlausibleLayout(layout: unknown): layout is SavedLayout {
	if (!isRecord(layout))
		return false
	const { grid, panels } = layout
	if (!isRecord(grid) || !isRecord(grid.root) || !isPositiveNumber(grid.width) || !isPositiveNumber(grid.height))
		return false
	if (!isRecord(panels))
		return false
	for (const id of CANONICAL_PANEL_IDS) {
		if (!isRecord(panels[id]))
			return false
	}
	for (const [id, panel] of Object.entries(panels)) {
		if (!isRecord(panel) || panel.id !== id)
			return false
		if (typeof panel.contentComponent !== 'string' || !KNOWN_COMPONENTS.has(panel.contentComponent))
			return false
		if (panel.tabComponent !== undefined && (typeof panel.tabComponent !== 'string' || !KNOWN_TAB_COMPONENTS.has(panel.tabComponent)))
			return false
	}
	return true
}

/** Parses a stored string; `null` for anything that is not a current, plausible layout. */
export function parseSavedLayout(raw: string | null): SavedLayout | null {
	if (raw === null)
		return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	}
	catch {
		return null
	}
	if (!isRecord(parsed) || parsed.version !== LAYOUT_VERSION)
		return null
	return isPlausibleLayout(parsed.layout) ? parsed.layout : null
}

/** A group's `{ views, activeView, id }` as Dockview serialises it; `false` when no panel is left in it. */
function stripGroupData(data: unknown): boolean {
	if (!isRecord(data) || !Array.isArray(data.views))
		return false
	const views = data.views.filter(view => typeof view === 'string' && !LAZY_PANEL_IDS.includes(view))
	if (views.length === 0)
		return false
	data.views = views
	// A lazy panel that was the active one: fall back to the group's first remaining (canonical) panel.
	if (typeof data.activeView !== 'string' || !views.includes(data.activeView))
		data.activeView = views[0]
	return true
}

type GridNode = Record<string, unknown> & { size: number }

function isGridNode(value: unknown): value is GridNode {
	return isRecord(value) && typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0 && (value.type === 'leaf' || value.type === 'branch')
}

/**
 * Prunes the panels opened on request from one grid node, in place, and returns the nodes that take its place in
 * its parent: the node itself, nothing (a group that held only lazy panels is gone) or, when a branch is left with
 * a single child, that child. `size` is the node's extent along its parent's axis, so:
 * - a removed child hands its size to the previous kept sibling (or the next one when it was first), so the
 *   siblings keep their proportions and the divider moves only where the group was;
 * - a branch left with one leaf is replaced by the leaf, which takes the branch's size;
 * - a branch left with one branch (which runs along the parent's axis again, Dockview alternates orientation by
 *   depth) is replaced by that branch's children, scaled to fill the branch's size.
 * Returns `null` when the node is not a recognisable grid node, which makes the whole layout unusable.
 */
function pruneGridNode(node: unknown, removedIds: Set<string>): GridNode[] | null {
	if (!isGridNode(node))
		return null
	if (node.type === 'leaf') {
		const data = node.data
		const groupId = isRecord(data) && typeof data.id === 'string' ? data.id : null
		if (stripGroupData(data))
			return [node]
		if (groupId !== null)
			removedIds.add(groupId)
		return []
	}
	if (!Array.isArray(node.data))
		return null
	const kept: GridNode[] = []
	let carried = 0
	for (const child of node.data) {
		const size = isGridNode(child) ? child.size : 0
		const replacement = pruneGridNode(child, removedIds)
		if (replacement === null)
			return null
		if (replacement.length === 0) {
			if (kept.length > 0)
				kept[kept.length - 1]!.size += size
			else
				carried += size
			continue
		}
		replacement[0]!.size += carried
		carried = 0
		kept.push(...replacement)
	}
	node.data = kept
	if (kept.length === 0)
		return []
	if (kept.length === 1) {
		const only = kept[0]!
		if (only.type === 'leaf') {
			only.size = node.size
			return [only]
		}
		const grandchildren = Array.isArray(only.data) ? only.data as GridNode[] : []
		const total = grandchildren.reduce((sum, child) => sum + child.size, 0)
		const scale = total > 0 ? node.size / total : 1
		for (const child of grandchildren)
			child.size *= scale
		return grandchildren
	}
	return [node]
}

/**
 * The layout without the panels that are opened on request (the Tools views), which are never
 * restored: their content depends on a request a page load did not make. Done on the data, before Dockview sees
 * it, so no such panel is ever created, and a group whose active panel was one of them activates its first
 * remaining panel instead of whatever neighbour closing it would have left active. A group that held only such
 * panels (a lazy panel the user had dragged into a group of its own) is removed from the grid and its size goes to
 * a neighbour, so the other dividers stay where the user put them (`pruneGridNode`). Returns a new object (the input
 * is not modified), or `null` when the grid is not a shape this module recognises or nothing would be left.
 */
export function stripLazyPanels(layout: SavedLayout): SavedLayout | null {
	const copy = structuredClone(layout)
	const grid = copy.grid
	if (!isRecord(grid) || !isGridNode(grid.root) || grid.root.type !== 'branch')
		return null
	const removedIds = new Set<string>()
	const root = grid.root
	const replacement = pruneGridNode(root, removedIds)
	if (replacement === null || replacement.length === 0)
		return null
	if (replacement[0] === root) {
		// The root stays a branch of its own.
	}
	else if (replacement.length === 1 && replacement[0]!.type === 'leaf') {
		// One group is left: a root with a single leaf, as Dockview itself saves it.
		grid.root = { type: 'branch', data: replacement, size: root.size }
	}
	else {
		// The root had a single branch child, whose children now sit directly in the root; the axis flips with them.
		// A root's size is its extent across its own axis (the height of a horizontal root).
		const vertical = grid.orientation === 'HORIZONTAL'
		if (grid.orientation !== 'HORIZONTAL' && grid.orientation !== 'VERTICAL')
			return null
		grid.orientation = vertical ? 'VERTICAL' : 'HORIZONTAL'
		grid.root = { type: 'branch', data: replacement, size: Number(vertical ? grid.width : grid.height) }
	}
	if (removedIds.size > 0) {
		// Locations in the saved data refer to the tree that was just reshaped; the maximised group, if any, is dropped.
		delete grid.maximizedNode
		if (typeof copy.activeGroup === 'string' && removedIds.has(copy.activeGroup))
			delete copy.activeGroup
	}
	for (const key of ['floatingGroups', 'popoutGroups'] as const) {
		const entries = copy[key]
		if (Array.isArray(entries))
			copy[key] = entries.filter(entry => isRecord(entry) && stripGroupData(entry.data))
	}
	const panels = copy.panels
	if (isRecord(panels)) {
		for (const id of LAZY_PANEL_IDS)
			delete panels[id]
	}
	return copy
}

/** The browser's `localStorage`, or `null` where even touching it throws (blocked site data). */
export function browserLayoutStorage(): LayoutStorage | null {
	try {
		return globalThis.localStorage ?? null
	}
	catch {
		return null
	}
}

export function loadSavedLayout(storage: LayoutStorage | null = browserLayoutStorage()): SavedLayout | null {
	if (storage === null)
		return null
	try {
		const saved = parseSavedLayout(storage.getItem(LAYOUT_STORAGE_KEY))
		return saved === null ? null : stripLazyPanels(saved)
	}
	catch {
		return null
	}
}

/**
 * Returns whether the layout was stored. A maximized group (the Tools group's Maximize, Lab UX phase 3B) is never stored: the
 * Tools group itself is not restored, so its maximized state is not either (`grid.maximizedNode` is left out).
 */
export function saveLayout(layout: unknown, storage: LayoutStorage | null = browserLayoutStorage()): boolean {
	if (storage === null || !isPlausibleLayout(layout))
		return false
	try {
		const grid = layout.grid as Record<string, unknown>
		const stored = 'maximizedNode' in grid
			? { ...layout, grid: Object.fromEntries(Object.entries(grid)
					.filter(([key]) => key !== 'maximizedNode')) }
			: layout
		storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, layout: stored }))
		return true
	}
	catch {
		return false
	}
}

export function clearSavedLayout(storage: LayoutStorage | null = browserLayoutStorage()): void {
	if (storage === null)
		return
	try {
		storage.removeItem(LAYOUT_STORAGE_KEY)
	}
	catch {
		// Nothing useful to do: a layout that cannot be removed is also one that could not be written.
	}
}
