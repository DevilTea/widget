<script setup lang="ts">
import type { JsonPrimitive } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, ref, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { getAuthorConfigScalars, replaceConfigScalar } from '../../lab/author'
import BlueprintTree from '../blueprint/BlueprintTree.vue'

const store = useLabStore()
const i18n = useLabI18n()
const documentInspection = computed(() => inspectBlueprint(store.documentState.value.blueprint))
const selectedNodeId = computed<InspectionNodeId | null>(() => store.documentFocus.value?.nodeId ?? null)
const selectedNode = computed(() => selectedNodeId.value === null ? null : documentInspection.value.getNode(selectedNodeId.value))
const drafts = ref<Record<string, string>>({})
const busy = ref(false)
const outcomeMessage = ref<string | null>(null)

watch([selectedNodeId, () => store.documentState.value.revision, () => store.documentState.value.sourceText], () => {
	const node = selectedNode.value
	drafts.value = node === null
		? {}
		: Object.fromEntries(getAuthorConfigScalars(node)
				.map(field => [field.key, String(field.value ?? '')]))
	outcomeMessage.value = null
}, { immediate: true })

function selectNode(nodeId: InspectionNodeId): void {
	store.setFocus('document', { nodeId })
}

function setDraft(key: string, event: Event): void {
	drafts.value = { ...drafts.value, [key]: (event.target as HTMLInputElement).value }
}

function parseValue(value: JsonPrimitive, text: string): { readonly ok: true, readonly value: JsonPrimitive } | { readonly ok: false } {
	if (typeof value === 'string')
		return { ok: true, value: text }
	if (typeof value === 'number') {
		if (text.trim() === '')
			return { ok: false }
		const parsed = Number(text)
		return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
	}
	if (typeof value === 'boolean')
		return text === 'true' || text === 'false' ? { ok: true, value: text === 'true' } : { ok: false }
	return { ok: true, value: null }
}

async function replaceValue(field: { readonly key: string, readonly value: JsonPrimitive }): Promise<void> {
	const nodeId = selectedNodeId.value
	if (nodeId === null || selectedNode.value?.resolved !== true)
		return
	const documentRevision = store.documentState.value.revision
	const parsed = parseValue(field.value, drafts.value[field.key] ?? '')
	if (!parsed.ok) {
		outcomeMessage.value = i18n.t('Enter a valid value of the same scalar type.')
		return
	}
	busy.value = true
	outcomeMessage.value = null
	try {
		const outcome = await store.author(replaceConfigScalar(documentRevision, nodeId, field.key, parsed.value))
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
	<div :class="pika({ display: 'grid', gridTemplateColumns: '220px 1px 1fr', height: '100%', minHeight: '0' })">
		<BlueprintTree
			:inspection="documentInspection"
			:selectedNodeId="selectedNodeId"
			@select="selectNode"
		/>
		<div :class="pika({ background: 'var(--lab-color-border)' })" />
		<div :class="pika({ overflow: 'auto', padding: '10px' })">
			<div
				v-if="selectedNode === null"
				:class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '12px' })"
			>
				{{ i18n.t('Select an authored widget to see its editable scalar config fields.') }}
			</div>
			<template v-else-if="selectedNode.resolved">
				<h3 :class="pika({ margin: '0 0 4px', fontSize: '13px', fontFamily: 'var(--lab-font-mono)' })">
					{{ selectedNode.node.id }} : {{ selectedNode.node.type }}
				</h3>
				<p :class="pika({ margin: '0 0 12px', color: 'var(--lab-color-text-muted)', fontSize: '11px' })">
					{{ i18n.t('Current committed Document structure') }} · {{ i18n.t('Document r{revision}', { revision: store.documentState.value.revision }) }}
				</p>
				<section>
					<h4 :class="pika({ margin: '0 0 6px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
						{{ i18n.t('Editable scalar config') }}
					</h4>
					<p :class="pika({ margin: '0 0 8px', color: 'var(--lab-color-text-muted)', fontSize: '11px' })">
						{{ i18n.t('Null and nested config fields are available in JSON.') }}
					</p>
					<p
						v-if="getAuthorConfigScalars(selectedNode).length === 0"
						:class="pika({ margin: '0', color: 'var(--lab-color-text-muted)', fontSize: '11px' })"
					>
						{{ i18n.t('No existing scalar config fields on this widget.') }}
					</p>
					<div
						v-for="field in getAuthorConfigScalars(selectedNode)"
						:key="field.key"
						:class="pika({ display: 'grid', gridTemplateColumns: '90px 1fr auto', alignItems: 'center', gap: '6px', marginBottom: '7px' })"
					>
						<label
							:for="`author-config-${field.key}`"
							:class="pika({ fontSize: '11px', fontFamily: 'var(--lab-font-mono)' })"
						>{{ field.key }}</label>
						<input
							:id="`author-config-${field.key}`"
							:value="drafts[field.key]"
							:disabled="busy"
							:class="pika({ minWidth: '0', padding: '4px 6px', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text)', background: 'var(--lab-color-surface)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)' })"
							@input="setDraft(field.key, $event)"
						>
						<button
							type="button"
							:disabled="busy"
							:class="pika({ 'padding': '4px 7px', 'fontSize': '10px', 'border': '1px solid var(--lab-color-accent)', 'borderRadius': 'var(--lab-radius)', 'background': 'var(--lab-color-accent)', 'color': 'var(--lab-color-accent-contrast)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
							@click="replaceValue(field)"
						>
							{{ i18n.t('Set value') }}
						</button>
					</div>
				</section>
				<p
					v-if="outcomeMessage !== null"
					data-testid="author-command-outcome"
					:class="pika({ margin: '12px 0 0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					{{ outcomeMessage }}
				</p>
			</template>
			<div
				v-else
				:class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '12px' })"
			>
				{{ i18n.t('Unresolved widgets are read-only in Structure.') }}
			</div>
		</div>
	</div>
</template>
