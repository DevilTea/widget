/**
 * Inline style for the native form controls of the survey (inputs, the language select, Submit).
 *
 * The Preview frame's base layer (`styles/preview-frame.css`: `button, input, select, textarea { font: inherit }`,
 * which replaces the reset of the removed Vuetify styles) would otherwise decide the font of these controls. The
 * colour, size and weight a control needs to stay readable on a projector are set inline, which beats every
 * stylesheet rule whatever its layer or specificity, so no frame stylesheet can quietly change them. The border uses
 * `--survey-color-text-muted`, which is at least 3:1 against the card surface in both themes (WCAG 1.4.11), unlike
 * `--survey-color-border`.
 */

import type { CSSProperties } from 'vue'

/** Text inputs, number inputs and the language select. */
export const FIELD_STYLE: CSSProperties = {
	color: 'var(--survey-color-text)',
	fontSize: '17px',
	fontWeight: '400',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'var(--survey-color-text-muted)',
}

/** The Submit button. */
export const PRIMARY_BUTTON_STYLE: CSSProperties = {
	color: 'var(--survey-color-accent-contrast)',
	fontSize: '17px',
	fontWeight: '600',
}
