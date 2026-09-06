<script setup lang="ts">
/**
 * Persistent Preview surface. Runtime ownership/replacement stays in LabSession; this component only
 * renders the current Preview Runtime and consumes the experimental InspectorClient protocol.
 *
 * Issue #6 Phase A1 deliberately keeps Preview in the same Vue/DOM realm, but inspection no longer
 * relies on that fact: the in-process transport JSON-clones every message, InspectorAgent owns DOM
 * hit-testing/highlight/pointer suppression, and PreviewPanel only reacts to protocol events. The same
 * client can therefore survive a later MessagePort/iframe or browser-extension transport swap.
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { InspectorClient } from '@deviltea/widget-devtools'
import {
	createInProcessInspectorTransportPair,
	createInspectorClient,
} from '@deviltea/widget-devtools'
import { createInspectorAgent } from '@deviltea/widget-devtools/agent'
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import { useImplementationExplorer } from '../../composables/use-implementation-explorer'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { resolveFocusedWidget } from '../../implementation/focused-widget'
import { getShowcase } from '../../showcases/registry'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const i18n = useLabI18n()
const implementationExplorer = useImplementationExplorer()
const previewSurface = useTemplateRef<HTMLDivElement>('previewSurface')
const inspectActive = shallowRef(false)
const inspectRequested = shallowRef(false)
const inspectorReady = shallowRef(false)
const inspectCommandPending = shallowRef(false)
let inspectorClient: InspectorClient | null = null

const curatedEntryAvailable = computed(() => {
	const widget = resolveFocusedWidget(store.documentState.value.blueprint, store.documentFocus.value)
	if (widget === null)
		return false
	const showcase = getShowcase(store.showcaseId.value)
	return showcase !== undefined && widget.type in showcase.sources
})

watch(
	[previewSurface, store.previewRuntime],
	([root, runtime], _previous, onCleanup) => {
		const restoreInspect = inspectRequested.value
		inspectorClient = null
		inspectorReady.value = false
		inspectCommandPending.value = false
		// `inspectActive` is Agent-acknowledged state, not desired state. A replacement Agent starts
		// disabled, so never claim pointer suppression is active while an async transport is still
		// handshaking/restoring the user's requested Inspect state.
		inspectActive.value = false
		if (root === null || runtime === null)
			return
		inspectRequested.value = restoreInspect

		const transport = createInProcessInspectorTransportPair()
		const agent = createInspectorAgent({
			runtime,
			transport: transport.agent,
			dom: {
				root,
				highlightClass: 'lab-inspect-anchor--highlighted',
				badgeClass: 'lab-inspector-agent-badge',
			},
		})
		const client = createInspectorClient(transport.client)
		inspectorClient = client

		const stopStatus = client.on('agent.status', ({ inspectEnabled }) => {
			if (inspectorClient === client) {
				inspectActive.value = inspectEnabled
				inspectRequested.value = inspectEnabled
			}
		})
		const stopSelection = client.on('inspect.selected', (selection) => {
			if (inspectorClient !== client)
				return

			// Wire nodeIds are the numeric representation of this exact registered Runtime's
			// snapshot-local InspectionNodeId. Re-brand only at the local focus adapter boundary.
			store.setFocus('preview', { nodeId: selection.ref.nodeId as InspectionNodeId })
			store.activeTab.value = store.revisionStatus.value.isLinked ? 'blueprint' : 'runtime'
		})

		void (async () => {
			try {
				await client.handshake()
				if (inspectorClient !== client)
					return
				if (inspectRequested.value)
					await client.request('inspect.enable', {})
				if (inspectorClient === client)
					inspectorReady.value = true
			}
			catch {
				// A failed handshake leaves Inspect unavailable; normal Preview interaction remains intact.
				if (inspectorClient === client) {
					inspectActive.value = false
					inspectRequested.value = false
					inspectorReady.value = false
				}
			}
		})()

		onCleanup(() => {
			stopStatus()
			stopSelection()
			client.close()
			agent.dispose()
			if (inspectorClient === client) {
				inspectorClient = null
				inspectorReady.value = false
				inspectCommandPending.value = false
				inspectActive.value = false
			}
		})
	},
	{ flush: 'post', immediate: true },
)

async function toggleInspect(): Promise<void> {
	const client = inspectorClient
	if (client === null || !inspectorReady.value || inspectCommandPending.value)
		return

	const requested = !inspectActive.value
	inspectRequested.value = requested
	inspectCommandPending.value = true
	try {
		const result = requested
			? await client.request('inspect.enable', {})
			: await client.request('inspect.disable', {})
		if (inspectorClient === client) {
			inspectActive.value = result.enabled
			inspectRequested.value = result.enabled
		}
	}
	catch {
		if (inspectorClient === client) {
			inspectActive.value = false
			inspectRequested.value = false
		}
	}
	finally {
		if (inspectorClient === client)
			inspectCommandPending.value = false
	}
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:preview"
			text="The Vue presentation of the running widgets — interact here"
		/>
		<div :class="pika({ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
			<button
				type="button"
				:aria-label="i18n.t('Inspect')"
				:aria-pressed="inspectActive"
				:disabled="!inspectorReady || inspectCommandPending"
				:class="inspectActive
					? pika({ 'padding': '3px 10px', 'fontSize': '11px', 'fontWeight': '600', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-accent)', 'background': 'var(--lab-color-accent)', 'color': 'var(--lab-color-accent-contrast)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })
					: pika({ 'padding': '3px 10px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
				@click="toggleInspect"
			>
				{{ i18n.t('Inspect') }}
			</button>
			<span
				v-if="inspectActive"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('Click a widget to focus it in {surface} — Esc to exit', { surface: i18n.t(store.revisionStatus.value.isLinked ? 'Blueprint' : 'Runtime') }) }}
			</span>
			<button
				type="button"
				data-testid="preview-view-implementation"
				:disabled="!curatedEntryAvailable"
				:class="pika({ 'marginLeft': 'auto', 'padding': '3px 10px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
				@click="implementationExplorer.open()"
			>
				{{ i18n.t('View implementation') }}
			</button>
		</div>
		<div
			ref="previewSurface"
			data-tutorial-target="preview"
			:class="pika({ position: 'relative', flex: '1 1 auto', overflow: 'auto', padding: '16px', background: 'var(--lab-color-bg)', minHeight: '0' })"
			:style="{ cursor: inspectActive ? 'crosshair' : undefined }"
		>
			<div
				v-if="store.revisionStatus.value.isDiverged"
				data-testid="preview-diverged-status"
				:class="pika({ margin: '0 0 10px', padding: '6px 8px', border: '1px solid var(--lab-color-warning)', borderRadius: 'var(--lab-radius)', color: 'var(--lab-color-warning)', background: 'var(--lab-color-surface-alt)', fontSize: '11px' })"
			>
				{{ i18n.t('Running previous valid Preview revision r{previewRevision}; current Document is r{documentRevision}.', { previewRevision: store.revisionStatus.value.previewRevision ?? '', documentRevision: store.revisionStatus.value.documentRevision }) }}
			</div>
			<component
				:is="store.renderer.value"
				v-if="store.previewRuntime.value !== null"
				:runtime="store.previewRuntime.value"
			/>
			<p
				v-else
				:class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '13px' })"
			>
				{{ i18n.t('Preview unavailable — there is no valid Preview revision. See the Blueprint tab for diagnostics.') }}
			</p>
		</div>
	</div>
</template>
