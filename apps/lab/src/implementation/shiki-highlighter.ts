/**
 * Lazy, self-contained Shiki highlighter for the Implementation explorer.
 *
 * #44 loads both local Lab syntax themes inside this already-lazy chunk. No raw source or Shiki/theme
 * payload enters the initial shell; no theme id is fetched from a CDN at runtime.
 */

import type { HighlighterCore } from '@shikijs/core'
import type { LabTheme } from '../theme/theme'
import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import jsonGrammar from 'tm-grammars/grammars/json.json'
import typescriptGrammar from 'tm-grammars/grammars/typescript.json'
import vueGrammar from 'tm-grammars/grammars/vue.json'
import oneDarkProTheme from 'tm-themes/themes/one-dark-pro.json'
import oneLightTheme from 'tm-themes/themes/one-light.json'
import { syntaxThemeForLabTheme } from '../theme/theme'

export type ImplementationLang = 'typescript' | 'vue' | 'json'

let highlighterPromise: Promise<HighlighterCore> | null = null

function ensureHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		engine: createJavaScriptRegexEngine(),
		themes: [oneLightTheme as any, oneDarkProTheme as any],
		langs: [typescriptGrammar as any, vueGrammar as any, jsonGrammar as any],
	})
	return highlighterPromise
}

/** Renders `code` to a self-contained highlighted HTML fragment (readonly — no editor semantics). */
export async function highlightSource(code: string, lang: ImplementationLang, theme: LabTheme): Promise<string> {
	const highlighter = await ensureHighlighter()
	return highlighter.codeToHtml(code, { lang, theme: syntaxThemeForLabTheme(theme) })
}

/** File-extension -> curated-language mapping shared by every `ImplementationFile.vue` caller. */
export function languageForPath(path: string): ImplementationLang {
	if (path.endsWith('.vue'))
		return 'vue'
	if (path.endsWith('.json'))
		return 'json'
	return 'typescript'
}
