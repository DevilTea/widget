<script setup lang="ts">
/** Runtime inspector. #43 localizes explanatory Lab chrome only; Runtime member names/values/issues stay verbatim. */
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { useRuntimeInspection } from '../../runtime-inspector/use-runtime-inspection'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'
import RuntimeNodeDetails from '../runtime/RuntimeNodeDetails.vue'
import RuntimeTree from '../runtime/RuntimeTree.vue'

const store = useLabStore()
const i18n = useLabI18n()
const runtimeInspection = useRuntimeInspection()
const selectedNodeId = computed(() => store.focus.value?.nodeId ?? null)
</script>

<template>
	<div
		data-tutorial-target="runtime"
		:class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })"
	>
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:runtime"
			text="Live State, Properties, Methods, and Issues of the running widgets"
		/>
		<div
			v-if="runtimeInspection === null"
			:class="pika({ padding: '16px', fontSize: '12px', lineHeight: '1.5', color: 'var(--lab-color-text-muted)' })"
		>
			{{ i18n.t('Runtime unavailable — the applied Blueprint is invalid, so there is nothing running yet. Open the Blueprint tab to see why, fix Source, then Apply again.') }}
		</div>
		<div
			v-else
			:class="pika({ display: 'grid', gridTemplateColumns: 'minmax(180px, 0.8fr) minmax(260px, 1.2fr)', flex: '1 1 auto', minHeight: '0' })"
		>
			<div :class="pika({ overflow: 'auto', borderRight: '1px solid var(--lab-color-border)', minHeight: '0' })">
				<RuntimeTree
					:inspection="runtimeInspection"
					:selectedNodeId="selectedNodeId"
					@select="store.setFocus({ nodeId: $event })"
				/>
			</div>
			<div :class="pika({ overflow: 'auto', minHeight: '0' })">
				<RuntimeNodeDetails
					:inspection="runtimeInspection"
					:selectedNodeId="selectedNodeId"
				/>
			</div>
		</div>
	</div>
</template>
