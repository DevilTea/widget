<script setup lang="ts">
/**
 * The expert JSON view: the Monaco editor over the JSON text, with the problems listed under it (audit U06).
 *
 * Lab UX phase 3 (one commit model): there is no Apply. Text that parses is committed through the same root SourcePatch as
 * every other edit, `JSON_COMMIT_DELAY_MS` after typing stops and at once when the editor loses focus (or on Cmd/Ctrl+Enter);
 * one focus session is one Undo entry. Text that does not parse is never committed: the toolbar says so, the syntax error is
 * a squiggle and a row of the Problems list (`LabStore.problems`, live), and the header offers "Discard JSON changes".
 * Format lives in this view's own toolbar.
 *
 * Problems come from `LabStore.problems` (Core diagnostics of the committed Document plus the JSON text's syntax error).
 * Each one is a squiggle in the editor and a row that jumps to its range; both are located by source path in the
 * *current* editor text (`lab/problems.ts`), so they stay on target while the user edits. Nothing here validates or parses
 * JSON for semantics.
 */
import type { EditorMarker } from '../../composables/use-monaco-editor'
import type { LabProblem } from '../../lab/problems'
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
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

function onFormat(): void {
	if (!store.hasJsonSyntaxError.value)
		void store.format()
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
			data-testid="json-toolbar"
			class="flex flex-none flex-wrap items-center gap-x-2 gap-y-1 border-b border-default px-2.5 py-1 text-[11px]"
		>
			<span
				data-testid="json-commit-state"
				:data-state="store.hasJsonSyntaxError.value ? 'syntax-error' : 'parses'"
				class="flex min-w-0 flex-1 items-center gap-1.5"
				:class="store.hasJsonSyntaxError.value ? 'font-semibold text-error' : 'text-muted'"
			>
				<UIcon
					v-if="store.hasJsonSyntaxError.value"
					name="i-lucide-circle-x"
					class="size-3.5 shrink-0"
					aria-hidden="true"
				/>
				<span class="min-w-0">{{ store.hasJsonSyntaxError.value
					? i18n.t('JSON has a syntax error — not applied. Fix it, or use Discard JSON changes in the header.')
					: i18n.t('Changes apply when you pause typing or leave the editor. JSON is applied as one root SourcePatch.') }}</span>
			</span>
			<UButton
				data-testid="format-button"
				color="neutral"
				variant="outline"
				size="xs"
				icon="i-lucide-align-left"
				:label="i18n.t('Format')"
				:aria-disabled="store.hasJsonSyntaxError.value ? 'true' : undefined"
				:title="store.hasJsonSyntaxError.value ? i18n.t('Fix the syntax error to format the JSON') : i18n.t('Format the JSON')"
				class="aria-disabled:opacity-50"
				@click="onFormat"
			/>
		</div>
		<div class="min-h-60 flex-1">
			<MonacoJsonEditor
				ref="editor"
				:modelValue="store.draftSourceText.value"
				:markers="markers"
				@update:modelValue="store.editJson"
				@focus="store.beginJsonEdit()"
				@blur="void store.endJsonEdit()"
				@commit="void store.flushJson()"
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
