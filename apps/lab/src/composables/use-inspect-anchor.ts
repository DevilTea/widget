/**
 * Stamps `data-widget-id`/`data-widget-type` onto a showcase renderer's own rendered root element
 * (diagnostic #25 P2 "Preview -> semantic inspector bridge"). `@deviltea/widget-vue`'s `useWidget()` identity
 * amendment ("useWidget() may expose readonly local widget identity") deliberately supplies
 * `widgetId`/`widgetType` as plain identity values only, with no DOM-stamping behavior of its own — a
 * renderer/Lab may deliberately project those onto its own rendered root. This composable is that one
 * deliberate projection point, reused one-line-per-renderer by every showcase renderer that has a
 * rendered root (a renderer with no rendered root — a semantic-only stub — has nothing to stamp and
 * skips this entirely).
 *
 * `widgetId`/`widgetType` are plain, non-reactive values (stable for a mounted renderer instance, per
 * the amendment), so the returned attribute object is plain too — safe to `v-bind` once on a template
 * root; it never needs to be a `computed()`.
 */
export function useInspectAnchor(widgetId: string, widgetType: string): Readonly<Record<'data-widget-id' | 'data-widget-type', string>> {
	return {
		'data-widget-id': widgetId,
		'data-widget-type': widgetType,
	}
}
