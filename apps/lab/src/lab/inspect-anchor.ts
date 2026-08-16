/**
 * Innermost Inspect-anchor DOM resolution (issue #25 P2 "Preview -> semantic inspector bridge").
 *
 * Framework-agnostic, pure `Element.closest()` walk — no Vue import here on purpose, matching
 * `src/lab/focus.ts`'s split (regression-worthy logic stays independently unit-testable). Anchors are
 * DOM elements stamped with `data-widget-id`/`data-widget-type` by `useInspectAnchor()`
 * (`src/composables/use-inspect-anchor.ts`), one per showcase renderer's own rendered root.
 */

export interface ResolvedInspectAnchor {
	readonly element: Element
	readonly widgetId: string
	readonly widgetType: string
}

const ANCHOR_SELECTOR = '[data-widget-id][data-widget-type]'

/**
 * Resolves the innermost Inspect anchor enclosing `target` (an event's `target`/`relatedTarget`, or any
 * other DOM value a listener might hand in). `Element.closest()` starts its walk at `target` itself and
 * proceeds outward through ancestors, so the first match it finds is — by construction, since anchors
 * nest exactly as their widgets' rendered DOM nests — the nearest/innermost enclosing anchor, never an
 * outer container anchor. Returns `null` for a non-`Element` target (e.g. a text node, or `null`) or
 * when no enclosing anchor exists (a click/hover outside any rendered widget).
 */
export function resolveInspectAnchor(target: EventTarget | null | undefined): ResolvedInspectAnchor | null {
	if (!(target instanceof Element))
		return null

	const element = target.closest(ANCHOR_SELECTOR)
	if (element === null)
		return null

	const widgetId = element.getAttribute('data-widget-id')
	const widgetType = element.getAttribute('data-widget-type')
	// Both attributes are always set together by `useInspectAnchor()`, but a defensive null-check keeps
	// this resolver correct even against a hand-authored/malformed `[data-widget-id]` element outside
	// that composable's control.
	if (widgetId === null || widgetType === null)
		return null

	return { element, widgetId, widgetType }
}
