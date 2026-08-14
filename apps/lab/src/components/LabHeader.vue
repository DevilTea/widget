<script setup lang="ts">
/**
 * Compact header: preset selection, semantic status, and Apply controls only — per issue #13
 * (Widget Lab Phase 4) Checkpoint I, no navigation/marketing chrome that would consume workbench
 * vertical space.
 */
import { computed } from 'vue'
import { useLabStore } from '../composables/use-lab-store'

const store = useLabStore()

const blueprintStatus = computed(() => store.active.value.blueprint.status)
const issueCount = computed(() => store.active.value.blueprint.getCollectedIssues().length)
const runtimeAvailable = computed(() => store.active.value.runtime !== null)

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
