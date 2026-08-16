<script setup lang="ts">
/**
 * The Implementation panel (issue #25 P3 Scope D) — a closable Dockview panel (default tab component,
 * NOT `NonClosableTab`; see `Workbench.vue`'s registration), lazily mounted only once
 * `ImplementationExplorerStore.open()` has been called at least once (see
 * `use-implementation-explorer.ts`). This file itself is registered behind `defineAsyncComponent` in
 * `Workbench.vue`, so it (and everything it statically imports — `ImplementationFile.vue` ->
 * `ImplementationSourceView.vue` -> `shiki-highlighter.ts`) only ever enters the explorer's own lazy
 * chunk, never the eager main bundle.
 *
 * Follows the shared cross-inspector focus (`LabStore.focus`), same grain as Blueprint/Runtime/Graph:
 * whenever focus changes — whether because this panel is already open, or because it is opened right
 * after a Preview Inspect-click / Blueprint selected-node click / tutorial step — it re-resolves the
 * focused widget's type and shows that type's curated entry. It never sets focus itself (see
 * `use-implementation-explorer.ts`'s file header).
 */
import { computed, ref, watch } from 'vue'
import { useLabStore } from '../../composables/use-lab-store'
import { extractAppliedInstance } from '../../implementation/applied-instance'
import { resolveFocusedWidget } from '../../implementation/focused-widget'
import { getShowcase } from '../../showcases/registry'
import ImplementationFile from '../implementation/ImplementationFile.vue'
import ImplementationSourceView from '../implementation/ImplementationSourceView.vue'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const APPLIED_INSTANCE_TAB = 'applied-instance'

const store = useLabStore()

const focusedWidget = computed(() => resolveFocusedWidget(store.active.value.blueprint, store.focus.value))
const showcase = computed(() => getShowcase(store.showcaseId.value))
const entry = computed(() => {
	const widget = focusedWidget.value
	const current = showcase.value
	if (widget === null || current === undefined)
		return null
	return current.sources[widget.type] ?? null
})

const appliedInstance = computed(() => {
	const widget = focusedWidget.value
	if (widget === null)
		return null
	return extractAppliedInstance(store.active.value.sourceText, widget.id)
})

/**
 * Defaults to the first curated file whenever the resolved entry changes identity (a new focused
 * widget type, or the Blueprint/showcase itself was replaced) — never sticks on a stale tab id from a
 * previously-focused, differently-shaped widget type.
 */
const selectedTabId = ref<string>(APPLIED_INSTANCE_TAB)
watch(entry, (next) => {
	selectedTabId.value = next !== null ? next.files[0].path : APPLIED_INSTANCE_TAB
}, { immediate: true })

const selectedFile = computed(() => entry.value?.files.find(file => file.path === selectedTabId.value) ?? null)
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:implementation"
			text="The plugin + Vue renderer code behind the focused widget type — readonly, curated, never a filesystem/editor"
		/>

		<div
			v-if="focusedWidget === null"
			:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
		>
			No widget is focused. Select a widget in Preview (Inspect mode), Blueprint, or Graph to see its
			implementation here.
		</div>
		<div
			v-else-if="entry === null"
			:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
		>
			<code :class="pika({ fontFamily: 'var(--lab-font-mono)' })">{{ focusedWidget.type }}</code>
			has no curated Implementation entry yet.
		</div>
		<template v-else>
			<div :class="pika({ padding: '6px 10px', fontSize: '11px', color: 'var(--lab-color-text-muted)', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
				<strong :class="pika({ color: 'var(--lab-color-text)' })">{{ focusedWidget.type }}</strong>
				— {{ showcase?.label }}
			</div>
			<div :class="pika({ display: 'flex', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto', overflowX: 'auto' })">
				<button
					v-for="file in entry.files"
					:key="file.path"
					type="button"
					:class="pika({ flex: '0 0 auto', padding: '6px 10px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer', whiteSpace: 'nowrap' })"
					:style="{ fontWeight: selectedTabId === file.path ? '600' : 'normal', borderBottom: selectedTabId === file.path ? '2px solid var(--lab-color-accent)' : '2px solid transparent' }"
					@click="selectedTabId = file.path"
				>
					{{ file.title }}
				</button>
				<button
					type="button"
					:class="pika({ flex: '0 0 auto', padding: '6px 10px', fontSize: '11px', border: 'none', background: 'transparent', color: 'var(--lab-color-text)', cursor: 'pointer', whiteSpace: 'nowrap' })"
					:style="{ fontWeight: selectedTabId === APPLIED_INSTANCE_TAB ? '600' : 'normal', borderBottom: selectedTabId === APPLIED_INSTANCE_TAB ? '2px solid var(--lab-color-accent)' : '2px solid transparent' }"
					@click="selectedTabId = APPLIED_INSTANCE_TAB"
				>
					Applied instance
				</button>
			</div>
			<div
				v-if="selectedFile !== null"
				:class="pika({ flex: '1 1 auto', minHeight: '0' })"
			>
				<div :class="pika({ padding: '4px 10px', fontSize: '10px', color: 'var(--lab-color-text-muted)', fontFamily: 'var(--lab-font-mono)' })">
					{{ selectedFile.path }}
				</div>
				<ImplementationFile :file="selectedFile" />
			</div>
			<div
				v-else
				:class="pika({ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: '0' })"
			>
				<p
					v-if="appliedInstance === null || appliedInstance.status === 'not-found'"
					:class="pika({ padding: '10px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
				>
					This widget's declaration was not found in the applied Source — it may only exist in the
					unapplied draft, or the applied Blueprint changed since this focus was set.
				</p>
				<ImplementationSourceView
					v-else
					:code="appliedInstance.json"
					lang="json"
				/>
			</div>
		</template>
	</div>
</template>
