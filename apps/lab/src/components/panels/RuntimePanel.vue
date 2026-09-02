<script setup lang="ts">
/**
 * Runtime Inspector (diagnostic #13 Phase 5 "Runtime Inspector becomes strictly passive" / "inspectors are
 * readonly consumers of core inspection"). Strictly readonly: opening, selecting a widget/member, or
 * subscribing never calls `state.get()`/`property.get()`, invokes Methods, or otherwise drives Runtime
 * semantics — every fact comes from `@deviltea/widget-core/inspection`'s `inspectRuntime()`.
 *
 * Runtime/Blueprint source is always the Preview snapshot. An invalid current Document may therefore
 * coexist with a usable older Preview and must not make this panel consume a Document-scoped node id.
 * Reuses `BlueprintTree` for navigation: an `inspectRuntime(runtime).blueprint` is identity-equal to
 * `inspectBlueprint(runtime.blueprint)`, so the same tree/shared-focus contract applies within Preview.
 * #43 localizes only Lab-owned
 * explanatory chrome; Runtime member names, values, and core diagnostics remain verbatim.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { inspectRuntime } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { getRuntimeInspectorSource } from '../../runtime-inspector/source'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import InspectorPanelShell from '../inspector/InspectorPanelShell.vue'
import InspectorSplitLayout from '../inspector/InspectorSplitLayout.vue'
import RuntimeNodeDetails from '../runtime/RuntimeNodeDetails.vue'

const store = useLabStore()
const i18n = useLabI18n()

const source = computed(() => getRuntimeInspectorSource(store.preview.value, store.documentState.value.revision))
const runtime = computed(() => source.value.runtime)
const runtimeInspection = computed(() => {
	const currentRuntime = runtime.value
	return currentRuntime === null ? null : inspectRuntime(currentRuntime)
})

const selectedNodeId = computed<InspectionNodeId | null>(() => store.previewFocus.value?.nodeId ?? null)

const selectedNode = computed(() => {
	const inspection = runtimeInspection.value
	const nodeId = selectedNodeId.value
	if (inspection === null || nodeId === null)
		return null
	const node = inspection.blueprint.getNode(nodeId)
	// A Runtime's Blueprint is always valid, hence every recovered node is resolved; the null/unresolved
	// branch only guards a forged/out-of-domain focus id defensively.
	return node !== null && node.resolved ? node : null
})

const selectedWidgetInspection = computed(() => {
	const inspection = runtimeInspection.value
	const nodeId = selectedNodeId.value
	return inspection === null || nodeId === null ? null : inspection.getWidget(nodeId)
})

function selectNode(nodeId: InspectionNodeId): void {
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
			v-if="runtime === null"
			:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
		>
			<p>{{ i18n.t('Runtime unavailable — there is no valid Preview revision to inspect. Open Blueprint to see current diagnostics, fix Source, then Apply again.') }}</p>
		</div>
		<InspectorSplitLayout v-else>
			<template #tree>
				<BlueprintTree
					:inspection="runtimeInspection!.blueprint"
					:selectedNodeId="selectedNodeId"
					@select="selectNode"
				/>
			</template>
			<template #details>
				<RuntimeNodeDetails
					:node="selectedNode"
					:widgetInspection="selectedWidgetInspection"
				/>
			</template>
		</InspectorSplitLayout>
	</InspectorPanelShell>
</template>
