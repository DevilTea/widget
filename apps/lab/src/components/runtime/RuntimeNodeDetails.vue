<script setup lang="ts">
import type { ResolvedBlueprintInspectionNode, RuntimeWidgetInspection } from '@deviltea/widget-core/inspection'
/**
 * Selected-node Runtime member list (issue #13 Phase 5 "Runtime Inspector becomes strictly passive"):
 * State/Property/Method member drill-down for one resolved node. Clicking a member row updates the
 * shared cross-inspector focus (`nodeId` + member) — never Runtime/Preview state. #43 translates only
 * explanatory inventory/empty-state copy; State/Property/Method taxonomy and member names stay exact.
 */
import type { InspectorFocusMember } from '../../lab/focus'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import RuntimeMethodRow from './RuntimeMethodRow.vue'
import RuntimePropertyRow from './RuntimePropertyRow.vue'
import RuntimeStateRow from './RuntimeStateRow.vue'

const props = defineProps<{
	node: ResolvedBlueprintInspectionNode | null
	widgetInspection: RuntimeWidgetInspection | null
}>()

const store = useLabStore()
const i18n = useLabI18n()

const focusMember = computed<InspectorFocusMember | null>(() => {
	const focus = store.focus.value
	if (focus === null || props.node === null || focus.nodeId !== props.node.nodeId)
		return null
	return focus.member ?? null
})

function isSelected(type: InspectorFocusMember['type'], name: string): boolean {
	const member = focusMember.value
	return member !== null && member.type === type && member.name === name
}

function selectMember(type: InspectorFocusMember['type'], name: string): void {
	const node = props.node
	if (node === null)
		return
	store.setFocus({ nodeId: node.nodeId, member: { type, name } })
}
</script>

<template>
	<div
		v-if="node === null || widgetInspection === null"
		:class="pika({ padding: '10px', color: 'var(--lab-color-text-muted)', fontSize: '12px' })"
	>
		{{ i18n.t('No node selected — click a node in the tree on the left to see its live State, Properties, and Methods.') }}
	</div>
	<div
		v-else
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px', overflow: 'auto', height: '100%' })"
	>
		<section>
			<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
				State ({{ node.state.length }})
			</h5>
			<RuntimeStateRow
				v-for="member in node.state"
				:key="member.name"
				:name="member.name"
				:inspection="widgetInspection.getState(member.name)!"
				:selected="isSelected('state', member.name)"
				@select="selectMember('state', member.name)"
			/>
			<p
				v-if="node.state.length === 0"
				:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('No State members.') }}
			</p>
		</section>

		<section>
			<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
				Properties ({{ node.properties.length }})
			</h5>
			<RuntimePropertyRow
				v-for="member in node.properties"
				:key="member.name"
				:name="member.name"
				:inspection="widgetInspection.getProperty(member.name)!"
				:selected="isSelected('property', member.name)"
				@select="selectMember('property', member.name)"
			/>
			<p
				v-if="node.properties.length === 0"
				:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('No Property members.') }}
			</p>
		</section>

		<section>
			<h5 :class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
				Methods ({{ node.methods.length }}) — {{ i18n.t('inventory only') }}
			</h5>
			<RuntimeMethodRow
				v-for="member in node.methods"
				:key="member.name"
				:name="member.name"
				:transitivelyWrites="member.transitivelyWrites"
				:selected="isSelected('method', member.name)"
				@select="selectMember('method', member.name)"
			/>
			<p
				v-if="node.methods.length === 0"
				:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('No Method members.') }}
			</p>
		</section>
	</div>
</template>
