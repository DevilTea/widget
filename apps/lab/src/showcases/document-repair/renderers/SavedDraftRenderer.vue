<script setup lang="ts">
/**
 * Presentation only: one saved draft. Before it is opened it shows what the widget's own Properties say: `findings` (what
 * Core says about the stored document, compiled with the notice board system) and `plan` (the application's migration plan).
 * "Open in the app" asks the host for an editing session (`./repair-host.ts`); while one is open, `DraftSession.vue` shows it.
 *
 * Reads: Properties `title`, `savedWith`, `findings`, `plan`. Nothing is computed here, and the stored document is never changed.
 */
import { useWidget } from '@deviltea/widget-vue'
import { computed, inject, ref } from 'vue'
import { useInspectAnchor } from '../../../showcase-host'
import { formatPointer } from '../domain'
import { SavedDraftPlugin } from '../plugins/saved-draft'
import { BUTTON_STYLE, PRIMARY_BUTTON_STYLE } from './control-style'
import DiagnosticList from './DiagnosticList.vue'
import DraftSession from './DraftSession.vue'
import { focusWhenRendered } from './focus'
import PlanList from './PlanList.vue'
import { RepairHostKey } from './repair-host'
import { useRepairText } from './use-repair-text'

const { useProperties, widgetId, widgetType } = useWidget(SavedDraftPlugin)
const { title, savedWith, findings, plan } = useProperties()
const host = inject(RepairHostKey, null)
const { t, tf } = useRepairText()
const anchor = useInspectAnchor(widgetId, widgetType)

const root = ref<HTMLElement | null>(null)

/** The control of this draft with this test id. */
function control(testId: string): HTMLElement | null {
	return root.value?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null
}

/** "Open in the app" is replaced by "Close draft": the focus goes to the new session's heading. */
function onOpen(): void {
	host?.open(widgetId)
	void focusWhenRendered(() => control(`repair-session-heading-${widgetId}`))
}

/** "Close draft" is replaced by "Open in the app": the focus goes to that button. */
function onClose(): void {
	host?.close(widgetId)
	void focusWhenRendered(() => control(`repair-open-${widgetId}`))
}

const session = computed(() => host?.sessions.value.get(widgetId) ?? null)
const diagnosticCount = computed(() => findings.value?.diagnostics.length ?? 0)
const valid = computed(() => findings.value?.status === 'valid')
</script>

