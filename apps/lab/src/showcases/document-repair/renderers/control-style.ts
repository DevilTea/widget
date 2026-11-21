/**
 * Inline style for the native buttons of the repair desk.
 *
 * The Preview frame's base layer (`styles/preview-frame.css`) would otherwise decide the font of these controls. The
 * colour, size and weight a control needs to stay readable are set inline, which beats every stylesheet rule whatever
 * its layer or specificity, so no frame stylesheet can quietly change them. The border uses `--repair-text-muted`, which is
 * at least 3:1 against the card surface in both themes (WCAG 1.4.11), unlike `--repair-border`.
 */

import type { CSSProperties } from 'vue'

/** A secondary button (outlined). */
export const BUTTON_STYLE: CSSProperties = {
	color: 'var(--repair-text)',
	fontSize: '14px',
	fontWeight: '600',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'var(--repair-text-muted)',
}

/** The primary button (filled with the accent). */
export const PRIMARY_BUTTON_STYLE: CSSProperties = {
	color: 'var(--repair-on-accent)',
	fontSize: '14px',
	fontWeight: '600',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'var(--repair-accent)',
	backgroundColor: 'var(--repair-accent)',
}
