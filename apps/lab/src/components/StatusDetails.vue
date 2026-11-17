<script setup lang="ts">
/**
 * The header's "Document and preview details" popover content: the developer-vocabulary half of the status chips
 * (Document and Preview revision, whether they are linked) plus what used to be the Author panel's own
 * "Document / recovery status" box (JSON draft, Source JSON compatibility, Blueprint status, recovery topology;
 * issue #230 PR 3b folded it in so the same facts are not shown twice). Values that describe the Blueprint are
 * read from Core's public Blueprint and inspection contracts; nothing here validates JSON or reinterprets a
 * diagnostic code.
 */
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useLabStore } from '../composables/use-lab-store'

const store = useLabStore()
const i18n = useLabI18n()

const blueprint = computed(() => store.documentState.value.blueprint)
const inspection = computed(() => inspectBlueprint(blueprint.value))
const draftStatus = computed(() => store.parseError.value !== null
	? 'syntax-error'
	: store.isDirty.value ? 'unapplied' : 'committed')
const unresolvedCount = computed(() => inspection.value.nodes.filter(node => !node.resolved).length)
const rawSlotCount = computed(() => inspection.value.nodes.reduce(
	(count, node) => count + node.sourceSlots.filter(slot => slot.placement === 'raw-slot').length,
	0,
))
const linkLabel = computed(() => {
	const status = store.revisionStatus.value
	return i18n.t(status.isLinked ? 'Linked / Synced' : status.state === 'diverged' ? 'Diverged / Unlinked' : 'Unlinked')
})
</script>

<template>
	<dl
		data-testid="status-details-panel"
		class="m-0 grid max-w-96 grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 text-xs"
	>
		<dt class="text-muted">
			{{ i18n.t('Document') }}
		</dt>
		<dd
			data-testid="status-document-revision"
			class="m-0 font-mono"
		>
			r{{ store.revisionStatus.value.documentRevision }}
		</dd>
		<dt class="text-muted">
			{{ i18n.t('Preview') }}
		</dt>
		<dd
			data-testid="status-preview-revision"
			class="m-0 font-mono"
		>
			{{ store.revisionStatus.value.previewRevision === null ? i18n.t('Preview unavailable') : `r${store.revisionStatus.value.previewRevision}` }}
		</dd>
		<dt class="text-muted">
			{{ i18n.t('Revisions') }}
		</dt>
		<dd
			data-testid="revision-link-status"
			class="m-0"
			:class="store.revisionStatus.value.isLinked ? 'text-success' : 'text-warning'"
		>
			{{ linkLabel }}
		</dd>
		<dt class="text-muted">
			{{ i18n.t('JSON draft') }}
		</dt>
		<dd
			data-testid="status-json-draft"
			class="m-0"
			:class="draftStatus === 'syntax-error' ? 'text-error' : ''"
		>
			{{ i18n.t(draftStatus === 'syntax-error' ? 'Syntax error (Lab-only draft)' : draftStatus === 'unapplied' ? 'Unapplied draft' : 'Matches committed Document') }}
		</dd>
		<dt class="text-muted">
			{{ i18n.t('Source JSON compatibility') }}
		</dt>
		<dd
			data-testid="status-source-compat"
			class="m-0"
			:class="blueprint.sourceJsonCompatible ? 'text-success' : 'text-error'"
		>
			{{ i18n.t(blueprint.sourceJsonCompatible ? 'Compatible (Core)' : 'Incompatible (Core)') }}
		</dd>
		<dt class="text-muted">
			{{ i18n.t('Blueprint status') }}
		</dt>
		<dd
			data-testid="status-blueprint"
			class="m-0"
			:class="blueprint.status === 'valid' ? 'text-success' : 'text-error'"
		>
			{{ i18n.t(blueprint.status) }} · {{ blueprint.diagnostics.length }} {{ i18n.t(blueprint.diagnostics.length === 1 ? 'diagnostic' : 'diagnostics') }}
		</dd>
		<dt class="text-muted">
			{{ i18n.t('Recovery topology') }}
		</dt>
		<dd
			data-testid="status-recovery"
			class="m-0"
		>
			{{ unresolvedCount }} {{ i18n.t('unresolved') }} · {{ rawSlotCount }} {{ i18n.t('raw-slot placements') }}
		</dd>
	</dl>
</template>
