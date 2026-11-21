<script setup lang="ts">
/**
 * Presentation of one open editing session: the document's revision and status, Core's diagnostics with their source paths,
 * the application's plan, the buttons that act (apply the next step, "another editor saves", re-read and re-plan), the result
 * of the last call, the document listener's log and, once the document is valid, the preview and the export.
 *
 * Nothing is decided here: the session is the host's (`./repair-host.ts`), the plan is `planRepair`'s, validity is Core's. The
 * page never disables a button to hide a refusal: "Apply next step" is enabled whenever the app has a step, so a stale revision
 * is refused by Core, which is what the visitor sees.
 */
import type { Outcome, SessionView } from './repair-host'
import { computed, inject, ref } from 'vue'
import { BoardWidgetRenderer } from './board'
import { BUTTON_STYLE, PRIMARY_BUTTON_STYLE } from './control-style'
import DiagnosticList from './DiagnosticList.vue'
import { focusWhenRendered } from './focus'
import PlanList from './PlanList.vue'
import { RepairHostKey } from './repair-host'
import { useRepairText } from './use-repair-text'

const props = defineProps<{ session: SessionView }>()

const host = inject(RepairHostKey, null)
const { t, tf } = useRepairText()

const root = ref<HTMLElement | null>(null)

const id = computed(() => props.session.draftId)
const hasStep = computed(() => props.session.plan.length > 0)
const valid = computed(() => props.session.status === 'valid')

function result(outcome: Outcome | null): string {
	if (outcome === null)
		return t('resultNone')
	if (outcome.kind === 'applied') {
		if (outcome.by === 'other-editor')
			return tf('resultOtherSaved', { from: outcome.from, to: outcome.to })
		return tf('resultApplied', { changed: String(outcome.changed), from: outcome.from, to: outcome.to })
	}
	return tf('resultFailed', { code: outcome.code })
}

const failure = computed(() => {
	const outcome = props.session.lastOutcome
	return outcome?.kind === 'failed' ? outcome : null
})

const noChange = computed(() => {
	const outcome = props.session.lastOutcome
	return outcome?.kind === 'applied' && !outcome.changed
})

/** The control with this test id inside this session. */
function control(testId: string): HTMLElement | null {
	return root.value?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null
}

/**
 * "Apply next step" disables itself when the last step is applied, and a disabled button cannot keep the focus: it goes to
 * the control the visitor needs next (the preview once the document is valid, else the re-read button).
 */
function onApply(): void {
	host?.applyNext(id.value)
	void focusWhenRendered(() => props.session.plan.length === 0 ? control(valid.value ? `repair-preview-${id.value}` : `repair-reread-${id.value}`) : null)
}

/** "Close preview" removes itself: the focus goes back to the button that opened the preview. */
function onClosePreview(): void {
	host?.closePreview(id.value)
	void focusWhenRendered(() => control(`repair-preview-${id.value}`))
}

function by(writer: 'app' | 'other-editor'): string {
	return writer === 'app' ? t('byApp') : t('byOther')
}
</script>

