/**
 * Projects a renderer's `useWidget()` identity onto its own root element, so the Inspector Agent can find
 * it. The attribute contract (names, shape, nesting) is owned by `@deviltea/widget-inspector/anchor`, which is
 * a published package; this is only the one-line helper the trip's renderers share. `widgetId`/`widgetType`
 * are plain values that do not change for a mounted renderer, so the result is plain too.
 */

import type { InspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'
import { inspectAnchorAttributes } from '@deviltea/widget-inspector/anchor'

export function useInspectAnchor(widgetId: string, widgetType: string): InspectAnchorAttributes {
	return inspectAnchorAttributes({ widgetId, widgetType })
}
