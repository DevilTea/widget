/**
 * Thin `modern-monaco` integration boundary for the Source panel.
 *
 * Normative source: issue #13 (Widget Lab Phase 4) comment "Widget Lab implementation stack". Keeps
 * the integration deliberately narrow:
 *
 * - one JSON `ITextModel` for the active source, created through `modern-monaco`'s manual `init()`
 *   API — no `Workspace`/virtual filesystem, so there is no IndexedDB-backed persistence that could
 *   become a second, competing source of truth for the Lab's `draftSourceText`;
 * - theme and JSON grammar are bundled from `tm-themes`/`tm-grammars` (no CDN dependency for those);
 * - the editor engine itself (`modern-monaco/editor-core`, what `init()` dynamically imports) is
 *   self-hosted rather than fetched from `modern-monaco`'s default esm.sh CDN (issue #30 Scope A): the
 *   root `<script type="importmap">` this app's Vite config injects
 *   (`../vite-plugin-vendor-modern-monaco-editor-core.ts`) maps the bare specifier
 *   `modern-monaco/editor-core` to a same-origin, base-aware URL, which `modern-monaco`'s own
 *   `loadMonaco()` reads and prefers over its CDN fallback — no runtime network dependency on a
 *   third-party host remains for the Source editor to initialize;
 * - the editor is presentation only: external `draftSourceText` changes (Revert, Format, preset
 *   selection) are pushed into the model, and the model's own edits are pushed back out through
 *   `onChange` — `JSON.parse` at Apply time remains the sole authoritative syntax boundary, never
 *   anything Monaco/LSP reports here. This is also why `ensureMonaco()` below imports
 *   `modern-monaco/core` rather than the package's main entry (verified, issue #30 Scope A): the main
 *   `modern-monaco` entry has a module-load side effect (`Object.assign(globalThis, { MonacoEnvironment:
 *   { useBuiltinLSP: true } })`) that makes `loadMonaco()` additionally fetch a built-in JSON language
 *   server from esm.sh the moment a `json` model is created — a feature this integration has never
 *   used or wanted (see the bullet above), so importing the LSP-free `core` entry both avoids a second
 *   class of CDN dependency and matches this module's actual, already-stated design intent instead of
 *   vendoring a capability nothing here consumes.
 *
 * `modern-monaco` is pinned to an exact version (pre-1.0, explicitly unstable) and isolated entirely
 * behind this module; nothing outside `src/components/editor/MonacoJsonEditor.vue` imports it.
 */

import type { Ref } from 'vue'
import jsonGrammar from 'tm-grammars/grammars/json.json'
import oneDarkProTheme from 'tm-themes/themes/one-dark-pro.json'
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'

type Monaco = Awaited<ReturnType<typeof import('modern-monaco/core').init>>
type MonacoEditor = ReturnType<Monaco['editor']['create']>
type MonacoModel = ReturnType<Monaco['editor']['createModel']>

let monacoPromise: Promise<Monaco> | null = null

function ensureMonaco(): Promise<Monaco> {
	// No `defaultTheme` option here on purpose (issue #30 Scope A): `modern-monaco`'s `initShiki()`
	// only falls back to fetching a theme by name from esm.sh when `defaultTheme` is a string it has to
	// resolve itself; passing the theme object below through `themes` already satisfies that, and
	// `loadMonaco()` unconditionally calls `monaco.editor.setTheme(highlighter.getLoadedThemes()[0])`
	// after init, so the one loaded theme (`themes[0]`, one-dark-pro) becomes active regardless. Adding
	// `defaultTheme: 'one-dark-pro'` back would make `initShiki()` treat it as a second, string-keyed
	// theme request and refetch `tm-themes@.../themes/one-dark-pro.json` from esm.sh at runtime.
	//
	// `modern-monaco/core` (not the package's main entry) on purpose (issue #30 Scope A, see file-level
	// comment): the main entry's module-load side effect turns on `useBuiltinLSP`, which makes
	// `loadMonaco()` fetch a JSON language server from esm.sh the first time a `json` model exists —
	// this integration never reads Monaco/LSP diagnostics, so that capability is both unused and, left
	// enabled, a CDN dependency with no purpose here.
	monacoPromise ??= import('modern-monaco/core').then(({ init }) => init({

		themes: [oneDarkProTheme as any],

		langs: [jsonGrammar as any],
	}))
	return monacoPromise
}

export interface UseMonacoJsonEditorOptions {
	readonly modelValue: Ref<string>
	readonly onChange: (text: string) => void
}

export interface UseMonacoJsonEditorResult {
	readonly ready: Readonly<Ref<boolean>>
}

export function useMonacoJsonEditor(container: Ref<HTMLElement | null>, options: UseMonacoJsonEditorOptions): UseMonacoJsonEditorResult {
	const ready = shallowRef(false)
	let editor: MonacoEditor | null = null
	let model: MonacoModel | null = null
	let applyingExternalChange = false

	onMounted(async () => {
		const monaco = await ensureMonaco()
		const el = container.value
		if (el === null)
			return

		model = monaco.editor.createModel(options.modelValue.value, 'json')
		editor = monaco.editor.create(el, {
			model,
			automaticLayout: true,
			minimap: { enabled: false },
			fontSize: 13,
			tabSize: 2,
			scrollBeyondLastLine: false,
		})
		editor.onDidChangeModelContent(() => {
			if (applyingExternalChange || model === null)
				return
			options.onChange(model.getValue())
		})
		ready.value = true
	})

	watch(options.modelValue, (next) => {
		if (model === null || model.getValue() === next)
			return
		applyingExternalChange = true
		model.setValue(next)
		applyingExternalChange = false
	})

	onBeforeUnmount(() => {
		editor?.dispose()
		model?.dispose()
	})

	return { ready }
}
