/**
 * Generic native-`<dialog>` modal-focus binding (issue #25 P1 merge-gate review, blocker 1).
 *
 * `isOpen` remains the caller's single source of truth. #45 adds an optional presentation-only
 * `canShowModal` gate: when the workbench is below its supported viewport width, a pending welcome/
 * confirmation state stays true but its native dialog is removed from the browser top layer so the
 * narrow-viewport gate can own the experience. Widening reopens the same pending dialog; no tutorial,
 * draft, Runtime, semantic state, or original focus-return target is reset.
 */

import { nextTick, useTemplateRef, watch } from 'vue'

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusFirstControl(dialog: HTMLDialogElement): void {
	dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
		?.focus()
}

export interface UseModalDialogOptions {
	/** The single source of truth for whether the application wants this dialog open. */
	isOpen: { readonly value: boolean }
	/**
	 * Optional presentation gate. `false` suppresses the native top-layer dialog without changing
	 * `isOpen`; switching back to `true` reopens it. Defaults to enabled.
	 */
	canShowModal?: { readonly value: boolean }
	/** Escape/native-cancel path; caller must update its own `isOpen` source through the normal action. */
	onCancel: () => void
}

export interface UseModalDialog {
	dialogRef: ReturnType<typeof useTemplateRef<HTMLDialogElement>>
	onCancel: (event: Event) => void
	onNativeClose: () => void
}

export function useModalDialog(templateRef: string, options: UseModalDialogOptions): UseModalDialog {
	const dialogRef = useTemplateRef<HTMLDialogElement>(templateRef)
	let previouslyFocused: HTMLElement | null = null
	let focusReturnCaptured = false
	let pendingPresentationCloseEvents = 0

	watch(
		() => [options.isOpen.value, options.canShowModal?.value ?? true] as const,
		async ([isOpen, canShowModal]) => {
			// Capture exactly once per semantic open lifecycle. A viewport-driven close/reopen is only a
			// presentation transition and must not replace the original Tutorial/Restart initiator with
			// whatever happens to be focused while the narrow gate owns the page.
			if (isOpen && !focusReturnCaptured) {
				previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
				focusReturnCaptured = true
			}

			await nextTick()
			const dialog = dialogRef.value
			if (dialog === null)
				return

			const shouldShow = isOpen && canShowModal
			if (shouldShow) {
				if (dialog.open)
					return
				dialog.showModal()
				await nextTick()
				focusFirstControl(dialog)
				return
			}

			if (dialog.open) {
				if (isOpen && !canShowModal)
					pendingPresentationCloseEvents++
				dialog.close()
			}

			if (!isOpen) {
				if (previouslyFocused !== null && previouslyFocused.isConnected)
					previouslyFocused.focus()
				previouslyFocused = null
				focusReturnCaptured = false
			}
		},
		{ immediate: true },
	)

	return {
		dialogRef,
		onCancel: (event) => {
			event.preventDefault()
			options.onCancel()
		},
		onNativeClose: () => {
			// `dialog.close()` dispatches `close` asynchronously. Count presentation-only closes rather than
			// relying on the current viewport when the event eventually arrives; a rapid narrow -> wide
			// transition may already have reopened the dialog by then.
			if (pendingPresentationCloseEvents > 0) {
				pendingPresentationCloseEvents--
				return
			}
			if (options.isOpen.value)
				options.onCancel()
		},
	}
}
