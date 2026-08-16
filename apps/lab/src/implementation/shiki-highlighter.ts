/**
 * Lazy, self-contained Shiki fine-grained highlighter for the Implementation explorer (issue #25 P3
 * Scope C). Mirrors `use-monaco-editor.ts`'s `ensureMonaco()` lazy-singleton pattern and its "bundle
 * from tm-grammars/tm-themes, no CDN" precedent: theme and grammars are the same two packages the
 * Source editor already depends on, just three additional grammar files (TypeScript, Vue, JSON) plus
 * the same `one-dark-pro` theme already installed for Monaco — no new third-party asset host.
 *
 * This module is never imported outside `src/components/implementation/` on purpose: it, and its
 * `@shikijs/core`/`@shikijs/engine-javascript` imports plus the three grammar JSON files below, only
 * ever enter the Implementation panel's own lazy chunk (itself only reachable once
 * `Workbench.vue`'s `defineAsyncComponent`-registered `implementation` panel is actually added to
 * Dockview) — never the eager main bundle, and never merely by a showcase's `sources.ts` registry
 * module being imported (that module only holds `load()` thunks — see `types.ts`'s file header).
 *
 * Engine choice — `@shikijs/engine-javascript`'s `createJavaScriptRegexEngine()` (a pure-JS RegExp
 * engine), not `@shikijs/engine-oniguruma` (WASM): no concrete reason surfaced for this phase to prefer
 * the marginally more TextMate-spec-complete WASM engine for a readonly, three-language
 * (TypeScript/Vue/JSON), Lab-curated source viewer. The JS engine avoids a second binary asset
 * (loading/instantiating a `.wasm` module) entirely — the explorer's lazy chunk stays a single
 * ordinary `import()` graph, matching this app's "no CDN, no extra binary asset class" posture
 * elsewhere (issue #30 Scope A).
 *
 * Grammar scope, deliberately narrow: only `typescript`/`vue`/`json` are registered (the three
 * languages every curated file in `src/showcases/*\/sources.ts` / `src/sandbox/sources.ts` actually
 * uses) — not the additional grammars (`javascript`/`css`/`html`/...) a Vue SFC's own TextMate grammar
 * can embed. None of the curated renderer files in this app use a `<style>` block or non-`<script
 * setup lang="ts">` script block, so the embedded regions those extra grammars would cover do not
 * occur in practice; where a `<template>` tag/attribute region would benefit from `text.html.basic`,
 * it renders as plain (unhighlighted) text instead of throwing — vscode-textmate resolves an
 * unregistered embedded scope reference by leaving that region untokenized, not by failing the whole
 * grammar. Documented here as a known, accepted trade-off rather than a silent gap.
 */

import type { HighlighterCore } from '@shikijs/core'
import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import jsonGrammar from 'tm-grammars/grammars/json.json'
import typescriptGrammar from 'tm-grammars/grammars/typescript.json'
import vueGrammar from 'tm-grammars/grammars/vue.json'
import oneDarkProTheme from 'tm-themes/themes/one-dark-pro.json'

export type ImplementationLang = 'typescript' | 'vue' | 'json'

const THEME_NAME = 'one-dark-pro'

let highlighterPromise: Promise<HighlighterCore> | null = null

function ensureHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		engine: createJavaScriptRegexEngine(),
		themes: [oneDarkProTheme as any],
		langs: [typescriptGrammar as any, vueGrammar as any, jsonGrammar as any],
	})
	return highlighterPromise
}

/** Renders `code` to a self-contained highlighted HTML fragment (readonly — no editor semantics). */
export async function highlightSource(code: string, lang: ImplementationLang): Promise<string> {
	const highlighter = await ensureHighlighter()
	return highlighter.codeToHtml(code, { lang, theme: THEME_NAME })
}

/** File-extension -> curated-language mapping shared by every `ImplementationFile.vue` caller. */
export function languageForPath(path: string): ImplementationLang {
	if (path.endsWith('.vue'))
		return 'vue'
	if (path.endsWith('.json'))
		return 'json'
	return 'typescript'
}
