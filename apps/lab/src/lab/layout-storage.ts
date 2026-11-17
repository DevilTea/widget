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

/** Bump when a change to the panels or their components makes an older saved layout meaningless. */
export const LAYOUT_VERSION = 1

export const LAYOUT_STORAGE_KEY = 'widget-lab:layout'

/** The panels every layout holds; none of them can be closed. */
export const CANONICAL_PANEL_IDS: readonly string[] = ['author', 'widget', 'blueprint', 'runtime', 'dependencies', 'preview']

/** Panels a user may open and close (added lazily); they are never restored, see `Workbench.vue`. */
export const LAZY_PANEL_IDS: readonly string[] = ['implementation', 'document-tools']

/** Every Dockview component name `Workbench.vue` registers. */
const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(['author', 'widget', 'blueprint', 'runtime', 'dependencies', 'preview', 'implementation', 'documentTools'])
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
		return parseSavedLayout(storage.getItem(LAYOUT_STORAGE_KEY))
	}
	catch {
		return null
	}
}

/** Returns whether the layout was stored. */
export function saveLayout(layout: unknown, storage: LayoutStorage | null = browserLayoutStorage()): boolean {
	if (storage === null || !isPlausibleLayout(layout))
		return false
	try {
		storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, layout }))
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
