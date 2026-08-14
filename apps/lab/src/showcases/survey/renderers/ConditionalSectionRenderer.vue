<script setup lang="ts">
/**
 * Renders `body` only when `visible` is strictly `true`. A `visible` Property failure (e.g. an
 * unresolvable/refinement-rejected condition target) projects to `null` through `useProperties()`
 * (checkpoint §2's "visible property failure -> hidden") — `=== true` treats that identically to `false`.
 */
import { useWidget } from '@deviltea/widget-vue'
import { ConditionalSectionPlugin } from '../plugins/sections'

const { useProperties, WidgetSlot } = useWidget(ConditionalSectionPlugin)
const { visible } = useProperties()
</script>

<template>
	<section
		v-if="visible === true"
		:class="pika({ padding: '10px 12px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', marginBottom: '10px', background: 'var(--lab-color-surface)' })"
	>
		<WidgetSlot name="body" />
	</section>
</template>
