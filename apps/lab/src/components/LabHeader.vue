<script setup lang="ts">
/**
 * Compact header: preset selection, semantic status, and Apply controls only — per issue #13
 * (Widget Lab Phase 4) Checkpoint I. #43 adds presentation-only locale selection; it never touches
 * LabStore/Runtime state.
 */
import type { LabLocale } from '../i18n/locale'
import type { TutorialTourId } from '../composables/use-tutorial'
import { computed } from 'vue'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useLabStore } from '../composables/use-lab-store'
import { useTutorialStore } from '../composables/use-tutorial'

const store = useLabStore()
const tutorial = useTutorialStore()
const i18n = useLabI18n()

const blueprintStatus = computed(() => store.active.value.blueprint.status)
const issueCount = computed(() => store.active.value.blueprint.getCollectedIssues().length)
const runtimeAvailable = computed(() => store.active.value.runtime !== null)

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

function onLocaleChange(event: Event): void {
	i18n.setLocale((event.target as HTMLSelectElement).value as LabLocale)
}
</script>

<template>
	<header :class="pika({ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderBottom: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', flex: '0 0 auto' })">
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
			:class="pika({ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', border: '1px solid var(--lab-color-border)' })"
			:style="{ color: blueprintStatus === 'valid' ? 'var(--lab-color-success)' : 'var(--lab-color-danger)' }"
		>
			{{ i18n.t('Blueprint') }}: {{ i18n.t(blueprintStatus) }}<template v-if="issueCount > 0"> ({{ issueCount }} {{ i18n.t(issueCount === 1 ? 'issue' : 'issues') }})</template>
		</span>

		<span
			:class="pika({ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', border: '1px solid var(--lab-color-border)' })"
			:style="{ color: runtimeAvailable ? 'var(--lab-color-success)' : 'var(--lab-color-text-muted)' }"
		>
			{{ i18n.t('Runtime') }}: {{ i18n.t(runtimeAvailable ? 'active' : 'unavailable') }}
		</span>

		<select
			:value="i18n.locale.value"
			:class="pika({ background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '4px 8px', fontSize: '12px' })"
			:aria-label="i18n.t('Language')"
			@change="onLocaleChange"
		>
			<option value="en">
				English
			</option>
			<option value="zh-TW">
				繁體中文（台灣）
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
