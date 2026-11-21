<script setup lang="ts">
/**
 * Closable/lazy Implementation explorer.
 *
 * Two presentation modes share the same curated `SourcesRegistry` and raw-file/Shiki loading path:
 *
 * - Focused instance: the existing #25 P3 contextual inspector driven by shared `LabStore.focus`, plus
 *   the concrete Applied instance from the applied source snapshot.
 * - Registered plugins (#42): a passive type-level catalog for every curated plugin in the current
 *   showcase. Catalog selection never mutates shared focus and never invents an instance selection.
 *
 * #43 localizes only Lab-owned explorer chrome. Plugin types, curated file titles/paths, source, and
 * Applied-instance JSON remain verbatim. Raw source remains lazy through `ImplementationFile`.
 */
import type { ImplementationExplorerMode } from '../../composables/use-implementation-explorer'
import { computed, ref, watch } from 'vue'
import { useImplementationExplorer } from '../../composables/use-implementation-explorer'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { extractAppliedInstance } from '../../implementation/applied-instance'
import { resolveFocusedWidget } from '../../implementation/focused-widget'
import { getShowcase } from '../../showcases/registry'
import ImplementationFile from '../implementation/ImplementationFile.vue'
import ImplementationSourceView from '../implementation/ImplementationSourceView.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const APPLIED_INSTANCE_TAB = 'applied-instance'

const store = useLabStore()
const explorer = useImplementationExplorer()
const i18n = useLabI18n()

const mode = ref<ImplementationExplorerMode>(explorer.requestedMode.value)
// An explicit open request carries intent. Existing Preview/Blueprint/tutorial entry points call
// `open()` and therefore return to Focused instance; the header calls `open('catalog')`.
watch(() => explorer.openRequestTick.value, () => {
	mode.value = explorer.requestedMode.value
})

const focusedWidget = computed(() => resolveFocusedWidget(store.documentState.value.blueprint, store.documentFocus.value))
const showcase = computed(() => getShowcase(store.showcaseId.value))
const focusedEntry = computed(() => {
	const widget = focusedWidget.value
	const current = showcase.value
	if (widget === null || current === undefined)
		return null
	return current.sources[widget.type] ?? null
})

const catalogTypes = computed(() => Object.keys(showcase.value?.sources ?? {}))
const selectedCatalogType = ref<string | null>(null)
watch(showcase, (current) => {
	selectedCatalogType.value = current === undefined ? null : (Object.keys(current.sources)[0] ?? null)
}, { immediate: true })

const catalogEntry = computed(() => {
	const type = selectedCatalogType.value
	const current = showcase.value
	if (type === null || current === undefined)
		return null
	return current.sources[type] ?? null
})

const entry = computed(() => mode.value === 'focused' ? focusedEntry.value : catalogEntry.value)
const displayedType = computed(() => mode.value === 'focused' ? focusedWidget.value?.type ?? null : selectedCatalogType.value)

const appliedInstance = computed(() => {
	if (mode.value !== 'focused')
		return null
	const focus = store.documentFocus.value
	if (focusedWidget.value === null || focus === null)
		return null
	return extractAppliedInstance(store.documentState.value.blueprint, focus.nodeId)
})

/**
 * The selected file belongs to the currently-displayed entry. Watch both mode and entry identity: the
 * same registry object can back a focused type and the catalog's same type, but `Applied instance` is
 * legal only in focused mode, so switching modes must still reselect the first curated file.
 */
const selectedTabId = ref<string>(APPLIED_INSTANCE_TAB)
watch(
	() => [mode.value, entry.value] as const,
	([nextMode, nextEntry]) => {
		selectedTabId.value = nextEntry !== null
			? nextEntry.files[0].path
			: nextMode === 'focused' ? APPLIED_INSTANCE_TAB : ''
	},
	{ immediate: true },
)

const selectedFile = computed(() => entry.value?.files.find(file => file.path === selectedTabId.value) ?? null)
</script>

