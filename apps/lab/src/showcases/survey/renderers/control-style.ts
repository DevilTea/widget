/**
 * Inline style for the native form controls of the survey (inputs, the language select, Submit).
 *
 * The Lab's Vuetify reset (`button, input, select { color: inherit; font: inherit }` in
 * `@layer vuetify-core.reset`) beats PikaCSS utilities (`@layer utilities`), so the colour, size and
 * weight a control needs to stay readable on a projector are set inline, which beats every layer. The
 * order of the Lab's layers is deliberately not changed. The border uses `--lab-color-text-muted`, which
 * is at least 3:1 against the card surface in both themes (WCAG 1.4.11), unlike `--lab-color-border`.
 */

import type { CSSProperties } from 'vue'

/** Text inputs, number inputs and the language select. */
export const FIELD_STYLE: CSSProperties = {
	color: 'var(--lab-color-text)',
	fontSize: '17px',
	fontWeight: '400',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'var(--lab-color-text-muted)',
}

/** The Submit button. */
export const PRIMARY_BUTTON_STYLE: CSSProperties = {
	color: 'var(--lab-color-accent-contrast)',
	fontSize: '17px',
	fontWeight: '600',
}
