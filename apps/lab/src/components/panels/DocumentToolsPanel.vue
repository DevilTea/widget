<script setup lang="ts">
/**
 * Lazy, closable Phase 6 developer aid. This panel observes the LabSession's transient patch/trace
 * data and invokes the public WidgetDocument conflict contract through the session; it is never an
 * authoring surface, semantic validator, or history store.
 */
import type { AnyWidgetPluginTuple, WidgetSource } from '@deviltea/widget-core'
import type { RevisionConflictDemoResult } from '../../lab/types'
import { separateWidgetSource } from '@deviltea/widget-core'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const i18n = useLabI18n()

const latestPatch = computed(() => store.lastAppliedSourcePatch.value)
const patchText = computed(() => latestPatch.value === null ? '' : JSON.stringify(latestPatch.value.patch, null, 2))
const separatedProjection = computed(() => {
	const blueprint = store.documentState.value.blueprint
	return blueprint.status === 'valid' ? separateWidgetSource(blueprint.source as WidgetSource<AnyWidgetPluginTuple>) : null
})
const separatedProjectionText = computed(() => separatedProjection.value === null ? null : JSON.stringify(separatedProjection.value, null, 2))
const conflictDemo = ref<RevisionConflictDemoResult | null>(null)
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const trace = computed(() => store.documentTrace.value)
let copyResetTimer: ReturnType<typeof setTimeout> | undefined
let isUnmounted = false

// A conflict result describes the snapshot against which it was demonstrated. Clear it when that
// committed snapshot is replaced (including a showcase/session replacement that happens to reuse r0),
// but do not clear from `runConflictDemo()` itself: the Core conflict call does not mutate the snapshot.
watch(() => store.documentSnapshot.value, () => {
	conflictDemo.value = null
})

const conflictFailureCode = computed(() => {
	const result = conflictDemo.value?.result
	return result !== undefined && !result.ok ? result.failure.code : null
})

async function copyPatch(): Promise<void> {
	if (patchText.value === '')
		return
	try {
		const writeText = navigator.clipboard?.writeText
		if (writeText === undefined)
			throw new Error('Clipboard API unavailable')
		await writeText.call(navigator.clipboard, patchText.value)
		copyState.value = 'copied'
	}
	catch {
		copyState.value = 'failed'
	}
	finally {
		if (!isUnmounted) {
			if (copyResetTimer !== undefined)
				clearTimeout(copyResetTimer)
			copyResetTimer = setTimeout(() => {
				copyState.value = 'idle'
				copyResetTimer = undefined
			}, 1500)
		}
	}
}

onUnmounted(() => {
	isUnmounted = true
	if (copyResetTimer !== undefined)
		clearTimeout(copyResetTimer)
	copyResetTimer = undefined
})

function copyLabel(): string {
	switch (copyState.value) {
		case 'copied': return i18n.t('Copied')
		case 'failed': return i18n.t('Copy failed')
		default: return i18n.t('Copy patch')
	}
}

function runConflictDemo(): void {
	conflictDemo.value = store.demonstrateRevisionConflict()
}
</script>

