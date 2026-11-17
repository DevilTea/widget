<script setup lang="ts">
import type { InspectorClient } from '@deviltea/widget-inspector/client'
/** Remote Runtime Inspector member list. All live values arrive through InspectorClient DTOs. */
import type { InspectorBlueprintNode, InspectorRuntimePropertySnapshot, InspectorRuntimeStateSnapshot, InspectorRuntimeWidgetSnapshot } from '@deviltea/widget-inspector/protocol'
import type { InspectorFocusMember } from '../../lab/focus'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import RuntimeMethodRow from './RuntimeMethodRow.vue'
import RuntimePropertyRow from './RuntimePropertyRow.vue'
import RuntimeStateRow from './RuntimeStateRow.vue'

const props = defineProps<{
	node: InspectorBlueprintNode | null
	widgetSnapshot: InspectorRuntimeWidgetSnapshot | null
	client: InspectorClient | null
	/** Inside a pane that scrolls as a whole (Selected widget): no scroll area or height of its own. */
	embedded?: boolean
}>()

/** Under the Selected widget pane's section heading (h3) the groups are h4, so no heading level is skipped. */
const memberHeading = computed(() => props.embedded ? 'h4' : 'h5')

const store = useLabStore()
const i18n = useLabI18n()

const focusMember = computed<InspectorFocusMember | null>(() => {
	const focus = store.previewFocus.value
	if (focus === null || props.node === null || focus.nodeId !== props.node.nodeId)
		return null
	return focus.member ?? null
})

const stateMembers = computed(() => props.node?.state ?? [])
const propertyMembers = computed(() => props.node?.properties ?? [])
const methodMembers = computed(() => props.node?.methods ?? [])

function stateSnapshot(name: string): InspectorRuntimeStateSnapshot | null {
	const member = props.widgetSnapshot?.members.find(candidate => candidate.type === 'state' && candidate.name === name)
	return member?.type === 'state' ? member : null
}

function propertySnapshot(name: string): InspectorRuntimePropertySnapshot | null {
	const member = props.widgetSnapshot?.members.find(candidate => candidate.type === 'property' && candidate.name === name)
	return member?.type === 'property' ? member : null
}

function isSelected(type: InspectorFocusMember['type'], name: string): boolean {
	const member = focusMember.value
	return member !== null && member.type === type && member.name === name
}

function selectMember(type: InspectorFocusMember['type'], name: string): void {
	const node = props.node
	if (node === null)
		return
	store.setFocus('preview', { nodeId: node.nodeId, member: { type, name } })
}
</script>

<template>
	<div
		v-if="node === null || widgetSnapshot === null || client === null"
		:class="pika({ padding: '10px', color: 'var(--lab-color-text-muted)', fontSize: '12px' })"
	>
		{{ i18n.t('No node selected — click a node in the tree on the left to see its live State, Properties, and Methods.') }}
	</div>
	<div
		v-else
		:class="pika({ display: 'flex', flexDirection: 'column', gap: '14px', padding: '10px', overflow: 'auto', height: '100%' })"
		:style="embedded ? { overflow: 'visible', height: 'auto' } : undefined"
	>
		<section>
			<component
				:is="memberHeading"
				:class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })"
			>
				State ({{ stateMembers.length }})
			</component>
			<template
				v-for="member in stateMembers"
				:key="member.name"
			>
				<RuntimeStateRow
					v-if="stateSnapshot(member.name) !== null"
					:name="member.name"
					:client="client"
					:widgetRef="widgetSnapshot.ref"
					:initial="stateSnapshot(member.name)!"
					:selected="isSelected('state', member.name)"
					@select="selectMember('state', member.name)"
				/>
			</template>
			<p
				v-if="stateMembers.length === 0"
				:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('No State members.') }}
			</p>
		</section>

		<section>
			<component
				:is="memberHeading"
				:class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })"
			>
				Properties ({{ propertyMembers.length }})
			</component>
			<template
				v-for="member in propertyMembers"
				:key="member.name"
			>
				<RuntimePropertyRow
					v-if="propertySnapshot(member.name) !== null"
					:name="member.name"
					:client="client"
					:widgetRef="widgetSnapshot.ref"
					:initial="propertySnapshot(member.name)!"
					:selected="isSelected('property', member.name)"
					@select="selectMember('property', member.name)"
				/>
			</template>
			<p
				v-if="propertyMembers.length === 0"
				:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('No Property members.') }}
			</p>
		</section>

		<section>
			<component
				:is="memberHeading"
				:class="pika({ margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })"
			>
				Methods ({{ methodMembers.length }}) — {{ i18n.t('inventory only') }}
			</component>
			<RuntimeMethodRow
				v-for="member in methodMembers"
				:key="member.name"
				:name="member.name"
				:transitivelyWrites="member.transitivelyWrites"
				:transitivelyEmits="member.transitivelyEmits"
				:selected="isSelected('method', member.name)"
				@select="selectMember('method', member.name)"
			/>
			<p
				v-if="methodMembers.length === 0"
				:class="pika({ margin: '0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('No Method members.') }}
			</p>
		</section>
	</div>
</template>
