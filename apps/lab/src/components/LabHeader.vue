<script setup lang="ts">
/** Compact Lab utility header: presentation controls, semantic status, tutorial entry, and Apply actions. */
import type { TutorialTourId } from '../composables/use-tutorial'
import type { LabLocale } from '../i18n/locale'
import type { LabTheme } from '../theme/theme'
import { computed } from 'vue'
import { useDocumentTools } from '../composables/use-document-tools'
import { useImplementationExplorer } from '../composables/use-implementation-explorer'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useLabStore } from '../composables/use-lab-store'
import { useLabTheme } from '../composables/use-lab-theme'
import { useTutorialStore } from '../composables/use-tutorial'

const store = useLabStore()
const theme = useLabTheme()
const tutorial = useTutorialStore()
const i18n = useLabI18n()
const implementationExplorer = useImplementationExplorer()
const documentTools = useDocumentTools()

const blueprintStatus = computed(() => store.documentState.value.blueprint.status)
const diagnosticCount = computed(() => store.documentState.value.blueprint.diagnostics.length)
const documentRevision = computed(() => store.documentState.value.revision)
const previewRevision = computed(() => store.revisionStatus.value.previewRevision)

const tutorialButtonLabel = computed(() => {
	switch (tutorial.snapshot.value.status) {
		case 'paused': return i18n.t('Resume tutorial')
		case 'completed': return i18n.t('Restart tutorial')
		case 'active': return i18n.t('Pause tutorial')
		default: return i18n.t('Tutorial')
	}
})

function onTutorialButtonClick(): void {
	switch (tutorial.snapshot.value.status) {
		case 'paused':
			tutorial.requestResume()
			return
		case 'completed':
			tutorial.requestRestart()
			return
		case 'active':
			tutorial.pause()
			return
		default:
			tutorial.requestStart()
	}
}

function onTutorialTourChange(event: Event): void {
	tutorial.selectTour((event.target as HTMLSelectElement).value as TutorialTourId)
}

function onPresetChange(event: Event): void {
	const id = (event.target as HTMLSelectElement).value
	if (id === '')
		return
	void store.applyPreset(id)
	;(event.target as HTMLSelectElement).value = ''
}

function onShowcaseChange(event: Event): void {
	const id = (event.target as HTMLSelectElement).value
	void store.switchShowcase(id)
}

function onThemeChange(event: Event): void {
	theme.setTheme((event.target as HTMLSelectElement).value as LabTheme)
}

function onLocaleChange(event: Event): void {
	i18n.setLocale((event.target as HTMLSelectElement).value as LabLocale)
}
</script>

