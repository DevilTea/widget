/**
 * Inline style for the native form controls of the trip (inputs, selects, buttons).
 *
 * The Preview frame's base layer (`styles/preview-frame.css`) would otherwise decide the font of these
 * controls. The colour, size and weight a control needs to stay readable on a projector are set inline, which
 * beats every stylesheet rule whatever its layer or specificity, so no frame stylesheet can quietly change
 * them. The border uses `--trip-text-muted`, which is at least 3:1 against the card surface in both
 * themes (WCAG 1.4.11), unlike `--trip-border`.
 */

import type { CSSProperties } from 'vue'

/** Text inputs, number inputs and selects. */
export const FIELD_STYLE: CSSProperties = {
	color: 'var(--trip-text)',
	fontSize: '15px',
	fontWeight: '400',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'var(--trip-text-muted)',
}

/** A secondary button (outlined). */
export const BUTTON_STYLE: CSSProperties = {
	color: 'var(--trip-text)',
	fontSize: '14px',
	fontWeight: '600',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'var(--trip-text-muted)',
}
