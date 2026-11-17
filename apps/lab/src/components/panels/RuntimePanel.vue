<script setup lang="ts">
/**
 * Remote Runtime Inspector for Phase B2. The panel consumes only Inspector protocol DTOs from the
 * iframe-owned Runtime; it never imports `inspectRuntime()` and never receives a Core Runtime object.
 */
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { useSelectedRuntimeWidget } from '../../composables/use-selected-runtime-widget'
import { getRuntimeInspectorSource } from '../../runtime-inspector/source'
import InspectorPanelShell from '../inspector/InspectorPanelShell.vue'
import InspectorSplitLayout from '../inspector/InspectorSplitLayout.vue'
import RuntimeBlueprintTree from '../runtime/RuntimeBlueprintTree.vue'
import RuntimeNodeDetails from '../runtime/RuntimeNodeDetails.vue'

const store = useLabStore()
const i18n = useLabI18n()
const source = computed(() => getRuntimeInspectorSource(store.preview.value, store.documentState.value.revision))
const { connection, blueprint, selectedNodeId, selectedNode, widgetSnapshot } = useSelectedRuntimeWidget()

function selectNode(nodeId: number): void {
	store.setFocus('preview', { nodeId })
}
</script>

<template>
	<InspectorPanelShell
		storageKey="widget-lab:panel-desc:runtime"
		text="Live State, Properties, Methods, and Diagnostics of the running widgets"
	>
		<div :class="pika({ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', fontSize: '11px', flex: '0 0 auto' })">
			<strong>{{ i18n.t(source.previewRevision === null ? 'Preview unavailable' : 'Preview r{revision}', { revision: source.previewRevision ?? '' }) }}</strong>
			<span :style="{ color: source.isDiverged ? 'var(--lab-color-warning)' : 'var(--lab-color-text-muted)' }">
				{{ i18n.t(source.previewRevision === null ? 'Unlinked' : source.isDiverged ? 'Diverged / Unlinked' : 'Linked / Synced') }}
			</span>
		</div>
		<div
			v-if="blueprint === null"
			:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
		>
			<p>{{ i18n.t('Runtime unavailable — there is no valid Preview revision to inspect. Open Blueprint to see current diagnostics, fix Source, then Apply again.') }}</p>
		</div>
		<InspectorSplitLayout v-else>
			<template #tree>
				<RuntimeBlueprintTree
					:snapshot="blueprint"
					:selectedNodeId="selectedNodeId"
					@select="selectNode"
				/>
			</template>
			<template #details>
				<RuntimeNodeDetails
					:node="selectedNode"
					:widgetSnapshot="widgetSnapshot"
					:client="connection?.inspectorClient ?? null"
				/>
			</template>
		</InspectorSplitLayout>
	</InspectorPanelShell>
</template>