<template>
	<div class="flex flex-col h-full min-h-0 min-w-0">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:implementation"
			text="Inspect the focused widget instance or browse the current showcase's registered plugin implementations — readonly and curated"
		/>

		<div class="flex gap-[6px] p-[6px_10px] border-b border-b-lab-border flex-none">
			<button
				type="button"
				:aria-pressed="mode === 'focused'"
				class="p-[4px_8px] text-[11px] rounded-lab border border-lab-border text-lab-text cursor-pointer"
				:style="{ background: mode === 'focused' ? 'var(--lab-color-surface-alt)' : 'transparent' }"
				@click="mode = 'focused'"
			>
				{{ i18n.t('Focused instance') }}
			</button>
			<button
				type="button"
				:aria-pressed="mode === 'catalog'"
				class="p-[4px_8px] text-[11px] rounded-lab border border-lab-border text-lab-text cursor-pointer"
				:style="{ background: mode === 'catalog' ? 'var(--lab-color-surface-alt)' : 'transparent' }"
				@click="mode = 'catalog'"
			>
				{{ i18n.t('Registered plugins') }}
			</button>
		</div>

		<div
			v-if="mode === 'focused' && focusedWidget === null"
			class="p-[16px] text-[12px] text-lab-text-muted"
		>
			{{ i18n.t('No widget is focused. Select a widget in Preview (Inspect mode), Blueprint, or Dependencies, or browse Registered plugins without selecting an instance.') }}
		</div>
		<div
			v-else-if="mode === 'focused' && entry === null"
			class="p-[16px] text-[12px] text-lab-text-muted"
		>
			<code class="font-lab-mono">{{ focusedWidget?.type }}</code>
			{{ i18n.t('has no curated Implementation entry yet.') }}
		</div>
		<div
			v-else-if="mode === 'catalog' && catalogTypes.length === 0"
			class="p-[16px] text-[12px] text-lab-text-muted"
		>
			{{ i18n.t('This showcase has no curated registered-plugin Implementation entries.') }}
		</div>
		<div
			v-else-if="entry !== null"
			class="flex flex-auto min-h-0 min-w-0"
		>
			<nav
				v-if="mode === 'catalog'"
				:aria-label="i18n.t('Registered plugins')"
				class="flex flex-col flex-[0_0_180px] min-w-0 overflow-auto border-r border-r-lab-border p-[6px]"
			>
				<button
					v-for="type in catalogTypes"
					:key="type"
					type="button"
					:aria-current="selectedCatalogType === type ? 'true' : undefined"
					class="p-[5px_7px] text-left text-[11px] [border:none] rounded-lab text-lab-text cursor-pointer font-lab-mono"
					:style="{ background: selectedCatalogType === type ? 'var(--lab-color-surface-alt)' : 'transparent' }"
					@click="selectedCatalogType = type"
				>
					{{ type }}
				</button>
			</nav>

			<div class="flex flex-col flex-auto min-h-0 min-w-0">
				<div class="p-[6px_10px] text-[11px] text-lab-text-muted border-b border-b-lab-border flex-none">
					<strong class="text-lab-text">{{ displayedType }}</strong>
					— {{ showcase === undefined ? '' : i18n.t(showcase.label) }}
				</div>
				<div class="flex border-b border-b-lab-border flex-none overflow-x-auto">
					<button
						v-for="file in entry.files"
						:key="file.path"
						type="button"
						class="flex-none p-[6px_10px] text-[11px] [border:none] bg-transparent text-lab-text cursor-pointer whitespace-nowrap"
						:style="{ fontWeight: selectedTabId === file.path ? '600' : 'normal', borderBottom: selectedTabId === file.path ? '2px solid var(--lab-color-accent)' : '2px solid transparent' }"
						@click="selectedTabId = file.path"
					>
						{{ file.title }}
					</button>
					<button
						v-if="mode === 'focused'"
						type="button"
						class="flex-none p-[6px_10px] text-[11px] [border:none] bg-transparent text-lab-text cursor-pointer whitespace-nowrap"
						:style="{ fontWeight: selectedTabId === APPLIED_INSTANCE_TAB ? '600' : 'normal', borderBottom: selectedTabId === APPLIED_INSTANCE_TAB ? '2px solid var(--lab-color-accent)' : '2px solid transparent' }"
						@click="selectedTabId = APPLIED_INSTANCE_TAB"
					>
						{{ i18n.t('Applied instance') }}
					</button>
				</div>
				<div
					v-if="selectedFile !== null"
					class="flex flex-col flex-auto min-h-0 min-w-0"
				>
					<div class="p-[4px_10px] text-[11px] text-lab-text-muted font-lab-mono overflow-x-auto flex-none">
						{{ selectedFile.path }}
					</div>
					<div class="flex-auto min-h-0 min-w-0">
						<ImplementationFile :file="selectedFile" />
					</div>
				</div>
				<div
					v-else-if="mode === 'focused'"
					class="flex flex-col flex-auto min-h-0 min-w-0"
				>
					<p
						v-if="appliedInstance === null || appliedInstance.status === 'not-found'"
						class="p-[10px] text-[12px] text-lab-text-muted"
					>
						{{ i18n.t("This widget's declaration was not found in the applied Source — it may only exist in the unapplied draft, or the applied Blueprint changed since this focus was set.") }}
					</p>
					<ImplementationSourceView
						v-else
						:code="appliedInstance.json"
						lang="json"
					/>
				</div>
			</div>
		</div>
	</div>
</template>