<template>
	<section
		ref="root"
		v-bind="anchor"
		:data-tutorial-target="`repair-${widgetId}`"
		class="draft"
		:data-testid="`repair-draft-${widgetId}`"
		:data-open="session !== null"
	>
		<header class="draft-header">
			<h3 class="draft-title">
				{{ title ?? widgetId }}
			</h3>
			<span class="draft-version">{{ tf('savedWith', { version: savedWith ?? '' }) }}</span>
			<span
				class="draft-state"
				:class="valid ? 'draft-state--valid' : 'draft-state--invalid'"
				:data-testid="`repair-stored-state-${widgetId}`"
				:data-state="valid ? 'valid' : 'invalid'"
			>{{ valid ? t('stateValid') : `${t('stateInvalid')}: ${tf('problemCount', { count: diagnosticCount })}` }}</span>
			<span class="draft-actions">
				<button
					v-if="session === null"
					type="button"
					class="repair-button"
					:style="PRIMARY_BUTTON_STYLE"
					:data-testid="`repair-open-${widgetId}`"
					@click="onOpen"
				>
					{{ t('openInApp') }}
				</button>
				<button
					v-else
					type="button"
					class="repair-button"
					:style="BUTTON_STYLE"
					:data-testid="`repair-close-${widgetId}`"
					@click="onClose"
				>
					{{ t('closeDraft') }}
				</button>
			</span>
		</header>

		<DraftSession
			v-if="session !== null"
			:session="session"
		/>

		<details
			v-else
			class="draft-stored"
			:data-testid="`repair-stored-details-${widgetId}`"
		>
			<summary>{{ t('storedHeading') }}</summary>
			<p class="draft-note">
				{{ t('storedNote') }}
			</p>
			<template v-if="findings !== null">
				<p class="draft-note">
					{{ findings.sourceJsonCompatible ? t('jsonCompatible') : t('notJsonCompatible') }}
				</p>
				<h4 class="draft-block-title">
					{{ t('diagnosticsHeading') }}
				</h4>
				<DiagnosticList :diagnostics="findings.diagnostics" />
				<h4 class="draft-block-title">
					{{ t('nodesHeading') }}
				</h4>
				<ul
					class="draft-nodes"
					:data-testid="`repair-nodes-${widgetId}`"
				>
					<li
						v-for="(node, index) in findings.nodes"
						:key="index"
						class="draft-node"
						data-testid="repair-node"
						:data-resolved="node.resolved"
					>
						<code class="draft-node-path">{{ formatPointer(node.sourcePath) }}</code>
						<span :class="node.resolved ? 'draft-node-resolved' : 'draft-node-unresolved'">{{ node.resolved ? t('nodeResolved') : t('nodeUnresolved') }}</span>
						<span class="draft-node-hints">{{ node.id === null && node.type === null ? t('nodeNoHints') : tf('nodeHints', { id: node.id ?? '-', type: node.type ?? '-' }) }}</span>
						<code
							v-for="slot in node.slots"
							:key="slot.name"
							class="draft-node-slot"
							:data-placement="slot.placement"
						>{{ tf(slot.placement === 'raw-slot' ? 'slotRaw' : 'slotPlaced', { name: slot.name, count: slot.children }) }}</code>
					</li>
				</ul>
			</template>
			<h4 class="draft-block-title">
				{{ t('planHeading') }}
			</h4>
			<PlanList
				:steps="plan ?? []"
				:testId="`repair-stored-plan-${widgetId}`"
			/>
		</details>
	</section>
</template>

<style scoped>
.draft {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 14px 16px;
	border: 1px solid var(--repair-border);
	border-radius: var(--repair-radius);
	background: var(--repair-surface);
}

.draft-header {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 6px 12px;
}

.draft-title {
	margin: 0;
	font-size: 18px;
}

.draft-version {
	font-size: 13px;
	color: var(--repair-text-muted);
}

.draft-state {
	font-size: 13px;
	font-weight: 600;
}

.draft-state--valid {
	color: var(--repair-ok);
}

.draft-state--invalid {
	color: var(--repair-danger);
}

.draft-actions {
	margin-left: auto;
}

.repair-button {
	min-height: 32px;
	padding: 4px 12px;
	border-radius: var(--repair-radius);
	background: var(--repair-surface-alt);
	box-sizing: border-box;
	cursor: pointer;
}

.repair-button:focus-visible {
	outline: 2px solid var(--repair-accent);
	outline-offset: 2px;
}

.draft-stored summary {
	min-height: 24px;
	cursor: pointer;
	font-size: 14px;
}

.draft-stored summary:focus-visible {
	outline: 2px solid var(--repair-accent);
	outline-offset: 2px;
}

.draft-note {
	margin: 6px 0;
	font-size: 13px;
	color: var(--repair-text-muted);
}

.draft-block-title {
	margin: 10px 0 6px;
	font-size: 14px;
}

.draft-nodes {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.draft-node {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 2px 10px;
	font-size: 13px;
}

.draft-node-path,
.draft-node-slot {
	font-family: var(--repair-font-mono);
	font-size: 12px;
}

.draft-node-slot {
	color: var(--repair-text-muted);
}

.draft-node-slot[data-placement='raw-slot'] {
	color: var(--repair-warning);
}

.draft-node-resolved {
	color: var(--repair-ok);
}

.draft-node-unresolved {
	color: var(--repair-danger);
}

.draft-node-hints {
	color: var(--repair-text-muted);
}
</style>