<template>
	<div
		data-testid="document-tools-panel"
		:class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0', minWidth: '0' })"
	>
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:document-tools"
			text="Developer observations for the current Document — transient, read-only, and never authoring history"
		/>
		<div :class="pika({ flex: '1 1 auto', minHeight: '0', overflow: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '14px' })">
			<section data-testid="document-tools-latest-patch">
				<div :class="pika({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' })">
					<h3 :class="pika({ margin: '0', fontSize: '12px' })">
						{{ i18n.t('Latest applied SourcePatch') }}
					</h3>
					<button
						type="button"
						data-testid="document-tools-copy-patch"
						:disabled="latestPatch === null"
						:class="pika({ 'padding': '3px 8px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
						@click="copyPatch"
					>
						{{ copyLabel() }}
					</button>
				</div>
				<p
					v-if="latestPatch === null"
					:class="pika({ margin: '6px 0 0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					{{ i18n.t('No SourcePatch has been applied in this session.') }}
				</p>
				<template v-else>
					<div :class="pika({ marginTop: '6px', fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
						{{ i18n.t(latestPatch.origin === 'json' ? 'JSON Apply' : 'Structure command') }} · {{ i18n.t('Document r{revision}', { revision: latestPatch.revision }) }}
					</div>
					<pre
						data-testid="document-tools-patch"
						:class="pika({ margin: '6px 0 0', padding: '8px', overflow: 'auto', fontSize: '10px', fontFamily: 'var(--lab-font-mono)', background: 'var(--lab-color-surface-alt)', border: '1px solid var(--lab-color-border)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })"
					>{{ patchText }}</pre>
				</template>
			</section>

			<section data-testid="document-tools-revision">
				<h3 :class="pika({ margin: '0', fontSize: '12px' })">
					{{ i18n.t('Document revision and optimistic concurrency') }}
				</h3>
				<dl :class="pika({ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '10px', rowGap: '4px', margin: '6px 0 0', fontSize: '11px' })">
					<dt>{{ i18n.t('Document revision') }}</dt>
					<dd :class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)' })">
						r{{ store.documentSnapshot.value.revision }}
					</dd>
					<dt>{{ i18n.t('Next apply expectedRevision') }}</dt>
					<dd :class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)' })">
						{{ store.documentSnapshot.value.revision }}
					</dd>
					<dt>{{ i18n.t('Preview revision') }}</dt>
					<dd :class="pika({ margin: '0', fontFamily: 'var(--lab-font-mono)' })">
						{{ store.preview.value?.revision ?? i18n.t('unavailable') }}
					</dd>
				</dl>
				<p :class="pika({ margin: '8px 0 0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('This fixture submits a harmless test operation with a deliberately stale expectedRevision directly to WidgetDocument.applyPatch().') }}
				</p>
				<button
					type="button"
					data-testid="document-tools-run-conflict"
					:disabled="store.isApplying.value"
					:class="pika({ 'marginTop': '8px', 'padding': '4px 8px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
					@click="runConflictDemo"
				>
					{{ i18n.t('Run conflict demonstration') }}
				</button>
				<div
					v-if="conflictDemo !== null"
					data-testid="document-tools-conflict-result"
					:class="pika({ marginTop: '8px', padding: '8px', fontSize: '11px', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)' })"
				>
					<strong>{{ i18n.t('Core result') }}: <code>{{ conflictFailureCode ?? i18n.t('accepted') }}</code></strong>
					<div>{{ i18n.t('expectedRevision') }}: <code>{{ conflictDemo.expectedRevision }}</code> · {{ i18n.t('actualRevision') }}: <code>{{ conflictDemo.afterDocumentRevision }}</code></div>
					<div>{{ i18n.t('Document revision') }}: r{{ conflictDemo.beforeDocumentRevision }} → r{{ conflictDemo.afterDocumentRevision }} · {{ i18n.t('Preview revision') }}: {{ conflictDemo.beforePreviewRevision ?? i18n.t('unavailable') }} → {{ conflictDemo.afterPreviewRevision ?? i18n.t('unavailable') }}</div>
				</div>
			</section>

			<section data-testid="document-tools-separated-source">
				<h3 :class="pika({ margin: '0', fontSize: '12px' })">
					{{ i18n.t('Separated-source projection') }}
				</h3>
				<p :class="pika({ margin: '6px 0 0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('Core projection of the current Document source; read-only and not an alternate authoring representation.') }}
				</p>
				<pre
					v-if="separatedProjectionText !== null"
					:class="pika({ margin: '6px 0 0', padding: '8px', overflow: 'auto', fontSize: '10px', fontFamily: 'var(--lab-font-mono)', background: 'var(--lab-color-surface-alt)', border: '1px solid var(--lab-color-border)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })"
				>{{ separatedProjectionText }}</pre>
				<p
					v-else
					:class="pika({ margin: '6px 0 0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					{{ i18n.t('Projection is available only for a valid Core WidgetSource.') }}
				</p>
			</section>

			<section data-testid="document-tools-trace">
				<h3 :class="pika({ margin: '0', fontSize: '12px' })">
					{{ i18n.t('Bounded session trace (observation only)') }}
				</h3>
				<p :class="pika({ margin: '6px 0 0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })">
					{{ i18n.t('This finite trace is telemetry only: it cannot replay, restore, undo, or redo Document state.') }}
				</p>
				<p
					v-if="trace.length === 0"
					:class="pika({ margin: '6px 0 0', fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
				>
					{{ i18n.t('No Document observations yet.') }}
				</p>
				<ol
					v-else
					:class="pika({ margin: '6px 0 0', paddingLeft: '20px', fontSize: '11px' })"
				>
					<li
						v-for="(event, index) in [...trace].reverse()"
						:key="`${event.kind}-${index}`"
						:class="pika({ marginBottom: '4px' })"
					>
						<template v-if="event.kind === 'commit'">
							{{ i18n.t(event.origin === 'json' ? 'JSON commit observed' : 'Structure commit observed') }} · {{ i18n.t('Document r{revision}', { revision: event.revision }) }} · {{ i18n.t(event.changed ? 'changed' : 'no-op') }}
						</template>
						<template v-else-if="event.kind === 'parse-error'">
							{{ i18n.t('JSON draft parse error observed') }} · {{ i18n.t('Document r{revision}', { revision: event.revision }) }}
						</template>
						<template v-else-if="event.kind === 'patch-error'">
							{{ i18n.t('SourcePatch failure observed') }} · {{ i18n.t('Document r{revision}', { revision: event.revision }) }} · <code>{{ event.code }}</code>
						</template>
						<template v-else>
							{{ i18n.t('Conflict demonstration observed') }} · {{ i18n.t('expectedRevision') }} <code>{{ event.expectedRevision }}</code> · {{ i18n.t('actualRevision') }} <code>{{ event.actualRevision }}</code> · <code>{{ event.failureCode ?? i18n.t('accepted') }}</code>
						</template>
					</li>
				</ol>
			</section>
		</div>
	</div>
</template>
