<script setup lang="ts">
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { ConfigPath, JsonSchema } from '../../lab/config-schema'
import type { LabProblem } from '../../lab/problems'
import type { AuthorUnsupportedReason, ConfigEdit } from '../../lab/types'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { editConfig } from '../../lab/author'
import { placeStructureProblems } from '../../lab/problems'
import { getShowcase } from '../../showcases/registry'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import ConfigFieldEditor from './ConfigFieldEditor.vue'

const store = useLabStore()
const i18n = useLabI18n()
const documentInspection = computed(() => inspectBlueprint(store.documentState.value.blueprint))
const selectedNodeId = computed<InspectionNodeId | null>(() => store.documentFocus.value?.nodeId ?? null)
const selectedNode = computed(() => selectedNodeId.value === null ? null : documentInspection.value.getNode(selectedNodeId.value))
/** A Structure edit is being committed or waits for one (`onEdit()` runs them one at a time). */
const busy = ref(false)
/**
 * The JSON view's text does not parse (Lab UX phase 3: the only "draft"): a Structure commit would be refused (`draft-dirty`),
 * since it would replace that text, so the editor says so up front and sends nothing until the JSON parses or is discarded.
 */
const draftLocked = computed(() => store.hasJsonSyntaxError.value)
const outcomeMessage = ref<string | null>(null)
/** The Document revision a successful command produced (`data-revision` of the outcome line, for specs). */
const outcomeRevision = ref<number | null>(null)
const editorEl = useTemplateRef<HTMLElement>('editorEl')
/** Set when a commit did not go through: the control at that path shows what the Document holds again (a switch or list the user already moved would not), the others keep their uncommitted text. */
const resync = ref<{ readonly path: string, readonly tick: number, readonly message?: string } | null>(null)
let resyncTick = 0

/**
 * The selected widget's config: `null` when its plugin has no config capability, else the config JSON Schema the showcase
 * hands to the Lab for that plugin (`schema: null` without one; Core 0.3 publishes no config schema).
 */
const catalogConfig = computed(() => {
	const node = selectedNode.value
	if (node === null || !node.resolved)
		return undefined
	const entry = store.session.system.catalog.widgets.find(widget => widget.type === node.node.type)
	if (entry === undefined)
		return undefined
	if (!entry.capabilities.config)
		return null
	const schemas = getShowcase(store.showcaseId.value)?.configSchemas ?? {}
	return { schema: Object.hasOwn(schemas, entry.type) ? schemas[entry.type]! as JsonSchema : null }
})
const configSchema = computed(() => catalogConfig.value?.schema ?? null)

/** The widget's authored config (an empty object when it was written without one, or as `null`). */
const configValue = computed<unknown>(() => {
	const node = selectedNode.value
	if (node === null || !node.resolved)
		return {}
	const source = node.node.source as { readonly config?: unknown } | null
	return source?.config ?? {}
})
/** A config that is not an object (a string, a list, a number) has no keys to edit: it is edited whole, as JSON. */
const configAsJson = computed(() => typeof configValue.value !== 'object' || Array.isArray(configValue.value))

/**
 * Problems in Structure (Lab UX phase 2, report item 12): the committed Document's problems, exactly the list the JSON view shows
 * (`LabStore.problems`), placed by location. The selected widget's config problems go to their fields, its other problems to its
 * header (also its config problems when it has no config editor here), and the rest to a compact list with a way to each widget.
 */
const placement = computed(() => placeStructureProblems(store.problems.value, selectedNodeId.value))
const hasFieldEditor = computed(() => selectedNode.value?.resolved === true && catalogConfig.value !== null && catalogConfig.value !== undefined)
const fieldProblems = computed(() => hasFieldEditor.value ? placement.value.atFields : [])
const nodeProblems = computed(() => hasFieldEditor.value ? placement.value.atNode : [...placement.value.atFields, ...placement.value.atNode].sort((a, b) => store.problems.value.indexOf(a) - store.problems.value.indexOf(b)))
const problemsList = useTemplateRef<HTMLElement>('problemsList')

