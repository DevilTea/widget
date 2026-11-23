<script setup lang="ts">
/**
 * The Catalog as a slide-over of the Edit tab (Lab UX phase 3B): "Browse widget types" opens it, and it is no longer a peer
 * view of Structure and JSON. Its content is the Catalog view as it was (`AuthorCatalogView.vue`: the widget types with their
 * documentation, the config schemas, and "Copy catalog JSON").
 *
 * A native modal `<dialog>` (`useModalDialog`, the Lab's dialog pattern): the rest of the page is inert while it is open, so
 * Tab stays inside it; Escape and the close button close it; focus goes to its first control (the close button) and returns to
 * the control that opened it. Like the Lab's other dialogs it gives way to the narrow-viewport gate.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useModalDialog } from '../../composables/use-modal-dialog'
import { useSupportedWorkbenchViewport } from '../../composables/use-supported-workbench-viewport'
import AuthorCatalogView from './AuthorCatalogView.vue'

const open = defineModel<boolean>('open', { required: true })
const i18n = useLabI18n()
const supportedViewport = useSupportedWorkbenchViewport()

const { onCancel, onNativeClose } = useModalDialog('dialog', {
	isOpen: open,
	canShowModal: supportedViewport,
	onCancel: () => {
		open.value = false
	},
})
</script>

<template>
	<!-- eslint-disable vue/no-unused-refs -- consumed by `useModalDialog('dialog', ...)`. -->
	<dialog
		ref="dialog"
		data-testid="catalog-dialog"
		aria-labelledby="catalog-dialog-title"
		class="fixed inset-y-0 left-0 m-0 h-full max-h-none w-[min(560px,100vw)] max-w-none border-0 border-r border-r-lab-border bg-lab-surface p-0 text-lab-text shadow-lg backdrop:bg-black/40"
		@cancel="onCancel"
		@close="onNativeClose"
	>
		<div
			v-if="open"
			class="flex h-full min-h-0 flex-col"
		>
			<div class="flex flex-none items-center gap-2 border-b border-b-lab-border px-2.5 py-1.5">
				<h2
					id="catalog-dialog-title"
					class="m-0 flex-auto text-[13px] font-semibold"
				>
					{{ i18n.t('Widget types') }}
				</h2>
				<UButton
					data-testid="catalog-dialog-close"
					icon="i-lucide-x"
					color="neutral"
					variant="ghost"
					size="xs"
					square
					class="text-muted outline-primary hover:text-default focus-visible:outline-2"
					:aria-label="i18n.t('Close widget types')"
					@click="open = false"
				/>
			</div>
			<div class="min-h-0 flex-auto">
				<AuthorCatalogView />
			</div>
		</div>
	</dialog>
</template>
