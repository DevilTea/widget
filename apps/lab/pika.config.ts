import { defineEngineConfig } from '@pikacss/core'

/**
 * Widget Lab's PikaCSS configuration.
 *
 * Deliberately small: a handful of design tokens (exposed as CSS custom properties so the
 * hand-authored Dockview theme in `src/styles/dockview-theme.css` and Monaco's local styling can
 * reuse them) plus PikaCSS's own atomic-utility generation for application UI. This is Lab visual
 * language only — see `packages/widget/core` / `packages/widget/vue` AGENTS.md — it has no bearing
 * on any published package's public contract.
 */
export default defineEngineConfig({
	variables: {
		// Always emitted: the Dockview theme file below and Monaco's local container styling
		// reference these through plain CSS (not `pika()` calls), so usage-based pruning would
		// otherwise drop them.
		safeList: [
			'--lab-color-bg',
			'--lab-color-surface',
			'--lab-color-surface-alt',
			'--lab-color-border',
			'--lab-color-text',
			'--lab-color-text-muted',
			'--lab-color-accent',
			'--lab-color-accent-contrast',
			'--lab-color-danger',
			'--lab-color-warning',
			'--lab-color-success',
			'--lab-radius',
			'--lab-font-mono',
			'--lab-font-sans',
		],
		definitions: {
			'--lab-color-bg': '#14161a',
			'--lab-color-surface': '#1b1e24',
			'--lab-color-surface-alt': '#22262e',
			'--lab-color-border': '#2c313a',
			'--lab-color-text': '#e6e8eb',
			'--lab-color-text-muted': '#9aa2af',
			'--lab-color-accent': '#5b9dff',
			'--lab-color-accent-contrast': '#04101f',
			'--lab-color-danger': '#f2545b',
			'--lab-color-warning': '#e8a33d',
			'--lab-color-success': '#3fbf7f',
			'--lab-radius': '6px',
			'--lab-font-mono': '"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace',
			'--lab-font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		},
	},
})
