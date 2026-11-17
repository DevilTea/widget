<script setup lang="ts">
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { ConfigPath, JsonSchema } from '../../lab/config-schema'
import type { ConfigEdit } from '../../lab/types'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, ref, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { editConfig } from '../../lab/author'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import ConfigFieldEditor from './ConfigFieldEditor.vue'

const store = useLabStore()
const i18n = useLabI18n()
const documentInspection = computed(() => inspectBlueprint(store.documentState.value.blueprint))
const selectedNodeId = computed<InspectionNodeId | null>(() => store.documentFocus.value?.nodeId ?? null)
const selectedNode = computed(() => selectedNodeId.value === null ? null : documentInspection.value.getNode(selectedNodeId.value))
const busy = ref(false)
const outcomeMessage = ref<string | null>(null)

/** The plugin's public config metadata for the selected widget: `null` when it has no config capability. */
const catalogConfig = computed(() => {
	void store.showcaseId.value
	const node = selectedNode.value
	if (node === null || !node.resolved)
		return undefined
	return store.session.system.catalog.widgets.find(entry => entry.type === node.node.type)?.config
})
const configSchema = computed(() => (catalogConfig.value?.schema ?? null) as JsonSchema | null)

/** The widget's authored config object (empty when it was written without one). */
const configValue = computed<unknown>(() => {
	const node = selectedNode.value
	if (node === null || !node.resolved)
		return {}
	const source = node.node.source as { readonly config?: unknown } | null
	return source?.config ?? {}
})

watch([selectedNodeId, () => store.documentState.value.revision], () => {
	outcomeMessage.value = null
})

function selectNode(nodeId: InspectionNodeId): void {
	store.setFocus('document', { nodeId })
}

async function onEdit(path: ConfigPath, edit: ConfigEdit): Promise<void> {
	const nodeId = selectedNodeId.value
	if (nodeId === null || selectedNode.value?.resolved !== true)
		return
	busy.value = true
	outcomeMessage.value = null
	try {
		const outcome = await store.author(editConfig(store.documentState.value.revision, nodeId, path, edit))
		if (outcome.status === 'applied')
			outcomeMessage.value = i18n.t('Author command applied to Document r{revision}.', { revision: store.documentState.value.revision })
		else if (outcome.status === 'draft-dirty')
			outcomeMessage.value = i18n.t('Apply or Revert the JSON draft before using Structure commands.')
		else if (outcome.status === 'patch-error')
			outcomeMessage.value = i18n.t('The author command could not be applied: {message}', { message: outcome.failure.message })
		else if (outcome.status === 'unsupported')
			outcomeMessage.value = i18n.t('This selected value is no longer available in the current Document.')
		else
			outcomeMessage.value = i18n.t('The author command is unavailable while another lifecycle command is running.')
	}
	finally {
		busy.value = false
	}
}
</script>

<template>
	<div class="grid h-full min-h-0 grid-cols-[220px_1px_1fr]">
		<BlueprintTree
			:inspection="documentInspection"
			:selectedNodeId="selectedNodeId"
			@select="selectNode"
		/>
		<div class="bg-(--lab-color-border)" />
		<div
			data-testid="structure-editor"
			class="min-w-0 overflow-auto p-2.5"
		>
			<div
				v-if="selectedNode === null"
				class="text-xs text-muted"
			>
				{{ i18n.t('Select an authored widget to edit its config.') }}
			</div>
			<template v-else-if="selectedNode.resolved">
				<h3 class="m-0 mb-1 font-mono text-[13px] font-semibold">
					{{ selectedNode.node.id }} : {{ selectedNode.node.type }}
				</h3>
				<p class="m-0 mb-3 text-xs text-muted">
					{{ i18n.t('Current committed Document structure') }} · {{ i18n.t('Document r{revision}', { revision: store.documentState.value.revision }) }}
				</p>
				<section :aria-label="i18n.t('Config')">
					<h4 class="m-0 mb-1.5 text-xs font-semibold text-muted uppercase">
						{{ i18n.t('Config') }}
					</h4>
					<p
						v-if="catalogConfig === null"
						class="m-0 text-xs text-muted"
					>
						{{ i18n.t('This widget has no config.') }}
					</p>
					<template v-else>
						<p class="m-0 mb-2 text-xs text-muted">
							{{ i18n.t(configSchema === null ? 'This plugin publishes no config schema, so values are typed by what they hold and nothing can be added or removed here. Use JSON for that.' : 'Each change is applied to the Document at once and restarts the preview (its answers start over). Use Undo to take a change back.') }}
						</p>
						<ConfigFieldEditor
							bare
							:root="configSchema"
							:schema="configSchema"
							:value="configValue"
							:path="[]"
							label="config"
							:busy="busy"
							@edit="onEdit"
						/>
					</template>
				</section>
				<p
					v-if="outcomeMessage !== null"
					data-testid="author-command-outcome"
					role="status"
					class="m-0 mt-3 text-xs text-muted"
				>
					{{ outcomeMessage }}
				</p>
			</template>
			<div
				v-else
				class="text-xs text-muted"
			>
				{{ i18n.t('Unresolved widgets are read-only in Structure.') }}
			</div>
		</div>
	</div>
</template>