/**
 * Shows one problem where Structure shows it: selects its widget, then puts keyboard focus on its field's control (or the
 * field's problem text for an object or list), its widget header's problems, or, for a problem with no widget, its row in
 * the list.
 */
async function revealProblem(problem: LabProblem | undefined): Promise<void> {
	if (problem?.nodeId !== null && problem?.nodeId !== undefined)
		store.setFocus('document', { nodeId: problem.nodeId })
	// Dockview may still be activating the Author tab, and the selected widget's fields render on the next tick.
	await nextTick()
	await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
	const root = editorEl.value
	if (root === null)
		return
	const host = problem === undefined ? null : root.querySelector<HTMLElement>(`[data-problem-keys~="${CSS.escape(problem.key)}"]`)
	let target: HTMLElement | null = null
	if (host !== null) {
		target = host.hasAttribute('tabindex')
			? host
			: host.closest<HTMLElement>('[data-config-path]')
				?.querySelector<HTMLElement>('button[role="switch"], select, textarea, input') ?? host
	}
	target ??= problemsList.value?.querySelector<HTMLElement>('[data-testid="structure-problem-row"]') ?? problemsList.value ?? null
	target?.focus()
	target?.scrollIntoView({ block: 'nearest' })
}

// "Show problems" (the header's problems button, the stale-preview notice) stays in Structure and asks for the first problem.
async function focusProblemsIfRequested(): Promise<void> {
	if (!store.problemsFocusPending.value)
		return
	store.problemsFocusPending.value = false
	await revealProblem(store.problems.value[0])
}
watch(store.problemsFocusPending, focusProblemsIfRequested)
onMounted(focusProblemsIfRequested)

watch([selectedNodeId, () => store.documentState.value.revision], () => {
	outcomeMessage.value = null
	outcomeRevision.value = null
})

/**
 * The notice's button switches Author to JSON. This view (and the button with it) is unmounted by that, which would leave
 * keyboard focus on the page: it goes to the JSON tab of the Author views instead, once the switch has rendered.
 */
async function openJsonView(): Promise<void> {
	store.authorView.value = 'json'
	await nextTick()
	document.querySelector<HTMLElement>('[data-testid="author-view-json"]')
		?.focus()
}

function selectNode(nodeId: InspectionNodeId): void {
	store.setFocus('document', { nodeId })
}

function unsupportedMessage(reason: AuthorUnsupportedReason): string {
	switch (reason) {
		case 'config-path-exists': return i18n.t('That field already exists.')
		case 'invalid-value': return i18n.t('That value cannot be stored in the source, because it is not JSON.')
		case 'config-not-found': return i18n.t('This widget has no config yet: add a field to create it.')
		default: return i18n.t('This selected value is no longer available in the current Document.')
	}
}

/** The first control of the field at `path` (or of the group it is), if it is in the page. Compared by attribute, not through a selector, so no path can break the lookup. */
function controlAt(path: ConfigPath): HTMLElement | null {
	const wanted = path.join('.')
	const field = [...editorEl.value?.querySelectorAll<HTMLElement>('[data-config-path]') ?? []].find(element => element.dataset.configPath === wanted)
	return field?.querySelector<HTMLElement>('button[role="switch"], select, textarea, input, button') ?? null
}

/**
 * Keyboard focus after a command. The controls are never disabled, so an edit that replaced a value leaves focus where it
 * was; what is left to do is to follow focus that lost its element: a new field or item takes it, a removed one hands it to
 * the field that took its place, else to its list or object. Focus is only ever moved when it is on nothing (the body, after its
 * control was re-created) or still inside the editor: if the user went elsewhere while the command ran (another header control,
 * the JSON editor), it stays there, so typing and Space go where they were sent.
 */
async function keepFocus(path: ConfigPath, edit: ConfigEdit): Promise<void> {
	await nextTick()
	const root = editorEl.value
	if (root === null)
		return
	const active = document.activeElement
	const lost = active === null || active === document.body
	const inside = !lost && root.contains(active)
	if (!lost && !inside)
		return
	// Focus that is still inside the editor stays (a replaced value, or the button of a removed item, which the next item now holds).
	if (inside && edit.op !== 'add')
		return
	const target = (edit.op === 'remove' ? controlAt(path) ?? controlAt(path.slice(0, -1)) : controlAt(path)) ?? (lost ? root : null)
	target?.focus()
}

