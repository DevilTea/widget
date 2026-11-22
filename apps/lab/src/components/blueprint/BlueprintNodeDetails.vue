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
import { memberDocText, pluginDocsOf } from '../../author/widget-docs'
import { useImplementationExplorer } from '../../composables/use-implementation-explorer'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { getShowcase } from '../../showcases/registry'
import DeclaredEvents from '../events/DeclaredEvents.vue'
import ConfigView from './ConfigView.vue'
import DiagnosticList from './DiagnosticList.vue'

const props = defineProps<{
	node: BlueprintInspectionNode | null
	blueprint: WidgetSystemBlueprint
	inspection: BlueprintInspection
	/** Inside a pane that scrolls as a whole (Selected widget): no scroll area or height of its own. */
	embedded?: boolean
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

/** The declared Events of the node with their documentation from the showcase's generated docs (`''` when undocumented). */
const declaredEvents = computed(() => {
	const node = props.node
	if (node === null || !node.resolved)
		return []
	const events = pluginDocsOf(getShowcase(store.showcaseId.value)?.docs, node.node.type)?.events
	return node.events.map(event => ({ name: event.name, description: memberDocText(events, event.name) }))
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
		class="p-[10px] text-lab-text-muted text-[12px]"
	>
		{{ embedded
			? i18n.t('No widget selected — choose one with Inspect in the Preview, or in Blueprint or Dependencies, to see its declaration.')
			: i18n.t('No node selected — click a node in the tree on the left to see its config, slots, and diagnostics.') }}
	</div>
	<div
		v-else
		class="p-[10px] flex flex-col gap-[12px] overflow-auto h-full"
		:style="embedded ? { overflow: 'visible', height: 'auto' } : undefined"
	>
		<div class="flex items-start justify-between gap-[8px]">
			<div>
				<h4 class="m-[0_0_4px] text-[13px] font-lab-mono">
					{{ node.resolved ? `${node.node.id} : ${node.node.type}` : i18n.t('Unresolved node') }}
				</h4>
				<div class="text-[11px] text-lab-text-muted">
					{{ i18n.t('status') }}: {{ node.resolved ? 'resolved' : 'unresolved' }} · {{ i18n.t('location') }}: {{ locationLabel }}
				</div>
			</div>
			<button
				v-if="curatedEntryAvailable"
				type="button"
				data-testid="blueprint-view-implementation"
				class="flex-none p-[3px_10px] min-h-[24px] text-[11px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer"
				@click="implementationExplorer.open()"
			>
				{{ i18n.t('View implementation') }}
			</button>
		</div>

		<template v-if="node.resolved">
			<section>
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					{{ i18n.t('Config') }}
				</h5>
				<ConfigView
					v-if="node.capabilities.config"
					:key="node.nodeId"
					:rawConfig="readConfigFields(node.node as unknown as { rawConfig?: unknown, config?: unknown }).rawConfig"
					:config="readConfigFields(node.node as unknown as { rawConfig?: unknown, config?: unknown }).config"
				/>
				<p
					v-else
					class="m-0 text-[11px] text-lab-text-muted"
				>
					{{ i18n.t('No config capability.') }}
				</p>
			</section>

			<section>
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					{{ i18n.t('Semantic slots') }}
				</h5>
				<ul
					v-if="node.capabilities.slots && node.semanticSlots.length > 0"
					class="m-0 pl-[16px] text-[11px]"
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
					class="m-0 text-[11px] text-lab-text-muted"
				>
					{{ i18n.t('Slots capability present, but declares no slot names (e.g. explicit-empty') }} <code>slots: never</code>{{ i18n.t(').') }}
				</p>
				<p
					v-else
					class="m-0 text-[11px] text-lab-text-muted"
				>
					{{ i18n.t('No slots capability.') }}
				</p>
			</section>

			<section>
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					{{ i18n.t('Members') }}
				</h5>
				<p class="m-0 text-[11px]">
					{{ node.state.length }} State · {{ node.properties.length }} {{ node.properties.length === 1 ? 'Property' : 'Properties' }} · {{ node.methods.length }} {{ node.methods.length === 1 ? 'Method' : 'Methods' }} · {{ node.events.length }} {{ node.events.length === 1 ? 'Event' : 'Events' }}
				</p>
			</section>

			<section data-testid="blueprint-node-events">
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					Events ({{ node.events.length }})
				</h5>
				<DeclaredEvents
					:events="declaredEvents"
					:declared="node.capabilities.events"
				/>
			</section>
		</template>
		<template v-else>
			<section>
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					{{ i18n.t('Source') }}
				</h5>
				<pre
					class="m-0 text-[11px] font-lab-mono whitespace-pre-wrap [word-break:break-word]"
				>{{ JSON.stringify(node.node.source, null, 2) }}</pre>
			</section>
		</template>

		<section>
			<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
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
