<script setup lang="ts">
/**
 * Resolves one curated `CuratedSourceFile.load()` thunk into raw text, then hands it to
 * `ImplementationSourceView.vue` for highlighted rendering. Kept as its own component (rather than
 * folded into `ImplementationSourceView.vue`) so the async-load loading/error state is distinct from
 * highlighting's own — a file whose raw text failed to load never even reaches the highlighter.
 *
 * Latest-selection-wins (P3 merge-gate review round 1, blocker 1): this component is reused across
 * selections (`<ImplementationFile :file="selectedFile" />`, no `:key`), so switching from file A to
 * file B while A's `load()` is still in flight must never let A's later-settling promise overwrite B's
 * already-rendered `code`/`status` — for either a stale success OR a stale rejection. `watch()`'s own
 * `onCleanup` (its third callback argument) is the explicit invalidation mechanism: it registers a
 * callback Vue runs the instant this watcher is about to re-run for a new `file` (or is stopped on
 * unmount), so `cancelled` flips true exactly when this in-flight `load()` call's result becomes stale,
 * and both the success and failure branches check it before writing anything.
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
	(file, _previousFile, onCleanup) => {
		let cancelled = false
		onCleanup(() => {
			cancelled = true
		})

		status.value = 'loading'
		code.value = null

		file.load()
			.then(
				(text) => {
					if (cancelled)
						return
					code.value = text
					status.value = 'ready'
				},
				() => {
					if (cancelled)
						return
					status.value = 'error'
				},
			)
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
