<script setup lang="ts">
/**
 * Hand-written pack. Presentation only: a button that calls Method `ask()` and a native `<dialog>` opened with `showModal()`
 * while State `confirming` is true. The dialog lives inside the Preview frame document, so its top layer, its inertness and its
 * focus trap are the frame's: the Lab shell around the iframe stays operable. Confirm and Cancel call the Methods; the Esc key
 * is Cancel. Whether confirming is allowed, and what it notifies, is the plugin's.
 *
 * Side by side, the dialog is drawn by the pack whose button asked (`PacksHost`), so a page has one open confirmation.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useInspectAnchor } from '../../../../showcase-host'
import { DangerActionPlugin } from '../../plugins/danger-action'
import { usePacksHost, usePacksText } from '../use-packs-text'

const { useState, useProperties, useMethods, widgetId, widgetType } = useWidget(DangerActionPlugin)
const { confirming } = useState()
const { label, confirmText, density } = useProperties()
const { ask, cancel, confirm } = useMethods()
const { t, text } = usePacksText()
const { host, ownsDialog } = usePacksHost('hand')
const anchor = useInspectAnchor(widgetId, widgetType)
const titleId = useId()
const dialog = ref<HTMLDialogElement | null>(null)

const asking = computed(() => confirming.value === true)
const open = computed(() => asking.value && ownsDialog(widgetId))
const elsewhere = computed(() => asking.value && !open.value)

watch([open, dialog], ([isOpen, element]) => {
	if (element === null)
		return
	if (isOpen && !element.open)
		element.showModal()
	else if (!isOpen && element.open)
		element.close()
}, { flush: 'post', immediate: true })

onBeforeUnmount(() => {
	if (dialog.value?.open)
		dialog.value.close()
})

function onAsk(): void {
	host.noteAsker(widgetId, 'hand')
	ask()
}

/** The Esc key: the dialog stays until the Method has changed State, which closes it. */
function onCancelEvent(event: Event): void {
	event.preventDefault()
	cancel()
}

/** A close that State did not ask for (the browser closed the dialog): the question is over, so State says so. */
function onClose(): void {
	if (open.value)
		cancel()
}
</script>

<template>
	<div
		v-bind="anchor"
		:data-tutorial-target="`packs-${widgetId}`"
		class="danger"
		:data-packs-density="density ?? 'comfortable'"
	>
		<button
			type="button"
			class="danger-button"
			aria-haspopup="dialog"
			:data-testid="`hand-ask-${widgetId}`"
			@click="onAsk"
		>
			{{ label === null ? widgetId : text(label) }}
		</button>
		<p
			v-if="elsewhere"
			class="danger-elsewhere"
		>
			{{ t('confirmingElsewhere') }}
		</p>
		<dialog
			ref="dialog"
			class="danger-dialog"
			:aria-labelledby="titleId"
			:data-testid="`hand-dialog-${widgetId}`"
			@cancel="onCancelEvent"
			@close="onClose"
		>
			<h5
				:id="titleId"
				class="danger-dialog-title"
			>
				{{ t('confirmTitle') }}
			</h5>
			<p class="danger-dialog-text">
				{{ confirmText === null ? '' : text(confirmText) }}
			</p>
			<div class="danger-dialog-actions">
				<button
					type="button"
					class="danger-dialog-button"
					autofocus
					:data-testid="`hand-cancel-${widgetId}`"
					@click="cancel()"
				>
					{{ t('cancel') }}
				</button>
				<button
					type="button"
					class="danger-dialog-button danger-dialog-button--danger"
					:data-testid="`hand-confirm-${widgetId}`"
					@click="confirm()"
				>
					{{ t('confirm') }}
				</button>
			</div>
		</dialog>
	</div>
</template>

<style scoped>
.danger {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 12px;
}

.danger-button,
.danger-dialog-button {
	min-width: 24px;
	min-height: var(--packs-control-height);
	padding: 4px 14px;
	border: 1px solid var(--packs-control-border);
	border-radius: var(--packs-radius);
	background: transparent;
	color: var(--packs-text);
	font: inherit;
	font-size: 14px;
	font-weight: 600;
	cursor: pointer;
}

.danger-button {
	border-color: var(--packs-danger);
	color: var(--packs-danger);
}

.danger-dialog-button--danger {
	border-color: var(--packs-danger);
	background: var(--packs-danger);
	color: var(--packs-on-danger);
}

.danger-button:focus-visible,
.danger-dialog-button:focus-visible {
	outline: 2px solid var(--packs-accent);
	outline-offset: 2px;
}

.danger-elsewhere {
	margin: 0;
	font-size: 13px;
	color: var(--packs-text-muted);
}

.danger-dialog {
	box-sizing: border-box;
	width: min(420px, calc(100% - 32px));
	padding: 16px;
	border: 1px solid var(--packs-border);
	border-radius: var(--packs-radius);
	background: var(--packs-surface);
	color: var(--packs-text);
}

.danger-dialog::backdrop {
	background: rgb(0 0 0 / 55%);
}

.danger-dialog-title {
	margin: 0 0 8px;
	font-size: 17px;
}

.danger-dialog-text {
	margin: 0 0 16px;
}

.danger-dialog-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
