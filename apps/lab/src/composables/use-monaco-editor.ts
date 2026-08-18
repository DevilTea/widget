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
 * - the editor engine itself is self-hosted rather than fetched from modern-monaco's default CDN;
 * - #44 preloads both light/dark theme objects and switches Monaco presentation in place, without
 *   replacing the text model or crossing the Lab's semantic Apply boundary.
 */

import type { Ref } from 'vue'
import jsonGrammar from 'tm-grammars/grammars/json.json'
import oneDarkProTheme from 'tm-themes/themes/one-dark-pro.json'
import oneLightTheme from 'tm-themes/themes/one-light.json'
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { syntaxThemeForLabTheme } from '../theme/theme'
import { useLabTheme } from './use-lab-theme'

type Monaco = Awaited<ReturnType<typeof import('modern-monaco/core').init>>
type MonacoEditor = ReturnType<Monaco['editor']['create']>
type MonacoModel = ReturnType<Monaco['editor']['createModel']>

let monacoPromise: Promise<Monaco> | null = null

function ensureMonaco(): Promise<Monaco> {
	monacoPromise ??= import('modern-monaco/core').then(({ init }) => init({
		themes: [oneLightTheme as any, oneDarkProTheme as any],
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
	const theme = useLabTheme()
	const ready = shallowRef(false)
	let monaco: Monaco | null = null
	let editor: MonacoEditor | null = null
	let model: MonacoModel | null = null
	let applyingExternalChange = false

	onMounted(async () => {
		monaco = await ensureMonaco()
		const el = container.value
		if (el === null)
			return

		monaco.editor.setTheme(syntaxThemeForLabTheme(theme.theme.value))
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

	watch(theme.theme, (next) => {
		monaco?.editor.setTheme(syntaxThemeForLabTheme(next))
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
