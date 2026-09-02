/**
 * `data-tutorial-target` lookup for CRM renderer components that are reused across several distinct
 * widget instances (`ButtonRenderer.vue` renders "Reset data"/"Change stage"/"Save"/"Cancel" alike).
 *
 * Keyed by widget id — unlike Survey's `survey-target-map.ts`, which had to key by the `label` Property
 * instead, because P1 predates diagnostic #25 P2's `useWidget()` identity amendment. P2 exposes readonly
 * `widgetId`/`widgetType` directly from `useWidget()` (see `use-inspect-anchor.ts`), so every CRM
 * renderer this map applies to already destructures `widgetId` for its Inspect-mode anchor — this map
 * only needs to look that value up, no label indirection required. Authored against `crm-default`'s
 * known widget ids (`showcases/crm/presets.ts`) — the CRM tour's OWNER-locked-by-extension deterministic
 * starting state — not a generic every-preset mapping.
 *
 * Only the button the CRM tour actually spotlights gets an entry; every other `Button` instance
 * (`reset-data`, `save-stage`, `cancel-stage`) renders no `data-tutorial-target` at all.
 */

export const CRM_BUTTON_TARGETS: Readonly<Record<string, string>> = {
	'change-stage': 'crm-change-stage-button',
}
