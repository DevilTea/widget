<script setup lang="ts">
/**
 * The Edit tab (Lab UX phase 3B; it was the Author panel): the current Document as Structure (the default view) or as JSON,
 * switched with an in-panel segmented toggle, and "Browse widget types", which opens the Catalog in a slide-over
 * (`CatalogDialog.vue`) instead of replacing the view the user is editing in.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import { shallowRef } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import AuthorJsonView from '../author/AuthorJsonView.vue'
import AuthorStructureView from '../author/AuthorStructureView.vue'
import CatalogDialog from '../author/CatalogDialog.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const i18n = useLabI18n()
const store = useLabStore()
// Structure is the initial view (Lab UX phase 1: newcomers start from the form, not the expert JSON), so Monaco loads when
// the JSON view is first opened. The open view lives on the store so other surfaces (the stale-preview notice's "Show
// problems", the problems chip, the tutorial) can open JSON.
const view = store.authorView
const catalogOpen = shallowRef(false)
</script>

<template>
	<div class="flex flex-col h-full min-h-0">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:edit"
			text="Edit the current document in Structure or as JSON. Each change applies at once, and Undo takes it back."
		/>
		<div class="flex flex-none flex-wrap items-center gap-2 border-b border-b-lab-border px-2.5 py-1">
			<div
				class="inline-flex rounded-lab border border-lab-border bg-lab-surface-alt p-0.5"
				role="tablist"
				:aria-label="i18n.t('Edit views')"
			>
				<button
					v-for="tab in ['structure', 'json'] as const"
					:key="tab"
					type="button"
					role="tab"
					:data-testid="`author-view-${tab}`"
					:aria-selected="view === tab"
					class="min-h-6 min-w-20 cursor-pointer rounded-lab border-0 px-3 text-[11px] text-lab-text"
					:class="view === tab ? 'bg-lab-surface font-semibold' : 'bg-transparent'"
					:style="{ boxShadow: view === tab ? 'inset 0 -2px 0 var(--lab-color-accent)' : 'none' }"
					@click="view = tab"
				>
					{{ i18n.t(tab === 'structure' ? 'Structure' : 'JSON') }}
				</button>
			</div>
			<UButton
				data-testid="browse-widget-types"
				color="neutral"
				variant="outline"
				size="xs"
				icon="i-lucide-library"
				class="ml-auto"
				aria-haspopup="dialog"
				:label="i18n.t('Browse widget types')"
				@click="catalogOpen = true"
			/>
		</div>
		<div class="flex-auto min-h-0">
			<AuthorStructureView v-if="view === 'structure'" />
			<AuthorJsonView v-else />
		</div>
		<CatalogDialog v-model:open="catalogOpen" />
	</div>
</template>
