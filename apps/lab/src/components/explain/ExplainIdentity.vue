<script setup lang="ts">
/**
 * What the selected widget is: its id, its plugin type and the plugin's generated summary (its `.description()`,
 * from the showcase's bundled widget docs). Ids and types are Widget data and stay as they are; the summary is source-owned
 * text, shown verbatim with its code spans as code. A widget that did not resolve shows Core's identity hints instead.
 */
import type { BlueprintInspectionNode } from '@deviltea/widget-core/inspection'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import DocProse from './DocProse.vue'

const props = defineProps<{
	node: BlueprintInspectionNode
	/** The plugin's documented summary, `''` when it has none. */
	summary: string
	headingId: string
}>()

const i18n = useLabI18n()
const id = computed(() => props.node.node.id)
const type = computed(() => props.node.node.type)
</script>

<template>
	<header
		data-testid="explain-identity"
		class="flex flex-col gap-1"
	>
		<h3
			:id="headingId"
			class="m-0 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold"
		>
			<span
				class="font-lab-mono"
				data-testid="explain-widget-id"
				v-text="id === null ? i18n.t('Unresolved node') : `#${id}`"
			/>
			<!-- A space, so the heading's accessible name is "#id Type" and not the two run together. -->
			<span v-text="' '" />
			<span
				v-if="type !== null"
				class="font-lab-mono text-xs font-normal text-muted"
				data-testid="explain-widget-type"
				v-text="type"
			/>
		</h3>
		<p
			v-if="!node.resolved"
			class="m-0 text-xs text-muted"
		>
			{{ i18n.t('This widget did not resolve, so Core declared nothing for it: no Properties, no dependencies. Its problems are under Declaration details.') }}
		</p>
		<p
			v-if="summary !== ''"
			data-testid="explain-summary"
			class="m-0 text-xs leading-5"
		>
			<DocProse :text="summary" />
		</p>
	</header>
</template>
