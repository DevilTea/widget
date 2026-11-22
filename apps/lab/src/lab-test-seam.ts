/**
 * Diagnostic #28 browser-contract "interaction seam" for the JSON commit.
 *
 * The real JSON view edits `LabSession.draftSourceText` exclusively through Monaco
 * (`MonacoJsonEditor.vue`'s `update:modelValue` -> `store.editJson`, and its blur -> `store.endJsonEdit`). `modern-monaco`'s
 * editor engine is now self-hosted (diagnostic #30 Scope A; see `use-monaco-editor.ts`'s `ensureMonaco()`
 * and `vite-plugin-vendor-modern-monaco-editor-core.ts`), so this seam's justification is no longer "CI
 * must not depend on a reachable CDN" — it is simpler and still holds: the commit-lifecycle contract
 * (`e2e/json-commit.spec.ts`) is about `LabSession`/`LabStore` semantics, not the JSON view's editor
 * widget, so it has no reason to depend on Monaco's UI at all.
 *
 * This is that seam, and nothing more: `editJson(text)` stands in for typing the whole text into Monaco and leaving it. It
 * routes through the exact same `LabStore.editJson()` call Monaco's `onChange` makes and the `LabStore.flushJson()` its blur
 * makes — never a second recompile path — so a text that parses is committed at once through the same root SourcePatch
 * (`LabSession.commitJson()`), and one that does not parse stays the JSON view's text with its syntax error. The debounce and
 * the blur themselves are exercised by typing into the real editor (`e2e/json-commit.spec.ts`).
 *
 * Inert by default: `installLabTestSeam()` only installs `window.__WIDGET_LAB_TEST__` when the page URL
 * carries a `lab-test` query parameter, so a normal user session (and normal `pnpm dev`/`pnpm build`
 * usage) never gains this global.
 */

import type { LabStore } from './composables/use-lab-store'

/** Scoped to this seam module on purpose — no other file needs to know about `__WIDGET_LAB_TEST__`. */
export interface WidgetLabTestSeam {
	/** Types `text` into the JSON view and leaves it: committed at once when it parses. */
	editJson: (text: string) => void
	/** Types `text` into the JSON view and stays: committed after the typing pause when it parses, like real typing. */
	typeJson: (text: string) => void
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
		editJson: (text) => {
			store.editJson(text)
			void store.flushJson()
		},
		typeJson: text => store.editJson(text),
		getDocumentSourceText: () => store.documentState.value.sourceText,
	}
}
