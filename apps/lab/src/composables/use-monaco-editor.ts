/**
 * Thin `modern-monaco` integration boundary for the Source panel.
 *
 * Monaco remains presentation-only and self-hosted. #44 preloads bundled light/dark themes and switches
 * presentation in place without replacing the text model; #46 keeps literal tabs on the shared
 * four-column model contract.
 */

import type { Ref } from 'vue'
import jsonGrammar from 'tm-grammars/grammars/json.json'
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { CODE_TAB_SIZE } from '../code-view/settings'
import { labOneDarkProTheme, labOneLightTheme } from '../theme/monaco-themes'
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
		themes: [labOneLightTheme as any, labOneDarkProTheme as any],
		langs: [jsonGrammar as any],
	}))
	return monacoPromise
}

/** An error marker (squiggle) over a half-open character range of the editor text. */
export interface EditorMarker {
	readonly start: number
	readonly end: number
	/** Shown verbatim in the hover. */
	readonly message: string
	/** Optional short code shown next to the message (a Core diagnostic code). */
	readonly code?: string
}

export interface UseMonacoJsonEditorOptions {
	readonly modelValue: Ref<string>
	readonly onChange: (text: string) => void
	/** Error markers to show; offsets refer to `modelValue`'s text. */
	readonly markers?: Readonly<Ref<readonly EditorMarker[]>>
	/** Invoked by the editor's Cmd/Ctrl+Enter command (Monaco otherwise inserts a line there): commit the text now. */
	readonly onCommit?: () => void
	/** The commit action's name in the command palette, in the Lab language (it follows a language switch). */
	readonly commitLabel?: Readonly<Ref<string>>
	/** The editor (its text or one of its own widgets, such as Find) got keyboard focus. */
	readonly onFocus?: () => void
	/** Keyboard focus left the editor and its widgets, or the editor went away while it had focus. */
	readonly onBlur?: () => void
}

export interface UseMonacoJsonEditorResult {
	readonly ready: Readonly<Ref<boolean>>
	/** Selects the range, scrolls it into view and focuses the editor. No-op before the editor is ready. */
	revealRange: (start: number, end: number) => void
}

const COMMIT_ACTION_ID = 'widget-lab.commit-json'
const ERROR_RULER_COLOR = '#e5484d'

/** Hover text is Markdown; diagnostic messages are plain text, so escape every Markdown control character. */
function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&')
}

export function useMonacoJsonEditor(container: Ref<HTMLElement | null>, options: UseMonacoJsonEditorOptions): UseMonacoJsonEditorResult {
	const theme = useLabTheme()
	const ready = shallowRef(false)
	let monaco: Monaco | null = null
	let editor: MonacoEditor | null = null
	let model: MonacoModel | null = null
	let applyingExternalChange = false
	let commitAction: { dispose: () => void } | null = null
	let markerCollection: ReturnType<MonacoEditor['createDecorationsCollection']> | null = null

	/**
	 * Renders the markers as error squiggles. They are model decorations with Monaco's own `squiggly-error`
	 * class rather than `setModelMarkers()` markers: in the vendored `editor-core` build, markers reach the
	 * marker service but never become decorations (verified in the browser: the service holds them,
	 * `getAllDecorations()` has no `squiggly-error` entry), so nothing would be drawn. The hover shows the
	 * code and message verbatim.
	 */
	function syncMarkers(): void {
		if (editor === null || model === null)
			return
		const current = model
		const markers = options.markers?.value ?? []
		markerCollection ??= editor.createDecorationsCollection()
		markerCollection.set(markers.map((marker) => {
			// `getPositionAt` clamps to the model, so a marker computed for slightly older text can never throw.
			const from = current.getPositionAt(marker.start)
			const to = current.getPositionAt(Math.max(marker.end, marker.start + 1))
			return {
				range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column },
				options: {
					className: 'squiggly-error',
					hoverMessage: { value: escapeMarkdown(marker.code === undefined ? marker.message : `${marker.code}: ${marker.message}`) },
					overviewRuler: { color: ERROR_RULER_COLOR, position: 4 /* OverviewRulerLane.Right */ },
				},
			}
		}))
	}

	// A reveal asked for before the editor finished loading (Monaco is imported lazily) is replayed once it is up.
	let pendingReveal: { readonly start: number, readonly end: number } | null = null

	function revealRange(start: number, end: number): void {
		if (editor === null || model === null) {
			pendingReveal = { start, end }
			return
		}
		const from = model.getPositionAt(start)
		const to = model.getPositionAt(end)
		const range = { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }
		editor.setSelection(range)
		editor.revealRangeInCenterIfOutsideViewport(range)
		editor.focus()
	}

	/**
	 * Monaco binds Cmd/Ctrl+Enter to "insert line below"; committing the text now takes it instead (audit U05 gave the key to
	 * Apply; Lab UX phase 3 has no Apply, and the key keeps its "make it take effect now" meaning). An action rather than
	 * `addCommand()`: a command registers a global dynamic keybinding whose disposable is discarded, so every remount
	 * of the editor would leak one; the action's keybinding is released with the action (disposed below, and here
	 * when the label changes with the Lab language, which re-registers it under the new name).
	 */
	function registerCommitAction(): void {
		if (editor === null || monaco === null)
			return
		commitAction?.dispose()
		commitAction = editor.addAction({
			id: COMMIT_ACTION_ID,
			label: options.commitLabel?.value ?? 'Apply the JSON now',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
			run: () => options.onCommit?.(),
		})
	}

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
		// The editor widget, not only its text area: Find and the other editor widgets belong to the same editing session.
		editor.onDidFocusEditorWidget(() => options.onFocus?.())
		// The window or tab losing focus blurs the editor too, but the user has not left it (alt-tab and back is one editing
		// session, one Undo entry): only a blur within a focused document counts. Focus coming back reports a focus again,
		// which continues the open session (`LabStore.beginJsonEdit()`).
		editor.onDidBlurEditorWidget(() => {
			if (document.hasFocus())
				options.onBlur?.()
		})
		registerCommitAction()
		syncMarkers()
		ready.value = true
		if (pendingReveal !== null) {
			revealRange(pendingReveal.start, pendingReveal.end)
			pendingReveal = null
		}
	})

	if (options.markers !== undefined)
		watch(options.markers, syncMarkers, { flush: 'post' })

	if (options.commitLabel !== undefined)
		watch(options.commitLabel, registerCommitAction)

	watch(theme.theme, (next) => {
		monaco?.editor.setTheme(syntaxThemeForLabTheme(next))
	})

	watch(options.modelValue, (next) => {
		if (model === null || model.getValue() === next)
			return
		applyingExternalChange = true
		model.setValue(next)
		applyingExternalChange = false
		syncMarkers()
	})

	onBeforeUnmount(() => {
		// The view went away while the user was editing (no blur reaches a disposed editor): end the editing session anyway.
		if (editor?.hasWidgetFocus() === true)
			options.onBlur?.()
		commitAction?.dispose()
		commitAction = null
		editor?.dispose()
		model?.dispose()
	})

	return { ready, revealRange }
}
