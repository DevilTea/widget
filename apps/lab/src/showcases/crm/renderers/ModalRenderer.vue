<script setup lang="ts">
/**
 * Renderer visibility follows semantic `open` (checkpoint §2): the `body`/`footer` slot subtree is only
 * mounted in the Vue tree while `open === true`, but the Runtime widgets living there (`DealStageForm`
 * and its children) exist independently — `Button#change-stage` can invoke `deal-stage-form.open()`
 * (which itself invokes `Modal.open()`) while this subtree is unmounted, and that invocation succeeds
 * purely through `@deviltea/widget-core` dependency wiring, never through the Vue component tree
 * (checkpoint §3 "semantic availability is independent of current component visibility").
 *
 * `Modal#stage-modal` is the preset's single instance, so hardcoding its title here (matching
 * `../presets.ts`'s configured `title` verbatim) carries no per-instance ambiguity.
 *
 * Issue #28 accessibility fix — dialog semantics/focus/Escape now live here, on top of the native
 * `<dialog>` element, driven one-way from the semantic `open` State (never the reverse): `open` is the
 * single source of truth, this renderer only projects it onto `<dialog>`'s own open/closed machinery.
 * Native `showModal()` gives two things for free, matching the "dialog lacks focus behavior" issue
 * baseline without any hand-rolled logic: (1) the background becomes `inert` automatically, so
 * Tab/Shift+Tab can never reach it while the dialog is open — no custom focus trap needed; (2) Escape
 * fires a cancelable `cancel` event instead of silently closing.
 *
 * We still intercept `cancel` rather than letting the browser's default apply, for two reasons: (a) the
 * Runtime's `open` State must stay authoritative — the native element must never close "out from under"
 * it — so every close, Escape included, is routed through the semantic `close()` Method and the
 * open→dialog-attribute sync lives in one place (the watcher below); (b) `Modal` is a reusable
 * primitive (checkpoint §2) shared by any consumer, so this generic renderer cannot know about a
 * specific consumer's own cancel semantics (e.g. `DealStageForm.cancel()`, `../plugins/deal-stage-form.ts`)
 * — routing Escape through `Modal.close()` is the only generic choice available to it. This is provably
 * safe for the one consumer wired today: `DealStageForm.cancel()` does nothing but invoke this same
 * `Modal.close()` — no `DealStore.updateStage` call, no other mutation (only `DealStageForm.save()`
 * ever calls `DealStore.updateStage`) — so Escape and `DealStageForm.cancel()` are observably identical
 * here, and reopening later re-derives a fresh `stage-editor` value from `DealStageForm.open()`, so no
 * stale state survives an Escape-driven close either.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, nextTick, useId, useTemplateRef, watch } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { ModalPlugin } from '../plugins/actions'

const { useState, useMethods, WidgetSlot, widgetId, widgetType } = useWidget(ModalPlugin)
const { open } = useState()
const { close } = useMethods()

const titleId = useId()
const dialogRef = useTemplateRef<HTMLDialogElement>('dialog')
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
// `data-tutorial-target` (issue #25 P4): `stage-modal` is this preset's only `Modal` instance.
const tutorialTarget = computed(() => (widgetId === 'stage-modal' ? 'crm-stage-modal' : undefined))

// The element focus should return to once the dialog closes ("closing returns focus to the invoking
// element when practical"), captured the instant before `showModal()` moves focus away from it.
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Generic "first focusable descendant" — this renderer has no consumer-specific notion of which
 * control is the most sensible initial focus target, so it takes the first one in document order. */
function focusFirstControl(dialog: HTMLDialogElement): void {
	dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
		?.focus()
}

watch(open, async (isOpen) => {
	const dialog = dialogRef.value
	if (dialog === null)
		return

	if (isOpen) {
		if (dialog.open)
			return
		previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
		dialog.showModal()
		// The body/footer slot subtree below only mounts once `open` flips true (see file header); wait
		// for that render to land before hunting for its first focusable control.
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

// Escape's native `cancel` event is cancelable and fires before the browser would close the dialog
// itself; prevent that default so `open` stays the only thing that ever closes this dialog, then route
// through the same semantic `close()` every other close path uses (see file header for why this is
// safe generically).
function onCancel(event: Event): void {
	event.preventDefault()
	close()
}

// Defensive resync, not an expected path today: `showModal()` dialogs only close via `cancel` or our
// own `dialog.close()` call above (both already keep `open`/the element in sync). If the element ever
// closes some other way this renderer did not initiate, this keeps the Runtime authoritative instead of
// letting the DOM silently disagree with `open`.
function onNativeClose(): void {
	if (open.value)
		close()
}
</script>

<template>
	<dialog
		ref="dialog"
		v-bind="inspectAnchor"
		:data-tutorial-target="tutorialTarget"
		:aria-labelledby="titleId"
		:class="pika({ 'padding': '0', 'border': 'none', 'background': 'transparent', '$::backdrop': { background: 'color-mix(in srgb, black 55%, transparent)' } })"
		@cancel="onCancel"
		@close="onNativeClose"
	>
		<div :class="pika({ minWidth: '320px', maxWidth: '420px', padding: '16px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', display: 'flex', flexDirection: 'column', gap: '12px' })">
			<h3
				:id="titleId"
				:class="pika({ margin: '0', fontSize: '14px' })"
			>
				Change deal stage
			</h3>
			<template v-if="open">
				<WidgetSlot name="body" />
				<div :class="pika({ display: 'flex', justifyContent: 'flex-end', gap: '8px' })">
					<WidgetSlot name="footer" />
				</div>
			</template>
		</div>
	</dialog>
</template>
