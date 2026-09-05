<script setup lang="ts">
import { useLabI18n } from '../../../composables/use-lab-i18n'

defineProps<{
	message: string
}>()

const i18n = useLabI18n()
</script>

<template>
	<div
		class="relations-empty-state"
		:class="pika({
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'center',
			justifyContent: 'center',
			height: '100%',
			padding: '32px 24px',
			textAlign: 'center',
			color: 'var(--lab-color-text-muted)',
			fontFamily: 'var(--lab-font-sans)',
		})"
	>
		<div
			class="relations-empty-card"
			:class="pika({
				maxWidth: '420px',
				padding: '24px 28px',
				borderRadius: 'var(--lab-radius)',
				border: '1px dashed var(--lab-color-border)',
				background: 'var(--lab-color-surface)',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: '12px',
				boxShadow: '0 2px 10px color-mix(in srgb, var(--lab-color-text) 4%, transparent)',
			})"
		>
			<div
				class="relations-empty-icon"
				:class="pika({
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: '40px',
					height: '40px',
					borderRadius: '50%',
					background: 'var(--lab-color-surface-alt)',
					color: 'var(--lab-color-text)',
					fontSize: '18px',
					fontWeight: 'bold',
				})"
				aria-hidden="true"
			>
				☍
			</div>
			<h4
				:class="pika({
					margin: '0',
					fontSize: '13px',
					fontWeight: '600',
					color: 'var(--lab-color-text)',
				})"
			>
				{{ i18n.t('No focus selected') }}
			</h4>
			<p
				:class="pika({
					margin: '0',
					fontSize: '11px',
					lineHeight: '1.5',
					color: 'var(--lab-color-text-muted)',
				})"
			>
				{{ i18n.t(message) }}
			</p>
			<div
				:class="pika({
					marginTop: '6px',
					paddingTop: '12px',
					borderTop: '1px solid var(--lab-color-border)',
					fontSize: '10px',
					textAlign: 'left',
					width: '100%',
					color: 'var(--lab-color-text-muted)',
					display: 'flex',
					flexDirection: 'column',
					gap: '4px',
				})"
			>
				<span :class="pika({ fontWeight: '600', textTransform: 'uppercase', fontSize: '9px' })">
					{{ i18n.t('How to select focus:') }}
				</span>
				<div>• <strong>Preview</strong>: {{ i18n.t('Turn on Inspect and click a widget') }}</div>
				<div>• <strong>Blueprint</strong>: {{ i18n.t('Click a node or member in the tree') }}</div>
				<div>• <strong>Runtime</strong>: {{ i18n.t('Select a state, property, or method row') }}</div>
				<div>• <strong>Graph</strong>: {{ i18n.t('Click a widget cluster or member node') }}</div>
			</div>
		</div>
	</div>
</template>