/** The selected widget as a stable identity: its inspection node id changes with every revision, its id and type do not. */
function widgetKey(): string | null {
	const node = selectedNode.value
	return node === null || !node.resolved ? null : `${node.node.id}\u0000${node.node.type}`
}

interface QueuedEdit {
	readonly path: ConfigPath
	readonly edit: ConfigEdit
	readonly widget: string
	readonly signature: string
}

/**
 * Edits run one at a time, in the order they were made (Lab UX phase 3). With commits on blur, the edit that a click or Tab
 * causes routinely arrives while the previous field's blur commit is still promoting the Preview: it waits for it instead of
 * being dropped. The same edit reported twice while it waits or runs (a control that reports one click twice in a task) is
 * dropped, so it never commits twice. A waiting edit whose widget is no longer selected is dropped too: its path belongs to
 * that widget.
 */
const editQueue: QueuedEdit[] = []
let runningSignature: string | null = null

function onEdit(path: ConfigPath, edit: ConfigEdit): void {
	// No check of the JSON lock here: the locked controls report nothing once rendered, and an edit sent in the same task as the
	// JSON stopped parsing reaches the session, which refuses it (`draft-dirty`) and the field says so.
	const widget = widgetKey()
	if (widget === null)
		return
	const signature = JSON.stringify([widget, path, edit])
	if (runningSignature === signature || editQueue.some(queued => queued.signature === signature))
		return
	editQueue.push({ path, edit, widget, signature })
	if (!busy.value)
		void runQueuedEdits()
}

async function runQueuedEdits(): Promise<void> {
	busy.value = true
	try {
		for (let next = editQueue.shift(); next !== undefined; next = editQueue.shift()) {
			if (next.widget !== widgetKey())
				continue
			runningSignature = next.signature
			try {
				await runEdit(next.path, next.edit)
			}
			finally {
				runningSignature = null
			}
		}
	}
	finally {
		busy.value = false
	}
}

async function runEdit(path: ConfigPath, edit: ConfigEdit): Promise<void> {
	const nodeId = selectedNodeId.value
	if (nodeId === null || selectedNode.value?.resolved !== true)
		return
	outcomeMessage.value = null
	outcomeRevision.value = null
	// Why the edit was not applied, for the control at its path: the reason alone, without the outcome line's own preamble.
	let refusal: string | null = null
	const outcome = await store.author(editConfig(store.documentState.value.revision, nodeId, path, edit))
	const applied = outcome.status === 'applied'
	if (outcome.status === 'applied') {
		// Plain language: the revision is a developer detail (the header's details popover), kept here only as a
		// machine-readable attribute of the outcome line.
		outcomeMessage.value = i18n.t('Change applied. Use Undo to take it back.')
		outcomeRevision.value = store.documentState.value.revision
	}
	else if (outcome.status === 'draft-dirty') {
		outcomeMessage.value = i18n.t('The JSON view has changes that are not in the document yet. Fix or discard them, then try again.')
	}
	else if (outcome.status === 'patch-error') {
		outcomeMessage.value = i18n.t('The author command could not be applied: {message}', { message: outcome.failure.message })
		refusal = outcome.failure.message
	}
	else if (outcome.status === 'unsupported') {
		outcomeMessage.value = unsupportedMessage(outcome.reason)
	}
	else {
		outcomeMessage.value = i18n.t('The author command is unavailable while another lifecycle command is running.')
	}
	refusal ??= outcomeMessage.value
	if (!applied && edit.op === 'replace')
		resync.value = { path: path.join('.'), tick: ++resyncTick, ...(refusal === null ? {} : { message: refusal }) }
	await keepFocus(path, edit)
}
</script>

