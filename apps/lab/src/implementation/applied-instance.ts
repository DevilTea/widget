/**
 * Applied-instance extraction (issue #25 P3 Scope B). Given the APPLIED source text — always
 * `session.active.sourceText` / `LabStore.active.value.sourceText`, never `draftSourceText` (the P1
 * gate review's "Applied instance ... always derives from the applied snapshot — never the unapplied
 * draft — so the two identities cannot blur") — and a widget id, locates and pretty-prints that
 * widget's own JSON declaration fragment.
 *
 * Framework-agnostic, pure — no Vue import, matching `src/lab/`'s split. Deliberately generic over the
 * Lab's one source-document shape rather than per-showcase: every showcase/sandbox preset (see each
 * showcase's own `presets.ts`, plus `src/sandbox/presets.ts`) is the same recursive
 * `{ id, type, config?, slots?: { [slotName]: Node[] } }` tree (a JSON object nested through `slots`'
 * arrays), so one structural walk covers all three without hardcoding any showcase's widget ids/slot
 * names.
 */

export type AppliedInstanceResult
	= | { readonly status: 'found', readonly json: string }
		| { readonly status: 'not-found' }

interface RawWidgetNode {
	readonly id: unknown
	readonly type: unknown
	readonly slots?: unknown
}

function isRawWidgetNode(value: unknown): value is RawWidgetNode {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		&& 'id' in value && 'type' in value
}

/**
 * Depth-first search through `slots`' own object-of-arrays shape. Returns the first node whose `id`
 * matches — widget ids are unique per the Lab's own source-document convention (issue #13), so "first"
 * and "only" coincide in practice, but this never asserts uniqueness itself.
 */
function findWidgetNode(value: unknown, widgetId: string): RawWidgetNode | null {
	if (!isRawWidgetNode(value))
		return null
	if (value.id === widgetId)
		return value

	const slots = value.slots
	if (typeof slots !== 'object' || slots === null || Array.isArray(slots))
		return null

	for (const children of Object.values(slots)) {
		if (!Array.isArray(children))
			continue
		for (const child of children) {
			const found = findWidgetNode(child, widgetId)
			if (found !== null)
				return found
		}
	}
	return null
}

/**
 * `sourceText` is the applied snapshot's own text (already `JSON.parse`-able — it crossed the Apply
 * boundary), but this still parses defensively (`{ status: 'not-found' }` on a parse failure) rather
 * than assuming that invariant from outside this module.
 */
export function extractAppliedInstance(sourceText: string, widgetId: string): AppliedInstanceResult {
	let definition: unknown
	try {
		definition = JSON.parse(sourceText)
	}
	catch {
		return { status: 'not-found' }
	}

	const node = findWidgetNode(definition, widgetId)
	if (node === null)
		return { status: 'not-found' }

	return { status: 'found', json: JSON.stringify(node, null, 2) }
}