<template>
	<div
		ref="root"
		class="session"
		:data-testid="`repair-session-${id}`"
	>
		<h4
			tabindex="-1"
			class="session-heading"
			:data-testid="`repair-session-heading-${id}`"
		>
			{{ t('sessionHeading') }}
		</h4>

		<dl class="session-facts">
			<div class="session-fact">
				<dt>{{ t('revisionLabel') }}</dt>
				<dd
					:data-testid="`repair-revision-${id}`"
					:data-revision="session.revision"
				>
					{{ session.revision }}
				</dd>
			</div>
			<div class="session-fact">
				<dt>{{ t('statusLabel') }}</dt>
				<dd
					:data-testid="`repair-doc-status-${id}`"
					:data-state="session.status"
				>
					{{ valid ? t('stateValid') : t('stateInvalid') }}
				</dd>
			</div>
			<div class="session-fact">
				<dt>{{ tf('appRevisionLabel', { n: session.appRevision }) }}</dt>
				<dd
					:data-testid="`repair-app-revision-${id}`"
					:data-revision="session.appRevision"
					class="session-app-revision"
				>
					{{ session.appRevision }}
				</dd>
			</div>
		</dl>
		<p
			v-if="session.stale"
			class="session-stale"
			:data-testid="`repair-stale-${id}`"
		>
			{{ tf('staleNote', { actual: session.revision, app: session.appRevision }) }}
		</p>

		<div class="session-actions">
			<button
				type="button"
				class="repair-button"
				:style="PRIMARY_BUTTON_STYLE"
				:disabled="!hasStep"
				:data-testid="`repair-apply-${id}`"
				@click="onApply"
			>
				{{ hasStep ? t('applyNext') : t('noStepsLeft') }}
			</button>
			<button
				type="button"
				class="repair-button"
				:style="BUTTON_STYLE"
				:title="t('otherEditorHint')"
				:data-testid="`repair-other-${id}`"
				@click="host?.otherEditorSaves(id)"
			>
				{{ t('otherEditor') }}
			</button>
			<button
				type="button"
				class="repair-button"
				:style="BUTTON_STYLE"
				:title="t('rereadHint')"
				:data-testid="`repair-reread-${id}`"
				@click="host?.reread(id)"
			>
				{{ t('reread') }}
			</button>
		</div>

		<section
			class="session-block"
			data-tutorial-target="repair-result"
		>
			<h5 class="session-block-title">
				{{ t('resultHeading') }}
			</h5>
			<p
				class="session-result"
				:data-testid="`repair-result-${id}`"
				:data-kind="session.lastOutcome === null ? 'none' : session.lastOutcome.kind"
			>
				{{ result(session.lastOutcome) }}
			</p>
			<p
				v-if="failure !== null"
				class="session-result-detail"
				:data-testid="`repair-result-detail-${id}`"
			>
				<code>{{ failure.code }}</code>
				<code v-if="failure.operationIndex !== undefined">{{ tf('resultOperationIndex', { index: failure.operationIndex }) }}</code>
				<code v-if="failure.expectedRevision !== undefined">{{ tf('resultRevisions', { expected: failure.expectedRevision, actual: failure.actualRevision ?? '' }) }}</code>
			</p>
			<p
				v-if="noChange"
				class="session-result-detail"
			>
				{{ t('resultAfterNoChange') }}
			</p>
		</section>

		<section
			class="session-block"
			data-tutorial-target="repair-diagnostics"
		>
			<h5 class="session-block-title">
				{{ t('diagnosticsHeading') }}
			</h5>
			<DiagnosticList :diagnostics="session.findings.diagnostics" />
		</section>

		<section
			class="session-block"
			data-tutorial-target="repair-plan"
		>
			<h5 class="session-block-title">
				{{ t('planHeading') }}
			</h5>
			<p class="session-note">
				{{ tf('planNote', { version: session.savedWith, revision: session.appRevision }) }}
			</p>
			<PlanList
				:steps="session.plan"
				:testId="`repair-plan-${id}`"
			/>
		</section>

		<section
			class="session-block"
			data-tutorial-target="repair-log"
		>
			<h5 class="session-block-title">
				{{ t('logHeading') }}
			</h5>
			<p
				v-if="session.log.length === 0"
				class="session-note"
			>
				{{ t('logEmpty') }}
			</p>
			<ol
				v-else
				class="session-log"
				:data-testid="`repair-log-${id}`"
			>
				<li
					v-for="entry in session.log"
					:key="entry.sequence"
					data-testid="repair-log-entry"
					:data-from="entry.from"
					:data-to="entry.to"
					:data-by="entry.by"
				>
					{{ tf('logEntry', { n: entry.sequence, from: entry.from, to: entry.to, ops: entry.operations, by: by(entry.by) }) }}
				</li>
			</ol>
		</section>

		<section
			v-if="valid"
			class="session-block"
			data-tutorial-target="repair-preview"
		>
			<p class="session-valid">
				{{ t('validNote') }}
			</p>
			<div class="session-actions">
				<button
					type="button"
					class="repair-button"
					:style="PRIMARY_BUTTON_STYLE"
					:data-testid="`repair-preview-${id}`"
					@click="host?.preview(id)"
				>
					{{ t('previewButton') }}
				</button>
				<button
					v-if="session.preview !== null"
					type="button"
					class="repair-button"
					:style="BUTTON_STYLE"
					:data-testid="`repair-preview-close-${id}`"
					@click="onClosePreview"
				>
					{{ t('closePreview') }}
				</button>
				<button
					type="button"
					class="repair-button"
					:style="BUTTON_STYLE"
					:data-testid="`repair-export-${id}`"
					@click="host?.exportJson(id)"
				>
					{{ t('exportButton') }}
				</button>
			</div>
			<div
				v-if="session.preview !== null"
				class="session-preview"
				:data-testid="`repair-board-${id}`"
			>
				<h5 class="session-block-title">
					{{ t('previewHeading') }}
				</h5>
				<BoardWidgetRenderer :runtime="session.preview" />
			</div>
			<div
				v-if="session.exported !== null"
				class="session-export"
			>
				<h5 class="session-block-title">
					{{ t('exportHeading') }}
				</h5>
				<pre
					class="session-json"
					tabindex="0"
					:data-testid="`repair-export-text-${id}`"
				>{{ session.exported }}</pre>
			</div>
		</section>
		<p
			v-else-if="!hasStep && !session.stale"
			class="session-note"
			:data-testid="`repair-no-preview-${id}`"
		>
			{{ t('noRuntimeNote') }}
		</p>
	</div>