<template>
	<!-- The tree takes about a third of the view, between 9rem and 220px, so the editor keeps room when the panel is narrow
		(the tutorial rail open at 1280px, report item 15). -->
	<div class="grid h-full min-h-0 grid-cols-[clamp(9rem,32%,220px)_1px_minmax(0,1fr)]">
		<BlueprintTree
			:inspection="documentInspection"
			:selectedNodeId="selectedNodeId"
			@select="selectNode"
		/>
		<div class="bg-(--lab-color-border)" />
		<div
			ref="editorEl"
			data-testid="structure-editor"
			data-tutorial-target="author-structure"
			tabindex="-1"
			class="min-w-0 overflow-auto p-2.5"
		>
			<!-- JSON text that does not parse was never committed, and a Structure commit would replace it (`draft-dirty`). Say so
				before anything is clicked, and lock the controls until the JSON parses or is discarded (Lab UX phase 3). -->
			<div
				v-if="draftLocked"
				data-testid="structure-draft-notice"
				role="note"
				class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-(--lab-radius) border border-(--lab-color-warning) bg-(--lab-color-surface-alt) px-2 py-1.5 text-xs text-(--lab-color-text)"
			>
				<span class="min-w-0 flex-1">{{ i18n.t('The JSON has a syntax error, so nothing from it is applied. Fix it in the JSON view, or use Discard JSON changes, to edit here.') }}</span>
				<button
					type="button"
					data-testid="structure-open-json"
					class="min-h-6 cursor-pointer rounded-(--lab-radius) border border-default bg-default px-2 text-xs text-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
					@click="openJsonView"
				>
					{{ i18n.t('Open the JSON view') }}
				</button>
			</div>
			<!-- Problems not shown at the selected widget: other widgets' (a row selects that widget and shows the problem there)
				and those with no widget (a JSON syntax error, a source-level diagnostic). Code and message are Core's, verbatim. -->
			<section
				v-if="placement.elsewhere.length > 0"
				ref="problemsList"
				data-testid="structure-problems"
				:data-problem-count="placement.elsewhere.length"
				tabindex="-1"
				:aria-label="i18n.t('Problems elsewhere in the document')"
				class="mb-3 rounded-(--lab-radius) border border-default bg-muted px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				<h4 class="m-0 mb-1 text-xs font-semibold text-error">
					{{ i18n.t(placement.elsewhere.length === 1 ? '{count} problem elsewhere in the document' : '{count} problems elsewhere in the document', { count: placement.elsewhere.length }) }}
				</h4>
				<ul class="m-0 flex max-h-32 list-none flex-col gap-1 overflow-y-auto p-0">
					<li
						v-for="problem in placement.elsewhere"
						:key="problem.key"
					>
						<button
							v-if="problem.nodeId !== null"
							type="button"
							data-testid="structure-problem-row"
							:data-problem-code="problem.code ?? 'syntax-error'"
							class="flex min-h-6 w-full cursor-pointer items-start gap-2 rounded-(--lab-radius) border border-default bg-default px-2 py-1 text-left text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
							:title="i18n.t('Select this widget')"
							@click="revealProblem(problem)"
						>
							<span class="shrink-0 rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted">{{ problem.code }}</span>
							<span class="min-w-0 flex-1">
								<span class="block wrap-anywhere">{{ problem.message }}</span>
								<span class="block wrap-anywhere font-mono text-[11px] text-muted">{{ problem.locationLabel }}</span>
							</span>
						</button>
						<div
							v-else
							data-testid="structure-problem-row"
							:data-problem-code="problem.code ?? 'syntax-error'"
							tabindex="-1"
							class="flex items-start gap-2 rounded-(--lab-radius) border border-default bg-default px-2 py-1 text-default outline-none focus-visible:ring-2 focus-visible:ring-primary"
						>
							<span class="shrink-0 rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted">{{ problem.code ?? i18n.t('JSON syntax') }}</span>
							<span class="min-w-0 flex-1 wrap-anywhere">{{ problem.kind === 'syntax' ? `SyntaxError: ${problem.message}` : problem.message }}</span>
						</div>
					</li>
				</ul>
			</section>
			<div
				v-if="selectedNode === null"
				class="text-xs text-muted"
			>
				{{ i18n.t('Select an authored widget to edit its config.') }}
			</div>
			<template v-else-if="selectedNode.resolved">
				<h3 class="m-0 mb-1 font-mono text-[13px] font-semibold">
					{{ selectedNode.node.id }} : {{ selectedNode.node.type }}
				</h3>
				<ul
					v-if="nodeProblems.length > 0"
					data-testid="node-problems"
					:data-problem-keys="nodeProblems.map(problem => problem.key).join(' ')"
					tabindex="-1"
					:aria-label="i18n.t('Problems of this widget')"
					class="m-0 mb-2 flex list-none flex-col gap-0.5 p-0 text-xs text-error outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<li
						v-for="problem in nodeProblems"
						:key="problem.key"
						data-testid="node-problem"
						:data-problem-code="problem.code ?? 'syntax-error'"
						class="wrap-anywhere"
					>
						<span class="font-mono">{{ problem.code }}</span>: {{ problem.message }}
						<span
							v-if="problem.locationLabel !== null"
							class="block font-mono text-[11px] text-muted"
						>{{ problem.locationLabel }}</span>
					</li>
				</ul>
				<p class="m-0 mb-3 text-xs text-muted">
					{{ i18n.t('Current committed Document structure') }} · {{ i18n.t('Document r{revision}', { revision: store.documentState.value.revision }) }}
				</p>
				<section :aria-label="i18n.t('Config')">
					<h4 class="m-0 mb-1.5 text-xs font-semibold text-muted uppercase">
						{{ i18n.t('Config') }}
					</h4>
					<p
						v-if="catalogConfig === null"
						class="m-0 text-xs text-muted"
					>
						{{ i18n.t('This widget has no config.') }}
					</p>
					<template v-else>
						<p class="m-0 mb-2 text-xs text-muted">
							{{ i18n.t(configSchema === null ? 'This plugin publishes no config schema, so values are typed by what they hold and nothing can be added or removed here. Use JSON for that.' : 'Each change is applied to the Document at once and restarts the preview (its answers start over). Use Undo to take a change back.') }}
						</p>
						<!-- Locked while the JSON text does not parse: the controls stay focusable and readable (`aria-disabled`) but send
							nothing, and look dimmed; the notice above says why. While a commit runs they stay live: edits wait their turn. -->
						<div
							data-testid="structure-fields"
							:data-locked="draftLocked ? 'true' : 'false'"
							:class="draftLocked ? 'opacity-60' : undefined"
						>
							<ConfigFieldEditor
								:key="selectedNodeId ?? 'none'"
								bare
								:resync="resync"
								:asJson="configAsJson"
								:root="configSchema"
								:schema="configSchema"
								:value="configValue"
								:path="[]"
								label="config"
								:busy="draftLocked"
								:locked="draftLocked"
								:problems="fieldProblems"
								@edit="onEdit"
							/>
						</div>
					</template>
				</section>
				<p
					v-if="outcomeMessage !== null"
					data-testid="author-command-outcome"
					:data-revision="outcomeRevision ?? undefined"
					role="status"
					class="m-0 mt-3 text-xs text-muted"
				>
					{{ outcomeMessage }}
				</p>
			</template>
			<template v-else>
				<ul
					v-if="nodeProblems.length > 0"
					data-testid="node-problems"
					:data-problem-keys="nodeProblems.map(problem => problem.key).join(' ')"
					tabindex="-1"
					:aria-label="i18n.t('Problems of this widget')"
					class="m-0 mb-2 flex list-none flex-col gap-0.5 p-0 text-xs text-error outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<li
						v-for="problem in nodeProblems"
						:key="problem.key"
						data-testid="node-problem"
						:data-problem-code="problem.code ?? 'syntax-error'"
						class="wrap-anywhere"
					>
						<span class="font-mono">{{ problem.code }}</span>: {{ problem.message }}
					</li>
				</ul>
				<div class="text-xs text-muted">
					{{ i18n.t('Unresolved widgets are read-only in Structure.') }}
				</div>
			</template>
		</div>
	</div>
</template>
