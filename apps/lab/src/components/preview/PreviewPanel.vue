<script setup lang="ts">
/**
 * Persistent parent-side Preview shell for issue #10 / Phase B2.
 *
 * The actual showcase Blueprint/Runtime, renderer tree and InspectorAgent live in `preview-frame.html`.
 * This component owns only the iframe element, presentation controls and the remote InspectorClient UI.
 * No Core Runtime or frame DOM is reachable through this component's state.
 */
import type { InspectorClient } from '@deviltea/widget-devtools'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useImplementationExplorer } from '../../composables/use-implementation-explorer'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { useLabTheme } from '../../composables/use-lab-theme'
import { resolveFocusedWidget } from '../../implementation/focused-widget'
import { createPreviewFrameDriver } from '../../preview-host/frame-driver'
import { getShowcase } from '../../showcases/registry'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const i18n = useLabI18n()
const theme = useLabTheme()
const implementationExplorer = useImplementationExplorer()
const previewFrame = useTemplateRef<HTMLIFrameElement>('previewFrame')
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
	previewFrame,
	(frame, _previous, onCleanup) => {
		if (frame === null)
			return
		const driver = createPreviewFrameDriver(frame, () => ({
			locale: i18n.locale.value,
			theme: theme.theme.value,
		}))
		const detach = store.previewHost.attachDriver(driver)
		onCleanup(detach)
	},
	{ flush: 'post', immediate: true },
)

watch(
	() => [i18n.locale.value, theme.theme.value] as const,
	([locale, currentTheme]) => store.previewHost.updatePresentation(locale, currentTheme),
	{ immediate: true },
)

watch(
	store.previewHost.connection,
	(connection, _previous, onCleanup) => {
		const restoreInspect = inspectRequested.value
		inspectorClient = null
		inspectorReady.value = false
		inspectCommandPending.value = false
		inspectActive.value = false
		if (connection === null)
			return

		const client = connection.inspectorClient
		inspectorClient = client
		const stopStatus = client.on('agent.status', ({ inspectEnabled }) => {
			if (inspectorClient !== client)
				return
			inspectActive.value = inspectEnabled
			if (!inspectEnabled && !inspectCommandPending.value)
				inspectRequested.value = false
		})
		const stopSelection = client.on('inspect.selected', (selection) => {
			if (inspectorClient !== client || selection.ref.runtimeId !== connection.runtimeId)
				return
			store.setFocus('preview', { nodeId: selection.ref.nodeId })
			store.activeTab.value = store.revisionStatus.value.isLinked ? 'blueprint' : 'runtime'
		})

		void (async () => {
			try {
				// The frame driver already handshakes before publishing a connection. Repeating it here is
				// intentional capability/liveness verification at the UI boundary after a remote replacement.
				await client.handshake()
				if (inspectorClient !== client)
					return
				if (restoreInspect)
					await client.request('inspect.enable', {})
				if (inspectorClient === client)
					inspectorReady.value = true
			}
			catch {
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
			// The frame driver/coordinator owns the shared client/port lifecycle. Closing it here would
			// tear down the remote host merely because this reactive connection object was replaced.
			if (inspectorClient === client) {
				inspectorClient = null
				inspectorReady.value = false
				inspectCommandPending.value = false
				inspectActive.value = false
			}
		})
	},
	{ immediate: true },
)

async function setInspectRequested(requested: boolean): Promise<void> {
	inspectRequested.value = requested
	const client = inspectorClient
	if (client === null || !inspectorReady.value || inspectCommandPending.value)
		return

	inspectCommandPending.value = true
	try {
		while (inspectActive.value !== inspectRequested.value) {
			if (inspectorClient !== client || !inspectorReady.value)
				return
			const target = inspectRequested.value
			const result = target
				? await client.request('inspect.enable', {})
				: await client.request('inspect.disable', {})
			if (inspectorClient !== client)
				return
			inspectActive.value = result.enabled
		}
	}
	catch {
		if (inspectorClient === client) {
			inspectActive.value = false
			inspectRequested.value = false
		}
	}
	finally {
		if (inspectorClient === client) {
			inspectCommandPending.value = false
			if (inspectActive.value !== inspectRequested.value)
				void setInspectRequested(inspectRequested.value)
		}
	}
}

function toggleInspect(): void {
	void setInspectRequested(!inspectRequested.value)
}

function onParentKeydown(event: KeyboardEvent): void {
	if (event.key !== 'Escape' || (!inspectRequested.value && !inspectActive.value))
		return
	event.preventDefault()
	event.stopPropagation()
	void setInspectRequested(false)
}

onMounted(() => window.addEventListener('keydown', onParentKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onParentKeydown, true))
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
			data-tutorial-target="preview"
			:class="pika({ position: 'relative', display: 'flex', flexDirection: 'column', flex: '1 1 auto', overflow: 'hidden', background: 'var(--lab-color-bg)', minHeight: '0' })"
		>
			<div
				v-if="store.revisionStatus.value.isDiverged"
				data-testid="preview-diverged-status"
				:class="pika({ margin: '10px 16px 0', padding: '6px 8px', border: '1px solid var(--lab-color-warning)', borderRadius: 'var(--lab-radius)', color: 'var(--lab-color-warning)', background: 'var(--lab-color-surface-alt)', fontSize: '11px', flex: '0 0 auto' })"
			>
				{{ i18n.t('Running previous valid Preview revision r{previewRevision}; current Document is r{documentRevision}.', { previewRevision: store.revisionStatus.value.previewRevision ?? '', documentRevision: store.revisionStatus.value.documentRevision }) }}
			</div>
			<iframe
				ref="previewFrame"
				title="Widget Lab Preview"
				data-testid="preview-frame"
				sandbox="allow-scripts allow-same-origin allow-forms"
				:class="pika({ width: '100%', flex: '1 1 auto', minHeight: '0', border: 'none', background: 'var(--lab-color-bg)' })"
				:style="{ display: store.preview.value === null ? 'none' : 'block' }"
			/>
			<p
				v-if="store.preview.value === null"
				:class="pika({ padding: '16px', margin: '0', color: 'var(--lab-color-text-muted)', fontSize: '13px' })"
			>
				{{ i18n.t('Preview unavailable — there is no valid Preview revision. See the Blueprint tab for diagnostics.') }}
			</p>
		</div>
	</div>
</template>
