<script setup lang="ts">
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import AuthorCatalogView from '../author/AuthorCatalogView.vue'
import AuthorJsonView from '../author/AuthorJsonView.vue'
import AuthorStructureView from '../author/AuthorStructureView.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const i18n = useLabI18n()
const store = useLabStore()
// JSON remains the initial view so the former Source panel's eager Monaco mount and loading contract stay intact.
// The open view lives on the store so other surfaces (the stale-preview notice's "Show problems") can open JSON.
const view = store.authorView
</script>

<template>
	<div class="flex flex-col h-full min-h-0">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:author"
			text="Author workspace for the current Document: browse Core catalog metadata, edit Structure, or use expert JSON"
		/>
		<div
			class="flex border-b border-b-lab-border flex-none"
			role="tablist"
			:aria-label="i18n.t('Author views')"
		>
			<button
				v-for="tab in ['catalog', 'structure', 'json'] as const"
				:key="tab"
				type="button"
				role="tab"
				:aria-selected="view === tab"
				class="flex-auto p-[6px] text-[11px] [border:none] bg-transparent text-lab-text cursor-pointer"
				:style="{ fontWeight: view === tab ? '600' : 'normal', borderBottom: view === tab ? '2px solid var(--lab-color-accent)' : 'none' }"
				@click="view = tab"
			>
				{{ i18n.t(tab === 'catalog' ? 'Catalog' : tab === 'structure' ? 'Structure' : 'JSON') }}
			</button>
		</div>
		<div class="flex-auto min-h-0">
			<AuthorCatalogView v-if="view === 'catalog'" />
			<AuthorStructureView v-else-if="view === 'structure'" />
			<AuthorJsonView v-else />
		</div>
	</div>
</template>
