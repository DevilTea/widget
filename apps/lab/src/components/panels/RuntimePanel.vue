<script setup lang="ts">
/**
 * Runtime Inspector (diagnostic #13 Phase 5 "Runtime Inspector becomes strictly passive" / "inspectors are
 * readonly consumers of core inspection"). Strictly readonly: opening, selecting a widget/member, or
 * subscribing never calls `state.get()`/`property.get()`, invokes Methods, or otherwise drives Runtime
 * semantics — every fact comes from `@deviltea/widget-core/inspection`'s `inspectRuntime()`.
 *
 * Invalid Blueprint -> `runtime === null` -> unavailable/blocked (Phase 4 behavior, kept as-is; the
 * Runtime tab stays present rather than disappearing). Reuses `BlueprintTree` for navigation: an
 * `inspectRuntime(runtime).blueprint` is identity-equal to `inspectBlueprint(runtime.blueprint)`, so the
 * same tree/shared-focus contract Blueprint uses applies here unchanged. #43 localizes only Lab-owned
 * explanatory chrome; Runtime member names, values, and core diagnostics remain verbatim.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { inspectRuntime } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'
import RuntimeNodeDetails from '../runtime/RuntimeNodeDetails.vue'

const store = useLabStore()
const i18n = useLabI18n()

const runtime = computed(() => store.active.value.runtime)
const runtimeInspection = computed(() => {
	const currentRuntime = runtime.value
	return currentRuntime === null ? null : inspectRuntime(currentRuntime)
})

const selectedNodeId = computed<InspectionNodeId | null>(() => store.focus.value?.nodeId ?? null)

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
	store.setFocus({ nodeId })
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:runtime"
			text="Live State, Properties, Methods, and Diagnostics of the running widgets"
		/>
		<div
			v-if="runtime === null"
			:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
		>
			<p>{{ i18n.t('Runtime unavailable — the applied Blueprint is invalid, so there is nothing running yet. Open the Blueprint tab to see why, fix Source, then Apply again.') }}</p>
		</div>
		<div
			v-else
			:class="pika({ display: 'grid', gridTemplateColumns: '220px 1px 1fr', flex: '1 1 auto', minHeight: '0' })"
		>
			<BlueprintTree
				:inspection="runtimeInspection!.blueprint"
				:selectedNodeId="selectedNodeId"
				@select="selectNode"
			/>
			<div :class="pika({ background: 'var(--lab-color-border)' })" />
			<RuntimeNodeDetails
				:node="selectedNode"
				:widgetInspection="selectedWidgetInspection"
			/>
		</div>
	</div>
</template>