</template>

<style scoped>
.session {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-top: 8px;
	border-top: 1px solid var(--repair-border);
}

.session-heading {
	margin: 0;
	font-size: 16px;
}

.session-facts {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 24px;
	margin: 0;
}

.session-fact {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.session-fact dt {
	font-size: 12px;
	color: var(--repair-text-muted);
}

.session-fact dd {
	margin: 0;
	font-family: var(--repair-font-mono);
	font-weight: 600;
}

.session-fact dd[data-state='valid'] {
	color: var(--repair-ok);
}

.session-fact dd[data-state='invalid'] {
	color: var(--repair-danger);
}

.session-stale {
	margin: 0;
	padding: 6px 10px;
	border: 1px solid var(--repair-warning);
	border-radius: var(--repair-radius);
}

.session-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.repair-button {
	min-height: 32px;
	padding: 4px 12px;
	border-radius: var(--repair-radius);
	background: var(--repair-surface-alt);
	box-sizing: border-box;
	cursor: pointer;
}

.repair-button:disabled {
	cursor: not-allowed;
	opacity: 0.55;
}

.repair-button:focus-visible {
	outline: 2px solid var(--repair-accent);
	outline-offset: 2px;
}

.session-block {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.session-block-title {
	margin: 0;
	font-size: 14px;
}

.session-note,
.session-valid,
.session-result,
.session-result-detail {
	margin: 0;
}

.session-note {
	font-size: 13px;
	color: var(--repair-text-muted);
}

.session-valid {
	color: var(--repair-ok);
}

.session-heading:focus-visible {
	outline: 2px solid var(--repair-accent);
	outline-offset: 2px;
}

.session-result {
	font-family: var(--repair-font-mono);
	font-size: 13px;
}

.session-result-detail {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 10px;
	font-size: 13px;
}

.session-result-detail code {
	font-family: var(--repair-font-mono);
	font-size: 12px;
	color: var(--repair-text-muted);
}

.session-log {
	margin: 0;
	padding-left: 20px;
	font-size: 13px;
}

.session-preview,
.session-export {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 10px;
	border: 1px solid var(--repair-border);
	border-radius: var(--repair-radius);
	background: var(--repair-bg);
}

.session-json {
	overflow-x: auto;
	max-height: 280px;
	margin: 0;
	padding: 8px;
	border-radius: var(--repair-radius);
	background: var(--repair-surface);
	font-family: var(--repair-font-mono);
	font-size: 12px;
}

.session-json:focus-visible {
	outline: 2px solid var(--repair-accent);
	outline-offset: 2px;
}
</style>
