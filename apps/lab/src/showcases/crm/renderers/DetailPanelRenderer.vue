<script setup lang="ts">
/**
 * `fields` comes entirely from `useProperties()` — a Lab-private semantic projection of `DetailPanel`'s
 * own resolved config (`../plugins/read-models.ts`) — never hardcoded here, so a valid edited Source
 * that changes `config.fields` reaches this renderer (PR #22 review 4941241562 finding 1: "the accepted
 * checkpoint explicitly says the renderer displays configured fields"). `title`/`emptyText` stay
 * hardcoded: `DetailPanel#deal-detail` is the preset's single instance and those are purely cosmetic
 * copy, not semantic interaction/data presentation (checkpoint §6 implementation-detail latitude).
 * `record`/`empty` come entirely from `useProperties()` — sourced from `Table.selectedRow` through the
 * configured `PropertySourceConfig` dependency.
 */
import { useWidget } from '@deviltea/widget-vue'
import { DetailPanelPlugin } from '../plugins/read-models'

const { useProperties, WidgetSlot } = useWidget(DetailPanelPlugin)
const { record, empty, fields } = useProperties()

function fieldText(key: string, format: 'text' | 'currency' | 'badge' | undefined): string {
	const raw = record.value?.[key]
	if (format === 'currency' && typeof raw === 'number')
		return `$${raw.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
	return String(raw ?? '')
}

function badgeColor(key: string): string {
	switch (record.value?.[key]) {
		case 'won': return 'var(--lab-color-success)'
		case 'lost': return 'var(--lab-color-danger)'
		case 'negotiation': return 'var(--lab-color-warning)'
		default: return 'var(--lab-color-accent)'
	}
}
</script>

<template>
	<section :class="pika({ padding: '12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface)', display: 'flex', flexDirection: 'column', gap: '10px' })">
		<h3 :class="pika({ margin: '0', fontSize: '13px' })">
			Deal details
		</h3>
		<p
			v-if="empty"
			:class="pika({ margin: '0', fontSize: '12px', color: 'var(--lab-color-text-muted)', fontStyle: 'italic' })"
		>
			Select a deal from the table to see its details.
		</p>
		<template v-else>
			<dl :class="pika({ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: '0', fontSize: '12px' })">
				<template
					v-for="field in fields"
					:key="field.key"
				>
					<dt :class="pika({ color: 'var(--lab-color-text-muted)' })">
						{{ field.label }}
					</dt>
					<dd :class="pika({ margin: '0' })">
						<span
							v-if="field.format === 'badge'"
							:class="pika({ display: 'inline-block', padding: '1px 8px', borderRadius: '999px', fontSize: '11px', color: 'var(--lab-color-bg)' })"
							:style="{ background: badgeColor(field.key) }"
						>{{ fieldText(field.key, field.format) }}</span>
						<template v-else>
							{{ fieldText(field.key, field.format) }}
						</template>
					</dd>
				</template>
			</dl>
			<div>
				<WidgetSlot name="actions" />
			</div>
		</template>
	</section>
</template>