<template>
	<header :class="pika({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', rowGap: '6px', padding: '8px 14px', borderBottom: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', flex: '0 0 auto' })">
		<strong :class="pika({ fontSize: '13px', letterSpacing: '0.02em' })">Widget Lab</strong>

		<select
			:value="store.showcaseId.value"
			:class="pika({ background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '4px 8px', fontSize: '12px' })"
			:aria-label="i18n.t('Switch showcase')"
			@change="onShowcaseChange"
		>
			<option
				v-for="showcase in store.showcases"
				:key="showcase.id"
				:value="showcase.id"
			>
				{{ i18n.t(showcase.label) }}
			</option>
		</select>

		<select
			:class="pika({ background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '4px 8px', fontSize: '12px' })"
			:aria-label="i18n.t('Load a preset')"
			@change="onPresetChange"
		>
			<option value="">
				{{ i18n.t('Preset…') }}
			</option>
			<option
				v-for="preset in store.presets.value"
				:key="preset.id"
				:value="preset.id"
				:title="i18n.t(preset.description)"
			>
				{{ i18n.t(preset.label) }}
			</option>
		</select>

		<button
			type="button"
			:class="pika({ padding: '5px 10px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			@click="implementationExplorer.open('catalog')"
		>
			{{ i18n.t('Implementation') }}
		</button>
		<button
			type="button"
			data-testid="open-document-tools"
			:class="pika({ padding: '5px 10px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			@click="documentTools.open()"
		>
			{{ i18n.t('Document Tools') }}
		</button>

		<select
			v-if="tutorial.crmTourUnlocked.value"
			:value="tutorial.activeTourId.value"
			:disabled="tutorial.tourPickerDisabled.value"
			:class="pika({ 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'border': '1px solid var(--lab-color-border)', 'borderRadius': 'var(--lab-radius)', 'padding': '4px 8px', 'fontSize': '12px', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			:aria-label="i18n.t('Choose tutorial')"
			@change="onTutorialTourChange"
		>
			<option value="survey">
				{{ i18n.t('Survey tour') }}
			</option>
			<option value="crm">
				{{ i18n.t('CRM tour') }}
			</option>
		</select>
		<button
			type="button"
			:disabled="tutorial.startPending.value"
			:class="pika({ 'padding': '5px 10px', 'fontSize': '12px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			@click="onTutorialButtonClick"
		>
			{{ tutorialButtonLabel }}
		</button>

		<span :class="pika({ marginLeft: 'auto' })" />

		<span
			data-testid="document-status"
			:class="pika({ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', border: '1px solid var(--lab-color-border)' })"
			:style="{ color: blueprintStatus === 'valid' ? 'var(--lab-color-ok)' : 'var(--lab-color-danger)' }"
		>
			{{ i18n.t('Document r{revision}', { revision: documentRevision }) }} · {{ i18n.t('Blueprint') }}: {{ i18n.t(blueprintStatus) }} ({{ diagnosticCount }} {{ i18n.t(diagnosticCount === 1 ? 'diagnostic' : 'diagnostics') }})
		</span>

		<span
			data-testid="preview-status"
			:class="pika({ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', border: '1px solid var(--lab-color-border)' })"
			:style="{ color: previewRevision === null ? 'var(--lab-color-text-muted)' : store.revisionStatus.value.isPreviewStale ? 'var(--lab-color-warning)' : 'var(--lab-color-ok)' }"
		>
			{{ previewRevision === null ? i18n.t('Preview unavailable') : i18n.t('Preview r{revision}', { revision: previewRevision }) }}
		</span>

		<span
			data-testid="revision-link-status"
			:class="pika({ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', border: '1px solid var(--lab-color-border)' })"
			:style="{ color: store.revisionStatus.value.isLinked ? 'var(--lab-color-ok)' : 'var(--lab-color-warning)' }"
		>
			<span aria-hidden="true">{{ store.revisionStatus.value.isLinked ? '●' : '!' }}</span>
			{{ i18n.t(store.revisionStatus.value.isLinked ? 'Linked / Synced' : store.revisionStatus.value.state === 'diverged' ? 'Diverged / Unlinked' : 'Unlinked') }}
		</span>

		<select
			:value="theme.theme.value"
			:class="pika({ width: '64px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '4px 6px', fontSize: '12px' })"
			:aria-label="i18n.t('Theme')"
			@change="onThemeChange"
		>
			<option value="light">
				{{ i18n.t('Light') }}
			</option>
			<option value="dark">
				{{ i18n.t('Dark') }}
			</option>
		</select>

		<select
			:value="i18n.locale.value"
			:class="pika({ width: '64px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '4px 6px', fontSize: '12px' })"
			:aria-label="i18n.t('Language')"
			@change="onLocaleChange"
		>
			<option value="en">
				EN
			</option>
			<option value="zh-TW">
				繁中
			</option>
		</select>

		<button
			type="button"
			:disabled="!store.isDirty.value"
			:class="pika({ 'padding': '5px 10px', 'fontSize': '12px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			@click="store.revert()"
		>
			{{ i18n.t('Revert') }}
		</button>
		<button
			type="button"
			:class="pika({ padding: '5px 10px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			@click="store.format()"
		>
			{{ i18n.t('Format') }}
		</button>
		<button
			type="button"
			:disabled="!store.isDirty.value || store.isApplying.value"
			:title="`${i18n.t('Apply')} (Cmd/Ctrl+Enter)`"
			:class="pika({ 'padding': '5px 12px', 'fontSize': '12px', 'fontWeight': '600', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-accent)', 'background': 'var(--lab-color-accent)', 'color': 'var(--lab-color-accent-contrast)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			@click="store.apply()"
		>
			{{ i18n.t(store.isApplying.value ? 'Applying…' : 'Apply') }}
		</button>
	</header>
</template>
