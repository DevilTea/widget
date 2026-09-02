<script setup lang="ts">
/**
 * Lab-owned recovery/status summary for the current authored Document. Values that describe the
 * Blueprint are read directly from Core's public Blueprint and inspection contracts; this component
 * does not validate JSON or reinterpret diagnostic codes.
 */
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'

const store = useLabStore()
const i18n = useLabI18n()

const documentState = computed(() => store.documentState.value)
const blueprint = computed(() => documentState.value.blueprint)
const inspection = computed(() => inspectBlueprint(blueprint.value))
const draftStatus = computed(() => store.parseError.value !== null
	? 'syntax-error'
	: store.isDirty.value ? 'unapplied' : 'committed')
const unresolvedCount = computed(() => inspection.value.nodes.filter(node => !node.resolved).length)
const rawSlotCount = computed(() => inspection.value.nodes.reduce(
	(count, node) => count + node.sourceSlots.filter(slot => slot.placement === 'raw-slot').length,
	0,
))
const previewStatus = computed(() => {
	const status = store.revisionStatus.value
	if (status.state === 'linked')
		return i18n.t('Linked / Synced')
	if (status.state === 'diverged')
		return i18n.t('Diverged / Unlinked')
	return i18n.t('Unlinked')
})
</script>

<template>
	<section
		data-testid="author-document-status"
		:class="pika({ padding: '8px 10px', borderBottom: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', fontSize: '11px' })"
	>
		<div :class="pika({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' })">
			<strong :class="pika({ fontSize: '12px' })">{{ i18n.t('Document / recovery status') }}</strong>
			<span :class="pika({ color: 'var(--lab-color-text-muted)', fontFamily: 'var(--lab-font-mono)' })">
				{{ i18n.t('Document r{revision}', { revision: documentState.revision }) }}
			</span>
		</div>
		<dl :class="pika({ margin: '0', display: 'grid', gridTemplateColumns: 'minmax(130px, auto) 1fr', columnGap: '8px', rowGap: '4px' })">
			<dt>{{ i18n.t('JSON draft') }}</dt>
			<dd
				data-testid="author-json-draft-status"
				:class="pika({ margin: '0' })"
				:style="{ color: draftStatus === 'syntax-error' ? 'var(--lab-color-danger)' : 'var(--lab-color-text)' }"
			>
				{{ i18n.t(draftStatus === 'syntax-error' ? 'Syntax error (Lab-only draft)' : draftStatus === 'unapplied' ? 'Unapplied draft' : 'Matches committed Document') }}
			</dd>
			<dt>{{ i18n.t('Source JSON compatibility') }}</dt>
			<dd
				data-testid="author-source-json-compatibility"
				:class="pika({ margin: '0' })"
				:style="{ color: blueprint.sourceJsonCompatible ? 'var(--lab-color-ok)' : 'var(--lab-color-danger)' }"
			>
				{{ i18n.t(blueprint.sourceJsonCompatible ? 'Compatible (Core)' : 'Incompatible (Core)') }}
			</dd>
			<dt>{{ i18n.t('Blueprint status') }}</dt>
			<dd
				data-testid="author-blueprint-status"
				:class="pika({ margin: '0' })"
				:style="{ color: blueprint.status === 'valid' ? 'var(--lab-color-ok)' : 'var(--lab-color-danger)' }"
			>
				{{ i18n.t(blueprint.status) }} · {{ blueprint.diagnostics.length }} {{ i18n.t(blueprint.diagnostics.length === 1 ? 'diagnostic' : 'diagnostics') }}
			</dd>
			<dt>{{ i18n.t('Recovery topology') }}</dt>
			<dd
				data-testid="author-recovery-status"
				:class="pika({ margin: '0' })"
			>
				{{ unresolvedCount }} {{ i18n.t('unresolved') }} · {{ rawSlotCount }} {{ i18n.t('raw-slot placements') }}
			</dd>
			<dt>{{ i18n.t('Preview revision') }}</dt>
			<dd
				data-testid="author-preview-status"
				:class="pika({ margin: '0' })"
				:style="{ color: store.revisionStatus.value.isLinked ? 'var(--lab-color-ok)' : 'var(--lab-color-warning)' }"
			>
				{{ store.preview.value === null ? i18n.t('Preview unavailable') : `${previewStatus} · r${store.preview.value.revision}` }}
			</dd>
		</dl>
	</section>
</template>
