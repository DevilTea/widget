<script setup lang="ts">
/**
 * Persistent parent-side Preview shell for issue #10 / Phase B2.
 *
 * The actual showcase Blueprint/Runtime, renderer tree and InspectorAgent live in `preview-frame.html`.
 * This component owns only the iframe element, presentation controls and the remote InspectorClient UI.
 * No Core Runtime or frame DOM is reachable through this component's state.
 */
import type { InspectorClient } from '@deviltea/widget-inspector/client'
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { useLabTheme } from '../../composables/use-lab-theme'
import { useOpenTool } from '../../composables/use-open-tool'
import { resolveFocusedWidget } from '../../implementation/focused-widget'
import { previewReadinessTimeoutOverride } from '../../lab-test-seam'
import { createPreviewFrameDriver } from '../../preview-host/frame-driver'
import { getShowcase } from '../../showcases/registry'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'
import ReplacedDocumentNotice from './ReplacedDocumentNotice.vue'

const store = useLabStore()
const i18n = useLabI18n()
const theme = useLabTheme()
const openTool = useOpenTool()
const previewFrame = useTemplateRef<HTMLIFrameElement>('previewFrame')
const inspectActive = shallowRef(false)
const inspectRequested = shallowRef(false)
const inspectorReady = shallowRef(false)
const inspectCommandPending = shallowRef(false)
let inspectorClient: InspectorClient | null = null

const retrying = shallowRef(false)
/** The frame refused a change but still runs the last Preview that mounted: its content stays on screen. */
const frameKeepsRunning = computed(() => store.previewHost.error.value !== null && store.previewHost.runtimeSurvives.value)

/** Audit U22: tries the Preview again after it failed to load, timed out or lost its connection. */
async function retryPreview(): Promise<void> {
	retrying.value = true
	try {
		await store.retryPreview()
	}
	catch {
		// The failure is shown through `previewHost.error` again.
	}
	finally {
		retrying.value = false
	}
}

/**
 * Where a widget picked with Inspect is shown (Lab UX phase 3B). Linked: the Edit tab when it is the one showing (Structure
 * selects the widget, so the user keeps editing what they picked), otherwise Explain, the newcomer's view of one widget.
 * Diverged: only the Preview Runtime knows the widget, so the Runtime tree opens in the Tools group, and the Edit or Explain
 * tab the user was reading stays.
 */
const inspectTarget = computed<'edit' | 'explain' | 'runtime'>(() => {
	if (!store.revisionStatus.value.isLinked)
		return 'runtime'
	return store.toolGroupTab.value === 'edit' ? 'edit' : 'explain'
})
const inspectSurfaceLabel = computed(() => {
	switch (inspectTarget.value) {
		case 'edit': return i18n.t('Edit')
		case 'explain': return i18n.t('Explain')
		default: return i18n.t('Runtime tree')
	}
})

