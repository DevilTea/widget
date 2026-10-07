import type { InspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'
import { inspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'

/**
 * Projects a showcase renderer's `useWidget()` identity onto its own rendered root element so the
 * Inspector Agent can find it (diagnostic #25 P2 "Preview -> semantic inspector bridge").
 * `@deviltea/widget-vue`'s `useWidget()` identity amendment ("useWidget() may expose readonly local widget
 * identity") deliberately supplies `widgetId`/`widgetType` as plain identity values only, with no
 * DOM-stamping behavior of its own. The attribute contract itself (names, shape, and what the Agent
 * does with them) is owned by `@deviltea/widget-inspector/anchor`; this composable is only the Lab's one
 * deliberate projection point, reused one-line-per-renderer by every showcase renderer that has a
 * rendered root (a renderer with no rendered root — a semantic-only stub — has nothing to stamp and
 * skips this entirely).
 *
 * `widgetId`/`widgetType` are plain, non-reactive values (stable for a mounted renderer instance, per
 * the amendment), so the returned attribute object is plain too — safe to `v-bind` once on a template
 * root; it never needs to be a `computed()`.
 */
export function useInspectAnchor(widgetId: string, widgetType: string): InspectAnchorAttributes {
	return inspectAnchorAttributes({ widgetId, widgetType })
}
