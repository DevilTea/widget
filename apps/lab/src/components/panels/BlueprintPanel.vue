<script setup lang="ts">
/** Blueprint inspector. #43 localizes panel chrome only; node/type/member identities and issue messages stay verbatim. */
import { computed, ref, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { inspectBlueprint } from '../../lib/widget-core-inspection'
import BlueprintNodeDetails from '../blueprint/BlueprintNodeDetails.vue'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const i18n = useLabI18n()
const inspection = computed(() => inspectBlueprint(store.active.value.blueprint))
const selectedNode = computed(() => {
	const nodeId = store.focus.value?.nodeId
	if (nodeId === undefined)
		return inspection.value.root
	return inspection.value.nodes.find(node => node.nodeId === nodeId) ?? inspection.value.root
})

const detailTab = ref<'node' | 'issues'>('node')
watch(() => store.focus.value, () => {
	detailTab.value = 'node'
})
</script>

<template>
	<div
		data-tutorial-target="blueprint"
		:class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })"
	>
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:blueprint"
			text="What the applied Source compiled into — declarations, never live values"
		/>
		<div :class="pika({ display: 'grid', gridTemplateColumns: 'minmax(180px, 0.8fr) minmax(240px, 1.2fr)', flex: '1 1 auto', minHeight: '0' })">
			<div :class="pika({ overflow: 'auto', borderRight: '1px solid var(--lab-color-border)', minHeight: '0' })">
				<BlueprintTree
					:inspection="inspection"
					:selectedNodeId="selectedNode.nodeId"
					@select="store.setFocus({ nodeId: $event })"
				/>
			</div>
			<div :class="pika({ display: 'flex', flexDirection: 'column', minHeight: '0' })">
				<div :class="pika({ display: 'flex', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
					<button
						type="button"
						:class="pika({ padding: '6px 10px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer' })"
						:style="{ fontWeight: detailTab === 'node' ? '600' : 'normal', borderBottom: detailTab === 'node' ? '2px solid var(--lab-color-accent)' : '2px solid transparent' }"
						@click="detailTab = 'node'"
					>
						{{ i18n.t('Selected node') }}
					</button>
					<button
						type="button"
						:class="pika({ padding: '6px 10px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer' })"
						:style="{ fontWeight: detailTab === 'issues' ? '600' : 'normal', borderBottom: detailTab === 'issues' ? '2px solid var(--lab-color-accent)' : '2px solid transparent' }"
						@click="detailTab = 'issues'"
					>
						{{ i18n.t('All issues') }} ({{ inspection.issues.length }})
					</button>
				</div>
				<div :class="pika({ overflow: 'auto', flex: '1 1 auto', minHeight: '0' })">
					<BlueprintNodeDetails
						v-if="detailTab === 'node'"
						:inspection="inspection"
						:node="selectedNode"
					/>
					<ul
						v-else
						:class="pika({ margin: '0', padding: '10px 10px 10px 28px', fontSize: '11px' })"
					>
						<li
							v-for="(issue, index) in inspection.issues"
							:key="index"
							:class="pika({ marginBottom: '6px' })"
						>
							<strong>[{{ issue.source.type }}]</strong> {{ issue.message }}
						</li>
					</ul>
				</div>
			</div>
		</div>
	</div>
</template>