/** The widget "View implementation" opens, named on the button for assistive technology and in its tooltip. */
const implementationTarget = computed(() => resolveFocusedWidget(store.documentState.value.blueprint, store.documentFocus.value))
const implementationLabel = computed(() => {
	const widget = implementationTarget.value
	return widget === null ? i18n.t('View implementation') : i18n.t('View implementation of {widget}', { widget: `${widget.id} (${widget.type})` })
})

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
		}), {
			frameOrigin: import.meta.env.VITE_PREVIEW_FRAME_ORIGIN,
			readinessTimeoutMs: previewReadinessTimeoutOverride(),
		})
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
			// See `inspectTarget`: Edit stays, Explain is brought to the front, or (diverged) the Runtime tree opens beside the Preview.
			if (inspectTarget.value === 'runtime')
				openTool('runtime')
			else if (inspectTarget.value === 'explain')
				store.showTab('explain')
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
	<div class="flex flex-col h-full min-h-0">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:preview"
			text="The Vue presentation of the running widgets — interact here"
		/>
		<div class="flex items-center gap-[8px] p-[4px_8px] border-b border-b-lab-border flex-none">
			<button
				type="button"
				:aria-label="i18n.t('Inspect')"
				:aria-pressed="inspectActive"
				:disabled="!inspectorReady || inspectCommandPending"
				:class="inspectActive
					? 'p-[3px_10px] min-h-[24px] text-[11px] font-semibold rounded-lab border border-lab-accent bg-lab-accent text-lab-accent-contrast cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
					: 'p-[3px_10px] min-h-[24px] text-[11px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'"
				@click="toggleInspect"
			>
				{{ i18n.t('Inspect') }}
			</button>
			<!-- Names the panel a click opens (see `inspectTarget`): Edit or Explain while linked, the Runtime tree while diverged. -->
			<span
				v-if="inspectActive"
				data-testid="inspect-hint"
				class="text-[11px] text-lab-text-muted"
			>
				{{ i18n.t('Click a widget to open it in {surface} — Esc to exit', { surface: inspectSurfaceLabel }) }}
			</span>
			<button
				type="button"
				data-testid="preview-view-implementation"
				:aria-label="implementationLabel"
				:title="implementationLabel"
				:disabled="!curatedEntryAvailable"
				class="ml-auto p-[3px_10px] min-h-[24px] text-[11px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
				@click="openTool('implementation')"
			>
				{{ i18n.t('View implementation') }}
			</button>
		</div>
		<div
			data-tutorial-target="preview"
			class="relative flex flex-col flex-auto overflow-hidden bg-lab-bg min-h-0"
		>
			<!-- Lab UX phase 2: a preset load replaced committed edits; says so and offers Undo. -->
			<ReplacedDocumentNotice />
			<!-- Stale-preview notice (audit U07): says why the Preview lags and offers the way out. -->
			<div
				v-if="store.revisionStatus.value.isDiverged"
				data-testid="preview-diverged-status"
				role="status"
				class="mx-4 mt-2.5 flex flex-none flex-wrap items-center gap-x-2 gap-y-1 rounded-(--lab-radius) border border-(--lab-color-warning) bg-(--lab-color-surface-alt) px-2 py-1 text-[11px] text-(--lab-color-warning)"
			>
				<span class="min-w-0 flex-1 wrap-anywhere">
					{{ store.status.value.validity.kind === 'problems'
						? i18n.t(store.status.value.validity.count === 1 ? 'Your last change has {count} problem, so the preview still shows the last working version.' : 'Your last change has {count} problems, so the preview still shows the last working version.', { count: store.status.value.validity.count })
						: i18n.t('The preview does not show your latest change yet. It still shows the last working version.') }}
				</span>
				<!-- Only when there are problems to show: a valid Document has an empty list. -->
				<UButton
					v-if="store.status.value.validity.kind === 'problems'"
					data-testid="preview-show-problems"
					color="neutral"
					variant="outline"
					size="xs"
					icon="i-lucide-list-checks"
					:label="i18n.t('Show problems')"
					@click="store.showProblems()"
				/>
			</div>
			<!-- Audit U22: the frame did not load or lost its connection: say so, show the cause, offer a retry. -->
			<div
				v-if="store.previewHost.error.value !== null"
				data-testid="preview-error"
				:data-frame-state="frameKeepsRunning ? 'running' : 'lost'"
				role="alert"
				class="m-4 flex flex-none flex-col gap-2 rounded-(--lab-radius) border border-(--lab-color-danger) bg-(--lab-color-surface-alt) p-3 text-xs text-(--lab-color-text)"
			>
				<div class="flex items-center gap-2 text-sm font-semibold">
					<UIcon
						name="i-lucide-circle-x"
						class="size-4 shrink-0 text-(--lab-color-danger)"
						aria-hidden="true"
					/>
					{{ i18n.t(frameKeepsRunning ? 'The preview could not be updated' : 'The preview could not be loaded') }}
				</div>
				<p class="m-0">
					{{ i18n.t(frameKeepsRunning ? 'The preview frame refused the last change, so it still shows the last version that loaded. Try again; if it keeps failing, reload the page.' : 'Nothing is running in the preview: the frame did not respond, lost its connection or could not start your last change. Try again; if it keeps failing, reload the page.') }}
				</p>
				<p
					data-testid="preview-error-detail"
					class="m-0 font-mono text-[11px] wrap-anywhere text-(--lab-color-text-muted)"
				>
					{{ store.previewHost.error.value }}
				</p>
				<div>
					<UButton
						data-testid="preview-retry"
						color="primary"
						size="sm"
						icon="i-lucide-refresh-cw"
						:loading="retrying"
						:disabled="retrying"
						:label="i18n.t('Try again')"
						@click="retryPreview"
					/>
				</div>
			</div>
			<iframe
				ref="previewFrame"
				title="Widget Lab Preview"
				data-testid="preview-frame"
				sandbox="allow-scripts allow-same-origin allow-forms"
				class="w-full flex-auto min-h-0 [border:none] bg-lab-bg"
				:style="{ display: store.preview.value === null || (store.previewHost.error.value !== null && !frameKeepsRunning) ? 'none' : 'block' }"
			/>
			<p
				v-if="store.preview.value === null"
				class="p-[16px] m-0 text-lab-text-muted text-[13px]"
			>
				{{ i18n.t('Preview unavailable — there is no valid Preview revision. Open the Blueprint tree from Tools for diagnostics.') }}
			</p>
		</div>
	</div>
</template>
