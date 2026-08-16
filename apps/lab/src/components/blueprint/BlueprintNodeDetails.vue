<script setup lang="ts">
/**
 * Selected-node details (issue #13 Widget Lab Phase 4 Checkpoint H): resolved nodes show
 * identity/location/config (raw + resolved, when the capability exists)/semantic slots
 * summary/issues; unresolved nodes show location/raw-definition/issues without inventing semantic
 * fields they do not have.
 */
import type { WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { BlueprintInspection, BlueprintInspectionNode, InspectionNodeId } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useImplementationExplorer } from '../../composables/use-implementation-explorer'
import { useLabStore } from '../../composables/use-lab-store'
import { getShowcase } from '../../showcases/registry'
import IssueList from './IssueList.vue'

const props = defineProps<{
	node: BlueprintInspectionNode | null
	blueprint: WidgetSystemBlueprint
	inspection: BlueprintInspection
}>()

const emit = defineEmits<{
	navigate: [nodeId: InspectionNodeId]
}>()

// issue #25 P3 Scope D, entry point 2: "View implementation" on the selected node's own detail. The
// selected node here (`props.node`) IS the current shared focus (`BlueprintPanel.vue` drives both from
// `store.focus`), so opening never needs to re-set focus — the Implementation panel reads the same
// `store.focus` reactively.
const store = useLabStore()
const implementationExplorer = useImplementationExplorer()
const curatedEntryAvailable = computed(() => {
	const node = props.node
	if (node === null || !node.resolved)
		return false
	const showcase = getShowcase(store.showcaseId.value)
	return showcase !== undefined && node.node.type in showcase.sources
})

const locationLabel = computed(() => {
	const node = props.node
	if (node === null)
		return null
	const location = props.blueprint.getLocation(node.node)
	if (location === null)
		return '(root)'
	if (location.type === 'root')
		return 'root'
	const parentLabel = location.parent.resolved ? location.parent.id : '(unresolved parent)'
	return `${location.type} — parent "${parentLabel}", slot "${location.slot}", index ${location.index}`
})

/** Capability-conditional fields structurally absent (not merely `undefined`) when the plugin has no config capability — read defensively rather than asserting a concrete Plugin type here. */
function readConfigFields(node: { readonly rawConfig?: unknown, readonly config?: unknown }): { rawConfig: unknown, config: unknown } {
	return { rawConfig: node.rawConfig, config: node.config }
}
</script>

<template>
	<div
		v-if="node === null"
		:class="pika({ padding: '10px', color: 'var(--lab-color-text-muted)', fontSize: '12px' })"
	>
		No node selected.
	</div>
	<div
		v-else
		:class="pika({ padding: '10px', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto', height: '100%' })"
	>
		<div :class="pika({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' })">
			<div>
				<h4 :class="pika({ margin: '0 0 4px', fontSize: '13px', fontFamily: 'var(--lab-font-mono)' })">
					{{ node.resolved ? `${node.node.id} : ${node.node.type}` : 'Unresolved node' }}
				</h4>
				<div :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
					status: {{ node.resolved ? 'resolved' : 'unresolved' }} · location: {{ locationLabel }}
				</div>
			</div>
			<button
				v-if="curatedEntryAvailable"
				type="button"
				data-testid="blueprint-view-implementation"
				:class="pika({ flex: '0 0 auto', padding: '3px 10px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="implementationExplorer.open()"
			>
				View implementation
			</button>
		</div>

		<template v-if="node.resolved">
			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					Config
				</h5>
				<pre
					v-if="node.capabilities.config"
					:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })"
				>{{ JSON.stringify(readConfigFields(node.node as unknown as { rawConfig?: unknown, config?: unknown }), null, 2) }}</pre>
				<p
					v-else
					:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					No config capability.
				</p>
			</section>

			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					Semantic slots
				</h5>
				<ul
					v-if="node.capabilities.slots && node.semanticSlots.length > 0"
					:class="pika({ margin: '0', paddingLeft: '16px', fontSize: '11px' })"
				>
					<li
						v-for="slot in node.semanticSlots"
						:key="slot.name"
					>
						{{ slot.name }}: {{ slot.children.length }} child(ren)
					</li>
				</ul>
				<p
					v-else-if="node.capabilities.slots"
					:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					Slots capability present, but declares no slot names (e.g. explicit-empty <code>slots: never</code>).
				</p>
				<p
					v-else
					:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					No slots capability.
				</p>
			</section>

			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					Members
				</h5>
				<p :class="pika({ margin: '0', fontSize: '11px' })">
					{{ node.state.length }} state · {{ node.properties.length }} propert{{ node.properties.length === 1 ? 'y' : 'ies' }} · {{ node.methods.length }} method{{ node.methods.length === 1 ? '' : 's' }}
				</p>
			</section>
		</template>
		<template v-else>
			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					Raw definition
				</h5>
				<pre
					:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })"
				>{{ JSON.stringify(node.node.rawDefinition, null, 2) }}</pre>
			</section>
		</template>

		<section>
			<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
				Issues ({{ node.node.getIssues().length }})
			</h5>
			<IssueList
				:issues="node.node.getIssues()"
				:inspection="inspection"
				@navigate="(id) => emit('navigate', id)"
			/>
		</section>
	</div>
</template>
