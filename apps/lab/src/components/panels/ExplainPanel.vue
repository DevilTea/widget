<script setup lang="ts">
/**
 * Explain (Lab UX phase 2, M13): one widget explained for a newcomer, top to bottom: what it is (identity and the plugin's
 * generated summary), why it behaves this way (its Properties' reads of other widgets, with their live values and the config
 * field that names them), its current values (State and Properties), who uses it and what it depends on, and, collapsed,
 * the declaration details (config, slots, members, diagnostics).
 *
 * The widget is the shared Document focus, but only one someone chose (`documentFocusChosen`): the root the focus starts at
 * or falls back to is never explained, and the panel asks the user to pick a widget instead. Values follow the rules of the
 * Selected widget pane (`useSelectedWidgetRuntime`): they come from the Preview only while it shows the Document's revision,
 * and the panel says which version they come from. Read-only. Every section is its own component so phase 3 can show the
 * Selected widget, Blueprint and Runtime details through the same pieces.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { PanelVisibilityApi } from '../../composables/use-panel-visibility'
import type { ExplainLiveSource } from '../explain/ExplainWhyList.vue'
import { computed } from 'vue'
import { docText, pluginDocsOf } from '../../author/widget-docs'
import { useDependenciesView } from '../../composables/use-dependencies-view'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { usePanelVisibility } from '../../composables/use-panel-visibility'
import { useSelectedWidgetRuntime } from '../../composables/use-selected-widget-runtime'
import { buildWhySentences } from '../../explain/why'
import { projectSemanticGraph } from '../../graph/projection'
import { projectRelations } from '../../graph/relations'
import { uniqueRemoteNodeIdForIdentity } from '../../lab/focus'
import { getShowcase } from '../../showcases/registry'
import BlueprintNodeDetails from '../blueprint/BlueprintNodeDetails.vue'
import ExplainIdentity from '../explain/ExplainIdentity.vue'
import ExplainRelations from '../explain/ExplainRelations.vue'
import ExplainWhyList from '../explain/ExplainWhyList.vue'
import RuntimeNodeDetails from '../runtime/RuntimeNodeDetails.vue'

const props = defineProps<{ params?: { api?: PanelVisibilityApi } }>()
const store = useLabStore()
const i18n = useLabI18n()
const dependenciesView = useDependenciesView()

const visible = usePanelVisibility(props.params?.api)
const {
	inspection,
	documentNode,
	connection,
	blueprint: previewBlueprint,
	selectedNode: runtimeNode,
	widgetSnapshot,
	runtimeState,
	runtimeMessage,
	previewRevision,
} = useSelectedWidgetRuntime(visible)

const blueprint = computed(() => store.documentState.value.blueprint)
/** Only a widget someone chose is explained, never the root the focus defaults to. */
const node = computed(() => store.documentFocusChosen.value ? documentNode.value : null)
const showcase = computed(() => getShowcase(store.showcaseId.value))

const summary = computed(() => {
	const current = node.value
	if (current === null || current.node.type === null)
		return ''
	return docText({ summary: pluginDocsOf(showcase.value?.docs, current.node.type)?.summary ?? '', remarks: '' })
})

const sentences = computed(() => {
	const current = node.value
	if (current === null || !current.resolved)
		return []
	const schema = showcase.value?.configSchemas[current.node.type] ?? null
	return buildWhySentences(inspection.value, current.nodeId, schema)
})

/** The Preview shows the Document's revision, so its values belong to what this panel explains. */
const linked = computed(() => runtimeState.value !== 'no-preview' && runtimeState.value !== 'diverged' && runtimeState.value !== 'unresolved')

const live = computed<ExplainLiveSource | null>(() => {
	const current = connection.value
	const snapshot = previewBlueprint.value
	if (!visible.value || !linked.value || current === null || snapshot === null)
		return null
	return {
		client: current.inspectorClient,
		runtimeId: current.runtimeId,
		// Only an unambiguous widget (the focus store's rule): with a duplicate id+type no live value is shown.
		previewNodeIdOf: (widgetId, widgetType) => uniqueRemoteNodeIdForIdentity(snapshot, widgetId, widgetType),
	}
})

const valuesSource = computed(() => {
	switch (runtimeState.value) {
		case 'no-preview': return i18n.t('No current values: there is no valid preview to read them from.')
		case 'diverged': return i18n.t('No current values: the preview shows the last valid version (r{preview}), not the current document (r{document}).', { preview: previewRevision.value ?? '', document: store.documentState.value.revision })
		default: return i18n.t('Current values come from the running preview, which shows the current document (r{revision}).', { revision: store.documentState.value.revision })
	}
})

