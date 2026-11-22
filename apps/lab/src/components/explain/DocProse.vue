<script setup lang="ts">
/**
 * Generated documentation text (a plugin summary, a config field description) with its Markdown code spans drawn as code
 * instead of raw backticks (Lab UX phase 2). Paragraph breaks stay (`white-space: pre-line`); the text itself is shown
 * verbatim and untranslated, like every source-owned text. Every piece is an element with `v-text`, so the template's line
 * breaks add no spaces.
 */
import { computed } from 'vue'
import { splitInlineCode } from '../../lib/prose'

const props = defineProps<{ text: string }>()
const segments = computed(() => splitInlineCode(props.text))
</script>

<template>
	<span
		data-testid="doc-prose"
		class="whitespace-pre-line"
	>
		<template
			v-for="(segment, index) in segments"
			:key="index"
		>
			<code
				v-if="segment.code"
				class="rounded-[3px] bg-muted px-0.5 font-lab-mono text-[0.95em]"
				v-text="segment.text"
			/>
			<span
				v-else
				v-text="segment.text"
			/>
		</template>
	</span>
</template>
