<script setup lang="ts">
/**
 * Selected-node details (diagnostic #13 Widget Lab Phase 4 Checkpoint H): resolved nodes show
 * identity/location/config (raw + resolved, when the capability exists)/semantic slots
 * summary/diagnostics; unresolved nodes show location/raw source/diagnostics without inventing semantic
 * fields they do not have. #43 translates only the surrounding inspector chrome; ids/types/member
 * names/config/raw definitions remain semantic inspection data and are rendered verbatim.
 */
import type { WidgetSystemBlueprint } from '@deviltea/widget-core'
import type { BlueprintInspection, BlueprintInspectionNode, InspectionNodeId } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useImplementationExplorer } from '../../composables/use-implementation-explorer'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { getShowcase } from '../../showcases/registry'
import DiagnosticList from './DiagnosticList.vue'

const props = defineProps<{
	node: BlueprintInspectionNode | null
	blueprint: WidgetSystemBlueprint
	inspection: BlueprintInspection
}>()

const emit = defineEmits<{
	navigate: [nodeId: InspectionNodeId]
}>()

const store = useLabStore()
const i18n = useLabI18n()
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
		return i18n.t('(root)')
	if (location.type === 'root')
		return 'root'
	const parentLabel = location.parent.resolved ? location.parent.id : i18n.t('(unresolved parent)')
	return `${location.type} — ${i18n.t('parent')} "${parentLabel}", slot "${location.slot}", ${i18n.t('index')} ${location.index}`
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
		{{ i18n.t('No node selected — click a node in the tree on the left to see its config, slots, and diagnostics.') }}
	</div>
	<div
		v-else
		:class="pika({ padding: '10px', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto', height: '100%' })"
	>
		<div :class="pika({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' })">
			<div>
				<h4 :class="pika({ margin: '0 0 4px', fontSize: '13px', fontFamily: 'var(--lab-font-mono)' })">
					{{ node.resolved ? `${node.node.id} : ${node.node.type}` : i18n.t('Unresolved node') }}
				</h4>
				<div :class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('status') }}: {{ node.resolved ? 'resolved' : 'unresolved' }} · {{ i18n.t('location') }}: {{ locationLabel }}
				</div>
			</div>
			<button
				v-if="curatedEntryAvailable"
				type="button"
				data-testid="blueprint-view-implementation"
				:class="pika({ flex: '0 0 auto', padding: '3px 10px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="implementationExplorer.open()"
			>
				{{ i18n.t('View implementation') }}
			</button>
		</div>

		<template v-if="node.resolved">
			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('Config') }}
				</h5>
				<pre
					v-if="node.capabilities.config"
					:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })"
				>{{ JSON.stringify(readConfigFields(node.node as unknown as { rawConfig?: unknown, config?: unknown }), null, 2) }}</pre>
				<p
					v-else
					:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					{{ i18n.t('No config capability.') }}
				</p>
			</section>

			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('Semantic slots') }}
				</h5>
				<ul
					v-if="node.capabilities.slots && node.semanticSlots.length > 0"
					:class="pika({ margin: '0', paddingLeft: '16px', fontSize: '11px' })"
				>
					<li
						v-for="slot in node.semanticSlots"
						:key="slot.name"
					>
						{{ slot.name }}: {{ slot.children.length }} {{ i18n.t('child(ren)') }}
					</li>
				</ul>
				<p
					v-else-if="node.capabilities.slots"
					:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					{{ i18n.t('Slots capability present, but declares no slot names (e.g. explicit-empty') }} <code>slots: never</code>{{ i18n.t(').') }}
				</p>
				<p
					v-else
					:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					{{ i18n.t('No slots capability.') }}
				</p>
			</section>

			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('Members') }}
				</h5>
				<p :class="pika({ margin: '0', fontSize: '11px' })">
					{{ node.state.length }} State · {{ node.properties.length }} {{ node.properties.length === 1 ? 'Property' : 'Properties' }} · {{ node.methods.length }} {{ node.methods.length === 1 ? 'Method' : 'Methods' }}
				</p>
			</section>
		</template>
		<template v-else>
			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('Source') }}
				</h5>
				<pre
					:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })"
				>{{ JSON.stringify(node.node.source, null, 2) }}</pre>
			</section>
		</template>

		<section>
			<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
				{{ i18n.t('Diagnostics') }} ({{ node.node.diagnostics.length }})
			</h5>
			<DiagnosticList
				:diagnostics="node.node.diagnostics"
				:inspection="inspection"
				@navigate="(id) => emit('navigate', id)"
			/>
		</section>
	</div>
</template>
