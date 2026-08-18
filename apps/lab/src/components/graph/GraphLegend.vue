<script setup lang="ts">
/** Pure graph-projection legend. #43 translates only explanatory chrome; semantic edge/member tokens stay. */
import { ref, useId } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'

const i18n = useLabI18n()
const open = ref(false)
const panelId = useId()

function toggle(): void {
	open.value = !open.value
}
</script>

<template>
	<div :class="pika({ position: 'relative' })">
		<button
			type="button"
			:aria-expanded="open"
			:aria-controls="panelId"
			:class="pika({ 'padding': '3px 8px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			@click="toggle"
		>
			{{ i18n.t('Legend') }}
		</button>

		<div
			v-if="open"
			:id="panelId"
			role="group"
			:aria-label="i18n.t('Graph legend')"
			:class="pika({ position: 'absolute', top: 'calc(100% + 4px)', left: '0', zIndex: '10', width: '300px', padding: '10px 12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', boxShadow: '0 8px 24px color-mix(in srgb, black 40%, transparent)', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '11px' })"
		>
			<div :class="pika({ display: 'grid', gridTemplateColumns: '72px 1fr', gap: '5px 8px', alignItems: 'center' })">
				<strong>{{ i18n.t('Widget member') }}</strong>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">{{ i18n.t('One node per declared State / Property / Method. Identity is widgetId + member kind + member name.') }}</span>
				<strong>{{ i18n.t('Reads') }}</strong>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">{{ i18n.t('Read dependency: State/Property access, or a transitively read-only Method invocation from a Property.') }}</span>
				<strong>{{ i18n.t('Writes') }}</strong>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">{{ i18n.t('Write dependency: a Method writes State.') }}</span>
				<strong>{{ i18n.t('Invokes') }}</strong>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">{{ i18n.t('Method invocation dependency.') }}</span>
				<strong>{{ i18n.t('Dashed gray') }}</strong>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">{{ i18n.t('Optional dependency whose target is absent. Hidden unless “Show absent references” is enabled.') }}</span>
				<strong>{{ i18n.t('Dashed red') }}</strong>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">{{ i18n.t('Invalid/unresolved dependency. Always shown.') }}</span>
			</div>
			<p :class="pika({ margin: '0', color: 'var(--lab-color-text-muted)' })">
				{{ i18n.t('Only projected facts from the applied Blueprint are shown — no Runtime reads/evaluation.') }}
			</p>
		</div>
	</div>
</template>
