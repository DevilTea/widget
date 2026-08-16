<script setup lang="ts">
/**
 * Compact header: preset selection, semantic status, and Apply controls only — per issue #13
 * (Widget Lab Phase 4) Checkpoint I, no navigation/marketing chrome that would consume workbench
 * vertical space.
 */
import type { TutorialTourId } from '../composables/use-tutorial'
import { computed } from 'vue'
import { useLabStore } from '../composables/use-lab-store'
import { useTutorialStore } from '../composables/use-tutorial'

const store = useLabStore()
const tutorial = useTutorialStore()

const blueprintStatus = computed(() => store.active.value.blueprint.status)
const issueCount = computed(() => store.active.value.blueprint.getCollectedIssues().length)
const runtimeAvailable = computed(() => store.active.value.runtime !== null)

/**
 * One header entry point covers start/resume/restart/pause (issue #25 P1): "closing the rail pauses"
 * (`TutorialRail.vue`'s own close control) and "the header button resumes/restarts" are both true, but
 * routing every status through this single button — rather than adding a second dedicated pause control
 * here — keeps the header's tutorial affordance count at one, matching its existing "no
 * navigation/marketing chrome" compactness (see this component's original file header).
 */
const tutorialButtonLabel = computed(() => {
	switch (tutorial.snapshot.value.status) {
		case 'paused': return 'Resume tutorial'
		case 'completed': return 'Restart tutorial'
		case 'active': return 'Pause tutorial'
		default: return 'Tutorial'
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

/**
 * Tour picker (issue #25 P4 Scope B): the locked policy is "Survey is the first-run path; the CRM tour
 * unlocks after completion and from the persistent Tutorial header entry" — rather than a second header
 * button, this reuses the header's existing `<select>` vocabulary (already used for showcase/preset) so
 * picking a tour is keyboard-accessible native-select semantics, not a new bespoke control. Only rendered
 * once `crmTourUnlocked` (i.e. never on first visit — Welcome/the plain "Tutorial" button stay the only
 * entry points until Survey has been completed once this session); the action button below it keeps
 * working exactly as before, just against whichever tour is currently selected here.
 */
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
</script>

<template>
	<header :class="pika({ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderBottom: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', flex: '0 0 auto' })">
		<strong :class="pika({ fontSize: '13px', letterSpacing: '0.02em' })">Widget Lab</strong>

		<select
			:value="store.showcaseId.value"
			:class="pika({ background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '4px 8px', fontSize: '12px' })"
			aria-label="Switch showcase"
			@change="onShowcaseChange"
		>
			<option
				v-for="showcase in store.showcases"
				:key="showcase.id"
				:value="showcase.id"
			>
				{{ showcase.label }}
			</option>
		</select>

		<select
			:class="pika({ background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '4px 8px', fontSize: '12px' })"
			aria-label="Load a preset"
			@change="onPresetChange"
		>
			<option value="">
				Preset…
			</option>
			<option
				v-for="preset in store.presets.value"
				:key="preset.id"
				:value="preset.id"
				:title="preset.description"
			>
				{{ preset.label }}
			</option>
		</select>

		<select
			v-if="tutorial.crmTourUnlocked.value"
			:value="tutorial.activeTourId.value"
			:disabled="tutorial.tourPickerDisabled.value"
			:class="pika({ 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'border': '1px solid var(--lab-color-border)', 'borderRadius': 'var(--lab-radius)', 'padding': '4px 8px', 'fontSize': '12px', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			aria-label="Choose tutorial"
			@change="onTutorialTourChange"
		>
			<option value="survey">
				Survey tour
			</option>
			<option value="crm">
				CRM tour
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
			:class="pika({
				display: 'inline-flex',
				alignItems: 'center',
				gap: '6px',
				padding: '3px 8px',
				borderRadius: '999px',
				fontSize: '11px',
				border: '1px solid var(--lab-color-border)',
			})"
			:style="{ color: blueprintStatus === 'valid' ? 'var(--lab-color-success)' : 'var(--lab-color-danger)' }"
		>
			Blueprint: {{ blueprintStatus }}<template v-if="issueCount > 0"> ({{ issueCount }} issue{{ issueCount === 1 ? '' : 's' }})</template>
		</span>

		<span
			:class="pika({ display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', border: '1px solid var(--lab-color-border)' })"
			:style="{ color: runtimeAvailable ? 'var(--lab-color-success)' : 'var(--lab-color-text-muted)' }"
		>
			Runtime: {{ runtimeAvailable ? 'active' : 'unavailable' }}
		</span>

		<button
			type="button"
			:disabled="!store.isDirty.value"
			:class="pika({ 'padding': '5px 10px', 'fontSize': '12px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			@click="store.revert()"
		>
			Revert
		</button>
		<button
			type="button"
			:class="pika({ padding: '5px 10px', fontSize: '12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
			@click="store.format()"
		>
			Format
		</button>
		<button
			type="button"
			:disabled="!store.isDirty.value || store.isApplying.value"
			title="Apply (Cmd/Ctrl+Enter)"
			:class="pika({ 'padding': '5px 12px', 'fontSize': '12px', 'fontWeight': '600', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-accent)', 'background': 'var(--lab-color-accent)', 'color': 'var(--lab-color-accent-contrast)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			@click="store.apply()"
		>
			{{ store.isApplying.value ? 'Applying…' : 'Apply' }}
		</button>
	</header>
</template>
