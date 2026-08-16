<script setup lang="ts">
/**
 * Resolves one curated `CuratedSourceFile.load()` thunk into raw text, then hands it to
 * `ImplementationSourceView.vue` for highlighted rendering. Kept as its own component (rather than
 * folded into `ImplementationSourceView.vue`) so the async-load loading/error state is distinct from
 * highlighting's own — a file whose raw text failed to load never even reaches the highlighter.
 */
import type { CuratedSourceFile } from '../../implementation/types'
import { ref, watch } from 'vue'
import { languageForPath } from '../../implementation/shiki-highlighter'
import ImplementationSourceView from './ImplementationSourceView.vue'

const props = defineProps<{
	file: CuratedSourceFile
}>()

const code = ref<string | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')

watch(
	() => props.file,
	async (file) => {
		status.value = 'loading'
		code.value = null
		try {
			code.value = await file.load()
			status.value = 'ready'
		}
		catch {
			status.value = 'error'
		}
	},
	{ immediate: true },
)
</script>

<template>
	<p
		v-if="status === 'loading'"
		:class="pika({ padding: '10px', fontSize: '12px', color: 'var(--lab-color-text-muted)' })"
	>
		Loading {{ file.title }}…
	</p>
	<p
		v-else-if="status === 'error'"
		:class="pika({ padding: '10px', fontSize: '12px', color: 'var(--lab-color-danger)' })"
	>
		Failed to load {{ file.title }}.
	</p>
	<ImplementationSourceView
		v-else
		:code="code!"
		:lang="languageForPath(file.path)"
	/>
</template>
