<script setup lang="ts">
/**
 * `BarChart#stage-chart` is the preset's single instance, so hardcoding its title here (matching
 * `../presets.ts`'s configured `title` verbatim) carries no per-instance ambiguity. Simple CSS bars —
 * no chart library. `series` always comes from `DealQuery.stageSeries` through the configured
 * `PropertySourceConfig` dependency; grouping/aggregation never happens here (checkpoint §2).
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed } from 'vue'
import { BarChartPlugin } from '../plugins/read-models'

const { useProperties } = useWidget(BarChartPlugin)
const { series } = useProperties()

const maxValue = computed(() => Math.max(1, ...(series.value ?? []).map(point => point.value)))
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '8px' })">
		<h3 :class="pika({ margin: '0', fontSize: '13px' })">
			Deals by stage
		</h3>
		<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '6px' })">
			<div
				v-for="point in series"
				:key="point.label"
				:class="pika({ display: 'grid', gridTemplateColumns: '90px 1fr 28px', alignItems: 'center', gap: '8px', fontSize: '11px' })"
			>
				<span :class="pika({ color: 'var(--lab-color-text-muted)', textTransform: 'capitalize' })">{{ point.label }}</span>
				<div :class="pika({ background: 'var(--lab-color-surface-alt)', borderRadius: 'var(--lab-radius)', height: '10px', overflow: 'hidden' })">
					<div
						:class="pika({ height: '100%', background: 'var(--lab-color-accent)', borderRadius: 'var(--lab-radius)' })"
						:style="{ width: `${(point.value / maxValue) * 100}%` }"
					/>
				</div>
				<span>{{ point.value }}</span>
			</div>
		</div>
	</div>
</template>
