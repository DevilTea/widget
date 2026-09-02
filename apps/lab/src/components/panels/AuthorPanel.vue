<script setup lang="ts">
import { ref } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import AuthorCatalogView from '../author/AuthorCatalogView.vue'
import AuthorJsonView from '../author/AuthorJsonView.vue'
import AuthorStatusSurface from '../author/AuthorStatusSurface.vue'
import AuthorStructureView from '../author/AuthorStructureView.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const i18n = useLabI18n()
// JSON remains the initial view so the former Source panel's eager Monaco mount and loading contract stay intact.
const view = ref<'catalog' | 'structure' | 'json'>('json')
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:author"
			text="Author workspace for the current Document: browse Core catalog metadata, edit Structure, or use expert JSON"
		/>
		<AuthorStatusSurface />
		<div
			:class="pika({ display: 'flex', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })"
			role="tablist"
			:aria-label="i18n.t('Author views')"
		>
			<button
				v-for="tab in ['catalog', 'structure', 'json'] as const"
				:key="tab"
				type="button"
				role="tab"
				:aria-selected="view === tab"
				:class="pika({ flex: '1 1 auto', padding: '6px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				:style="{ fontWeight: view === tab ? '600' : 'normal', borderBottom: view === tab ? '2px solid var(--lab-color-accent)' : 'none' }"
				@click="view = tab"
			>
				{{ i18n.t(tab === 'catalog' ? 'Catalog' : tab === 'structure' ? 'Structure' : 'JSON') }}
			</button>
		</div>
		<div :class="pika({ flex: '1 1 auto', minHeight: '0' })">
			<AuthorCatalogView v-if="view === 'catalog'" />
			<AuthorStructureView v-else-if="view === 'structure'" />
			<AuthorJsonView v-else />
		</div>
	</div>
</template>
