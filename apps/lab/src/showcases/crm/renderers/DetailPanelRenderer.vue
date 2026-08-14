<script setup lang="ts">
/**
 * `DetailPanel#deal-detail` is the preset's single instance, so hardcoding its title/fields/empty text
 * here (matching `../presets.ts`'s configured `title`/`fields`/`emptyText` verbatim) carries no
 * per-instance ambiguity. `record`/`empty` come entirely from `useProperties()` — sourced from
 * `Table.selectedRow` through the configured `PropertySourceConfig` dependency.
 */
import { useWidget } from '@deviltea/widget-vue'
import { DetailPanelPlugin } from '../plugins/read-models'

interface DealField { readonly key: 'company' | 'contact' | 'owner' | 'stage' | 'amount', readonly label: string }

const fields: readonly DealField[] = [
	{ key: 'company', label: 'Company' },
	{ key: 'contact', label: 'Contact' },
	{ key: 'owner', label: 'Owner' },
	{ key: 'stage', label: 'Stage' },
	{ key: 'amount', label: 'Amount' },
]

const { useProperties, WidgetSlot } = useWidget(DetailPanelPlugin)
const { record, empty } = useProperties()

function fieldText(key: DealField['key']): string {
	const raw = record.value?.[key]
	if (key === 'amount' && typeof raw === 'number')
		return `$${raw.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
	return String(raw ?? '')
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
						{{ fieldText(field.key) }}
					</dd>
				</template>
			</dl>
			<div>
				<WidgetSlot name="actions" />
			</div>
		</template>
	</section>
</template>
