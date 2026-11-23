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
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, nextTick, onMounted, useTemplateRef, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { locateJsonValue } from '../../lab/json-locate'
import { problemMarkers, problemSpan } from '../../lab/problems'
import MonacoJsonEditor from '../editor/MonacoJsonEditor.vue'
import AuthorProblems from './AuthorProblems.vue'

const store = useLabStore()
const i18n = useLabI18n()
const editor = useTemplateRef('editor')
const problemsList = useTemplateRef('problemsList')

const markers = computed<readonly EditorMarker[]>(() => {
	const text = store.draftSourceText.value
	// One squiggle per location of each problem, each range, code and message drawn once (`problemMarkers()`).
	return problemMarkers(store.problems.value, text)
		.map(marker => ({ start: marker.start, end: marker.end, message: marker.message, code: marker.code ?? undefined }))
})

function jumpTo(problem: LabProblem): void {
	const span = problemSpan(problem, store.draftSourceText.value)
	if (span !== null)
		editor.value?.revealRange(span.start, span.end)
}

function onFormat(): void {
	if (store.parseError.value === null)
		void store.format()
}

/** What the toolbar says about the text: it applies as you go, or why it cannot be applied (a syntax error, or Core's refusal). */
const commitStateText = computed(() => {
	const block = store.jsonBlock.value
	if (block === null)
		return i18n.t('Changes apply when you pause typing or leave the editor. JSON is applied as one root SourcePatch.')
	if (block.kind === 'syntax')
		return i18n.t('JSON has a syntax error — not applied. Fix it, or use Discard JSON changes in the header.')
	const failure = block.failure
	const reason = 'reason' in failure && failure.reason !== undefined ? String(failure.reason) : failure.code
	return i18n.t('JSON can\'t be applied ({reason}) — Core refused it. Fix it, or use Discard JSON changes in the header.', { reason })
})

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

/**
 * The JSON view shows the selected widget's lines (Lab UX phase 3B): when it opens (toggling to JSON mounts it) and when the
 * user picks another widget while it is open (Inspect in the Preview, the tree of a view). Its whole object is highlighted, the
 * cursor goes to its start and its first lines are scrolled into view, located by its Core source path in the current text; nothing
 * is selected (a typed key would replace a selection) and focus stays where it is. Nothing happens for the root the focus starts at
 * (only a widget someone chose), while the user types in the editor (a commit keeps the same widget focused under a new node, and
 * the cursor must not jump), or when the text does not have that path (it does not parse, or the widget is not there any more).
 */
function revealSelectedWidget(): void {
	const focus = store.documentFocus.value
	if (!store.documentFocusChosen.value || focus === null || editor.value?.hasFocus() === true)
		return
	const path = inspectBlueprint(store.documentState.value.blueprint)
		.getNode(focus.nodeId)?.sourcePath
	if (path === undefined)
		return
	const span = locateJsonValue(store.draftSourceText.value, path)
	if (span !== null)
		editor.value?.highlightRange(span.start, span.end)
}

/** The chosen widget by identity: a commit that keeps the same widget focused under a new node is not a new choice. */
const chosenWidget = computed(() => {
	const focus = store.documentFocus.value
	if (!store.documentFocusChosen.value || focus === null)
		return null
	const node = inspectBlueprint(store.documentState.value.blueprint)
		.getNode(focus.nodeId)
	return node === null || !node.resolved ? null : `${node.node.id}\u0000${node.node.type}`
})
watch(chosenWidget, (next, previous) => {
	if (next !== null && next !== previous)
		revealSelectedWidget()
})

onMounted(() => {
	if (store.problemsFocusPending.value)
		void focusProblemsIfRequested()
	else
		revealSelectedWidget()
})
</script>

<template>
	<div class="flex h-full min-h-0 flex-col">
		<div
			data-testid="json-toolbar"
			class="flex flex-none flex-wrap items-center gap-x-2 gap-y-1 border-b border-default px-2.5 py-1 text-[11px]"
		>
			<span
				data-testid="json-commit-state"
				:data-state="store.status.value.json"
				class="flex min-w-0 flex-1 items-center gap-1.5"
				:class="store.jsonBlocked.value ? 'font-semibold text-error' : 'text-muted'"
			>
				<UIcon
					v-if="store.jsonBlocked.value"
					name="i-lucide-circle-x"
					class="size-3.5 shrink-0"
					aria-hidden="true"
				/>
				<span class="min-w-0">{{ commitStateText }}</span>
			</span>
			<UButton
				data-testid="format-button"
				color="neutral"
				variant="outline"
				size="xs"
				icon="i-lucide-align-left"
				:label="i18n.t('Format')"
				:aria-disabled="store.parseError.value !== null ? 'true' : undefined"
				:title="store.parseError.value !== null ? i18n.t('Fix the syntax error to format the JSON') : i18n.t('Format the JSON')"
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
			:textDiffers="store.isDirty.value"
			@jump="jumpTo"
		/>
	</div>
</template>
