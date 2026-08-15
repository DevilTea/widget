/**
 * Issue #28 browser-contract "interaction seam" for Source/Apply.
 *
 * The real Source panel edits `LabSession.draftSourceText` exclusively through Monaco
 * (`MonacoJsonEditor.vue`'s `update:modelValue` -> `store.setDraftSourceText`), and `modern-monaco`
 * itself loads its editor core from an esm.sh CDN at runtime (`use-monaco-editor.ts`'s `ensureMonaco()`;
 * self-hosting it is tracked separately in issue #30). CI must not depend on that CDN being reachable,
 * so the Apply-lifecycle browser contract (`e2e/apply.spec.ts`) needs a way to set draft source text
 * without touching Monaco at all.
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
}

declare global {
	interface Window {
		__WIDGET_LAB_TEST__?: WidgetLabTestSeam
	}
}

export function installLabTestSeam(store: LabStore): void {
	if (!new URLSearchParams(location.search)
		.has('lab-test')) {
		return
	}

	window.__WIDGET_LAB_TEST__ = {
		setDraftSourceText: text => store.setDraftSourceText(text),
	}
}
