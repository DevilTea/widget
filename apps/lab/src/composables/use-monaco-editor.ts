/**
 * Thin `modern-monaco` integration boundary for the Source panel.
 *
 * Monaco remains presentation-only and self-hosted. #44 preloads bundled light/dark themes and switches
 * presentation in place without replacing the text model; #46 keeps literal tabs on the shared
 * four-column model contract.
 */

import type { Ref } from 'vue'
import jsonGrammar from 'tm-grammars/grammars/json.json'
import oneDarkProTheme from 'tm-themes/themes/one-dark-pro.json'
import oneLightTheme from 'tm-themes/themes/one-light.json'
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { CODE_TAB_SIZE } from '../code-view/settings'
import { syntaxThemeForLabTheme } from '../theme/theme'
import { useLabTheme } from './use-lab-theme'

type Monaco = Awaited<ReturnType<typeof import('modern-monaco/core').init>>
type MonacoEditor = ReturnType<Monaco['editor']['create']>
type MonacoModel = ReturnType<Monaco['editor']['createModel']>

let monacoPromise: Promise<Monaco> | null = null

function ensureMonaco(): Promise<Monaco> {
	// Theme objects are passed directly so modern-monaco never resolves theme names through its CDN
	// fallback. The LSP-free `core` entry likewise preserves #30's same-origin/self-contained contract.
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
		model.updateOptions({ tabSize: CODE_TAB_SIZE })
		editor = monaco.editor.create(el, {
			model,
			automaticLayout: true,
			minimap: { enabled: false },
			fontSize: 13,
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
