<script setup lang="ts">
/**
 * The expert JSON view: the Monaco draft editor, with the last Apply's problems listed under it (audit U06).
 * Problems come from `LabStore.problems` (Core diagnostics of the committed Document plus the JSON syntax
 * error of the last Apply). Each one is a squiggle in the editor and a row that jumps to its range; both are
 * located by source path in the *current* editor text (`lab/problems.ts`), so they stay on target while the
 * user edits. Nothing here validates or parses JSON for semantics.
 */
import type { EditorMarker } from '../../composables/use-monaco-editor'
import type { LabProblem } from '../../lab/problems'
import { computed, nextTick, onMounted, useTemplateRef, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { problemSpan } from '../../lab/problems'
import MonacoJsonEditor from '../editor/MonacoJsonEditor.vue'
import AuthorProblems from './AuthorProblems.vue'

const store = useLabStore()
const i18n = useLabI18n()
const editor = useTemplateRef('editor')
const problemsList = useTemplateRef('problemsList')

const markers = computed<readonly EditorMarker[]>(() => {
	const text = store.draftSourceText.value
	return store.problems.value.flatMap((problem) => {
		const span = problemSpan(problem, text)
		return span === null ? [] : [{ start: span.start, end: span.end, message: problem.message, code: problem.code ?? undefined }]
	})
})

function jumpTo(problem: LabProblem): void {
	const span = problemSpan(problem, store.draftSourceText.value)
	if (span !== null)
		editor.value?.revealRange(span.start, span.end)
}

function applyFromEditor(): void {
	if (store.canApply.value)
		void store.apply()
}

// "Show problems" elsewhere (the stale-preview notice) opens this view and asks for focus on the list.
async function focusProblemsIfRequested(): Promise<void> {
	if (!store.problemsFocusPending.value)
		return
	store.problemsFocusPending.value = false
	// Dockview may still be activating the Author tab: wait for it to be laid out before focusing.
	await nextTick()
	await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
	problemsList.value?.focusList()
}
watch(store.problemsFocusPending, focusProblemsIfRequested)
onMounted(focusProblemsIfRequested)
</script>

<template>
	<div class="flex h-full min-h-0 flex-col">
		<div
			class="flex-none border-b border-default px-2.5 py-1.5 text-[11px] text-muted"
		>
			{{ i18n.t('Expert JSON view: edit the draft, then use Apply. JSON is parsed into one root SourcePatch.') }}
		</div>
		<div class="min-h-0 flex-1">
			<MonacoJsonEditor
				ref="editor"
				:modelValue="store.draftSourceText.value"
				:markers="markers"
				@update:modelValue="store.setDraftSourceText"
				@apply="applyFromEditor"
			/>
		</div>
		<AuthorProblems
			ref="problemsList"
			:problems="store.problems.value"
			:draftIsDirty="store.isDirty.value"
			@jump="jumpTo"
		/>
	</div>
</template>
