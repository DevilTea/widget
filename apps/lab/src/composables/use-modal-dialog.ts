/**
 * Generic native-`<dialog>` modal-focus binding (issue #25 P1 merge-gate review, blocker 1).
 *
 * Extracted from the exact proven pattern in `src/showcases/crm/renderers/ModalRenderer.vue` (issue #28
 * accessibility fix) — that component binds `showModal()`/`close()` one-way off a semantic `open`
 * State; this composable binds the identical mechanics one-way off any plain `Ref<boolean>`, for the two
 * P1 tutorial overlays (`WelcomeCard.vue`, `TutorialConfirmDialog.vue`) that have no semantic Runtime
 * State of their own to project. `isOpen` stays the single source of truth in both cases: this composable
 * only ever calls `showModal()`/`close()` in reaction to it, never the reverse.
 *
 * What native `showModal()` gives for free (matching the #28 baseline without hand-rolled logic):
 * (1) the rest of the page becomes `inert`, so Tab/Shift+Tab can never reach a background workbench
 * control while the dialog is open — no custom focus trap; (2) Escape fires a cancelable `cancel` event
 * instead of silently closing, letting the caller decide what "cancel" means for this dialog rather than
 * having the native element close out from under `isOpen`.
 */

import { nextTick, useTemplateRef, watch } from 'vue'

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Generic "first focusable descendant" — same choice `ModalRenderer.vue` makes, for the same reason:
 * this composable has no consumer-specific notion of which control is the most sensible initial target.
 */
function focusFirstControl(dialog: HTMLDialogElement): void {
	dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
		?.focus()
}

export interface UseModalDialogOptions {
	/** The single source of truth this dialog's `showModal()`/`close()` reacts to. */
	isOpen: { readonly value: boolean }
	/**
	 * Escape's `cancel` event handler. Must flip whatever governs `isOpen` back to `false` through the
	 * exact same path any other close affordance uses (e.g. the same method a "Cancel"/"Explore on my
	 * own" button calls) — this composable only prevents the native default close so `isOpen` stays
	 * authoritative; it never closes anything on its own.
	 */
	onCancel: () => void
}

export interface UseModalDialog {
	/**
	 * Bind to the `<dialog ref="dialog">` element with the literal name `"dialog"` (matching
	 * `templateRef` below). Returned mainly so the caller can re-export/inspect it if ever needed;
	 * `vue/no-unused-refs` cannot trace the by-name template-ref connection across this composable's
	 * own `useTemplateRef()` call into the consuming SFC, so each caller carries a narrowly-scoped
	 * `eslint-disable-next-line vue/no-unused-refs` on its `ref="dialog"` template attribute — the ref
	 * genuinely is used, by this composable, just not visibly to that rule's single-file analysis.
	 */
	dialogRef: ReturnType<typeof useTemplateRef<HTMLDialogElement>>
	/** Bind to `@cancel`. */
	onCancel: (event: Event) => void
	/**
	 * Bind to `@close` — a defensive resync for the (not expected in normal use) case where the native
	 * element closes some other way than this composable's own `dialog.close()` call.
	 */
	onNativeClose: () => void
}

/**
 * `templateRef` is the string name passed to `useTemplateRef()` — callers bind it via the literal
 * `<dialog ref="dialog" ...>` (when passing `'dialog'`), matching the by-name lookup convention
 * `useTemplateRef()` itself is built around.
 */
export function useModalDialog(templateRef: string, options: UseModalDialogOptions): UseModalDialog {
	const dialogRef = useTemplateRef<HTMLDialogElement>(templateRef)

	// The element focus should return to once the dialog closes ("closing restores focus to the
	// initiating control where one exists" — blocker 1). Captured the instant before `showModal()` moves
	// focus away from it; when there is no meaningful initiator (e.g. Welcome shows automatically on
	// first load, not from a click), this is typically `document.body` and the restore is a harmless
	// no-op — see each caller's own header comment for its specific case.
	let previouslyFocused: HTMLElement | null = null

	watch(() => options.isOpen.value, async (isOpen) => {
		// `WelcomeCard.vue` starts already `isOpen === true` at mount (unlike `ModalRenderer.vue`'s
		// semantic `open`, which always starts `false`) — so THIS watcher's very first, `immediate: true`
		// invocation runs synchronously during `setup()`, before the template's first render has committed
		// `dialogRef.value` at all. Awaiting a tick up front (before ever reading `dialogRef.value`, on
		// every invocation, not just the first) guarantees the ref is populated by the time this checks
		// it, rather than silently no-op'ing on that first call and never showing the dialog at all.
		await nextTick()
		const dialog = dialogRef.value
		if (dialog === null)
			return

		if (isOpen) {
			if (dialog.open)
				return
			previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
			dialog.showModal()
			// Content behind a `v-if="isOpen"` (if the caller has one) mounts only after this reactive
			// update lands — wait a tick before hunting for the first focusable control, same as
			// `ModalRenderer.vue`.
			await nextTick()
			focusFirstControl(dialog)
		}
		else {
			if (dialog.open)
				dialog.close()
			if (previouslyFocused !== null && previouslyFocused.isConnected)
				previouslyFocused.focus()
			previouslyFocused = null
		}
	}, { immediate: true })

	return {
		dialogRef,
		onCancel: (event) => {
			event.preventDefault()
			options.onCancel()
		},
		onNativeClose: () => {
			if (options.isOpen.value)
				options.onCancel()
		},
	}
}
