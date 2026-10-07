/**
 * Inspect-anchor contract between a renderer (the writer) and `InspectorAgent` (the reader).
 *
 * An anchor is any renderer-owned element carrying both attributes. Anchors carry identity only
 * (`widgetId` and `widgetType`): the Agent binds one Runtime to one inspected root and resolves the
 * pair against Core inspection, so stale or unknown values simply resolve to no target. Several
 * elements may mark the same Widget (each contributes a rect in document order), anchors may nest
 * (the innermost resolvable anchor wins hit-testing), and anchors live and die with the renderer's
 * DOM: there is no register or cleanup API.
 *
 * This module is framework-neutral and DOM-independent so any renderer can reuse it.
 * `@deviltea/widget-vue` deliberately stamps no DOM attributes itself; a renderer or application
 * projects `useWidget()` identity through {@link inspectAnchorAttributes}.
 */

export const INSPECT_ANCHOR_ID_ATTRIBUTE = 'data-widget-id'
export const INSPECT_ANCHOR_TYPE_ATTRIBUTE = 'data-widget-type'

export interface InspectAnchorIdentity {
	readonly widgetId: string
	readonly widgetType: string
}

export type InspectAnchorAttributes = Readonly<Record<typeof INSPECT_ANCHOR_ID_ATTRIBUTE | typeof INSPECT_ANCHOR_TYPE_ATTRIBUTE, string>>

/**
 * Returns the plain attribute record a renderer spreads onto (or `v-bind`s to) its rendered element.
 * The values are plain and non-reactive, so the record is safe to create once per mounted renderer.
 */
export function inspectAnchorAttributes(identity: InspectAnchorIdentity): InspectAnchorAttributes {
	return {
		[INSPECT_ANCHOR_ID_ATTRIBUTE]: identity.widgetId,
		[INSPECT_ANCHOR_TYPE_ATTRIBUTE]: identity.widgetType,
	}
}