const relations = computed(() => {
	const current = node.value
	if (current === null || !current.resolved)
		return null
	const graph = projectSemanticGraph(inspection.value, { showAbsent: store.graphShowAbsent.value, showIsolatedMembers: true })
	const model = projectRelations(graph, { nodeId: current.nodeId }, inspection.value.rootNodeId)
	return model.mode === 'widget' ? model : null
})

function select(nodeId: InspectionNodeId): void {
	store.setFocus('document', { nodeId })
}
</script>

<template>
	<div
		data-testid="explain"
		:data-runtime-state="node === null ? 'none' : runtimeState"
		class="@container flex h-full min-h-0 flex-col overflow-auto"
	>
		<div
			v-if="node === null"
			data-testid="explain-empty"
			class="m-3 rounded-(--lab-radius) border border-default bg-muted p-4 text-sm leading-6"
		>
			<h3 class="m-0 mb-1 text-sm font-semibold">
				{{ i18n.t('Nothing selected yet') }}
			</h3>
			<!-- While diverged, Inspect opens Runtime (the Preview's own revision), so only the Structure tree selects here. -->
			<p
				class="m-0"
				data-testid="explain-empty-hint"
			>
				{{ store.revisionStatus.value.isDiverged
					? i18n.t('The preview shows an older version of the document, so Inspect opens Runtime instead. Select a widget in the Structure tree to see what it is and why it behaves this way.')
					: i18n.t('Click a widget in the Preview (Inspect) or in the Structure tree to see what it is and why it behaves this way.') }}
			</p>
		</div>

		<article
			v-else
			:key="node.nodeId"
			data-testid="explain-widget"
			aria-labelledby="explain-identity-heading"
			class="flex min-w-0 flex-col gap-4 p-3"
		>
			<ExplainIdentity
				:node="node"
				:summary="summary"
				headingId="explain-identity-heading"
			/>

			<section
				v-if="node.resolved"
				data-testid="explain-why-section"
				aria-labelledby="explain-why-heading"
				class="min-w-0"
			>
				<h3
					id="explain-why-heading"
					class="m-0 mb-1 text-xs font-semibold"
				>
					{{ i18n.t('Why it behaves this way') }}
				</h3>
				<p
					data-testid="explain-values-source"
					class="m-0 mb-1.5 text-[11px] text-muted"
				>
					{{ valuesSource }}
				</p>
				<ExplainWhyList
					v-if="sentences.length > 0"
					:sentences="sentences"
					:live="live"
					@select="select"
				/>
				<p
					v-else
					data-testid="explain-why-none"
					class="m-0 text-xs text-muted"
				>
					{{ i18n.t('None of this widget\'s Properties read another widget: what it shows depends only on its own config and State.') }}
				</p>
			</section>

			<section
				v-if="node.resolved"
				data-testid="explain-values"
				aria-labelledby="explain-values-heading"
				class="min-w-0"
			>
				<h3
					id="explain-values-heading"
					class="m-0 mb-1 text-xs font-semibold"
				>
					{{ i18n.t('Current values') }}
				</h3>
				<RuntimeNodeDetails
					v-if="runtimeState === 'ready'"
					embedded
					hideMethods
					:node="runtimeNode"
					:widgetSnapshot="widgetSnapshot"
					:client="connection?.inspectorClient ?? null"
				/>
				<p
					v-else
					data-testid="explain-values-message"
					class="m-0 text-xs text-muted"
				>
					{{ runtimeMessage }}
				</p>
			</section>

			<section
				v-if="relations !== null"
				data-testid="explain-relations"
				aria-labelledby="explain-relations-heading"
				class="min-w-0"
			>
				<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
					<h3
						id="explain-relations-heading"
						class="m-0 text-xs font-semibold"
					>
						{{ i18n.t('Used by / Depends on') }}
					</h3>
					<button
						type="button"
						data-testid="explain-open-graph"
						class="min-h-6 cursor-pointer rounded-(--lab-radius) border border-default bg-elevated px-2.5 text-[11px] text-default hover:bg-accented focus-visible:outline-2 focus-visible:outline-primary"
						@click="dependenciesView.openGraph()"
					>
						{{ i18n.t('Open dependency graph') }}
					</button>
				</div>
				<ExplainRelations
					:usedBy="relations.usedBy"
					:dependsOn="relations.dependsOn"
					@select="select"
				/>
			</section>

			<details
				data-testid="explain-declaration"
				class="min-w-0 rounded-(--lab-radius) border border-default"
			>
				<summary class="cursor-pointer px-2.5 py-1.5 text-xs font-semibold">
					{{ i18n.t('Declaration details') }}
					<span class="font-normal text-muted">· {{ i18n.t('config, slots, members and problems') }}</span>
				</summary>
				<BlueprintNodeDetails
					embedded
					:node="node"
					:blueprint="blueprint"
					:inspection="inspection"
					@navigate="select"
				/>
			</details>
		</article>
	</div>
</template>
