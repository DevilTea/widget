<script setup lang="ts">
/**
 * The Implementation panel (issue #25 P3 Scope D). #43 localizes only Lab-owned explorer chrome;
 * plugin type names, curated file titles/paths, source, and Applied-instance JSON stay verbatim.
 */
import { computed, ref, watch } from 'vue'
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
const i18n = useLabI18n()

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
			{{ i18n.t('No widget is focused. Select a widget in Preview (Inspect mode), Blueprint, or Graph to see its implementation here.') }}
		</div>
		<div
			v-else-if="entry === null"
			:class="pika({ padding: '16px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
		>
			<code :class="pika({ fontFamily: 'var(--lab-font-mono)' })">{{ focusedWidget.type }}</code>
			{{ i18n.t('has no curated Implementation entry yet.') }}
		</div>
		<template v-else>
			<div :class="pika({ padding: '6px 10px', fontSize: '11px', color: 'var(--lab-color-text-muted)', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
				<strong :class="pika({ color: 'var(--lab-color-text)' })">{{ focusedWidget.type }}</strong>
				— {{ showcase === undefined ? '' : i18n.t(showcase.label) }}
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
					{{ i18n.t('Applied instance') }}
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
					{{ i18n.t("This widget's declaration was not found in the applied Source — it may only exist in the unapplied draft, or the applied Blueprint changed since this focus was set.") }}
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
