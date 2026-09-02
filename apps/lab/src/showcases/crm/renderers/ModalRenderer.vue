<script setup lang="ts">
/**
 * Renderer visibility follows semantic `open` (checkpoint §2): the `body`/`footer` slot subtree is only
 * mounted in the Vue tree while `open === true`, but the Runtime widgets living there (`DealStageForm`
 * and its children) exist independently — `Button#change-stage` can invoke `deal-stage-form.open()`
 * (which itself invokes `Modal.open()`) while this subtree is unmounted, and that invocation succeeds
 * purely through `@deviltea/widget-core` dependency wiring, never through the Vue component tree.
 *
 * `Modal#stage-modal` is the preset's single instance, so hardcoding its title here carries no
 * per-instance ambiguity; #43 treats that title as renderer-owned presentation chrome.
 *
 * Diagnostic #28 accessibility fix — native dialog semantics/focus/Escape are driven one-way from the
 * semantic `open` State. Runtime remains authoritative; Escape routes through the semantic `close()`
 * Method and no renderer-local state participates in the interaction contract.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, nextTick, useId, useTemplateRef, watch } from 'vue'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { ModalPlugin } from '../plugins/actions'

const { useState, useMethods, WidgetSlot, widgetId, widgetType } = useWidget(ModalPlugin)
const { open } = useState()
const { close } = useMethods()
const i18n = useLabI18n()

const titleId = useId()
const dialogRef = useTemplateRef<HTMLDialogElement>('dialog')
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
const tutorialTarget = computed(() => (widgetId === 'stage-modal' ? 'crm-stage-modal' : undefined))

let previouslyFocused: HTMLElement | null = null

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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

function onCancel(event: Event): void {
	event.preventDefault()
	close()
}

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
				{{ i18n.t('Change deal stage') }}
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
