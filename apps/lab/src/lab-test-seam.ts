/**
 * Diagnostic #28 browser-contract "interaction seam" for Source/Apply.
 *
 * The real Source panel edits `LabSession.draftSourceText` exclusively through Monaco
 * (`MonacoJsonEditor.vue`'s `update:modelValue` -> `store.setDraftSourceText`). `modern-monaco`'s
 * editor engine is now self-hosted (diagnostic #30 Scope A; see `use-monaco-editor.ts`'s `ensureMonaco()`
 * and `vite-plugin-vendor-modern-monaco-editor-core.ts`), so this seam's justification is no longer "CI
 * must not depend on a reachable CDN" — it is simpler and still holds: the Apply-lifecycle contract
 * (`e2e/apply.spec.ts`) is about `LabSession`/`LabStore` semantics, not the Source panel's editor
 * widget, so it has no reason to depend on Monaco's UI at all.
 *
 * This is that seam, and nothing more: it routes through the exact same `LabStore.setDraftSourceText()`
 * call Monaco's `onChange` already makes — never a second recompile path — so exercising it proves the
 * same Apply lifecycle (`LabSession.apply()`) the real UI uses. Apply itself stays the real header
 * button; this seam only stands in for typing into Monaco.
 *
 * Inert by default: `installLabTestSeam()` only installs `window.__WIDGET_LAB_TEST__` when the page URL
 * carries a `lab-test` query parameter, so a normal user session (and normal `pnpm dev`/`pnpm build`
 * usage) never gains this global.
 */

import type { LabStore } from './composables/use-lab-store'

/** Scoped to this seam module on purpose — no other file needs to know about `__WIDGET_LAB_TEST__`. */
export interface WidgetLabTestSeam {
	setDraftSourceText: (text: string) => void
	/** The applied Document source, as the Document holds it (read-only: for specs that check what an edit wrote). */
	getDocumentSourceText: () => string
}

declare global {
	interface Window {
		__WIDGET_LAB_TEST__?: WidgetLabTestSeam
	}
}

/**
 * `?lab-test&preview-timeout-ms=N`: how long the Preview frame has to answer before its mount fails. The real default (15 s)
 * is far too long to wait for in a browser contract of the failure state (audit U22), so a spec shortens it. Absent
 * `lab-test`, or for anything that is not a positive whole number, there is no override.
 */
export function previewReadinessTimeoutOverride(): number | undefined {
	const params = new URLSearchParams(location.search)
	if (!params.has('lab-test'))
		return undefined
	const value = Number(params.get('preview-timeout-ms'))
	return Number.isInteger(value) && value > 0 ? value : undefined
}

export function installLabTestSeam(store: LabStore): void {
	if (!new URLSearchParams(location.search)
		.has('lab-test')) {
		return
	}

	window.__WIDGET_LAB_TEST__ = {
		setDraftSourceText: text => store.setDraftSourceText(text),
		getDocumentSourceText: () => store.documentState.value.sourceText,
	}
}
