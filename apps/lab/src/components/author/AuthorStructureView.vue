<script setup lang="ts">
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { ConfigPath, JsonSchema } from '../../lab/config-schema'
import type { AuthorUnsupportedReason, ConfigEdit } from '../../lab/types'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { editConfig } from '../../lab/author'
import { getShowcase } from '../../showcases/registry'
import BlueprintTree from '../blueprint/BlueprintTree.vue'
import ConfigFieldEditor from './ConfigFieldEditor.vue'

const store = useLabStore()
const i18n = useLabI18n()
const documentInspection = computed(() => inspectBlueprint(store.documentState.value.blueprint))
const selectedNodeId = computed<InspectionNodeId | null>(() => store.documentFocus.value?.nodeId ?? null)
const selectedNode = computed(() => selectedNodeId.value === null ? null : documentInspection.value.getNode(selectedNodeId.value))
const busy = ref(false)
/** An unapplied JSON draft exists: a Structure commit would be refused (`draft-dirty`), so the editor says so up front and sends nothing. */
const draftLocked = computed(() => store.isDirty.value)
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

watch([selectedNodeId, () => store.documentState.value.revision], () => {
	outcomeMessage.value = null
	outcomeRevision.value = null
})

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

async function onEdit(path: ConfigPath, edit: ConfigEdit): Promise<void> {
	// Synchronous, so a second trigger in the same task is dropped here without touching the message, the controls or `busy`
	// (the controls' own `busy` prop only updates with the next render).
	if (busy.value)
		return
	const nodeId = selectedNodeId.value
	if (nodeId === null || selectedNode.value?.resolved !== true)
		return
	busy.value = true
	outcomeMessage.value = null
	outcomeRevision.value = null
	let applied = false
	// Why the edit was not applied, for the control at its path: the reason alone, without the outcome line's own preamble.
	let refusal: string | null = null
	try {
		const outcome = await store.author(editConfig(store.documentState.value.revision, nodeId, path, edit))
		applied = outcome.status === 'applied'
		if (outcome.status === 'applied') {
			// Plain language: the revision is a developer detail (the header's details popover), kept here only as a
			// machine-readable attribute of the outcome line.
			outcomeMessage.value = i18n.t('Change applied. Use Undo to take it back.')
			outcomeRevision.value = store.documentState.value.revision
		}
		else if (outcome.status === 'draft-dirty') {
			outcomeMessage.value = i18n.t('Apply or Revert the JSON draft before using Structure commands.')
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
	}
	finally {
		busy.value = false
	}
	refusal ??= outcomeMessage.value
	if (!applied && edit.op === 'replace')
		resync.value = { path: path.join('.'), tick: ++resyncTick, ...(refusal === null ? {} : { message: refusal }) }
	await keepFocus(path, edit)
}
</script>

<template>
	<div class="grid h-full min-h-0 grid-cols-[220px_1px_1fr]">
		<BlueprintTree
			:inspection="documentInspection"
			:selectedNodeId="selectedNodeId"
			@select="selectNode"
		/>
		<div class="bg-(--lab-color-border)" />
		<div
			ref="editorEl"
			data-testid="structure-editor"
			tabindex="-1"
			class="min-w-0 overflow-auto p-2.5"
		>
			<!-- The JSON draft and Structure both edit the Document, and a Structure commit is refused while a draft exists
				(it would be lost). Say so before anything is clicked, and lock the controls. -->
			<div
				v-if="draftLocked"
				data-testid="structure-draft-notice"
				role="note"
				class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-(--lab-radius) border border-(--lab-color-warning) bg-(--lab-color-surface-alt) px-2 py-1.5 text-xs text-(--lab-color-text)"
			>
				<span class="min-w-0 flex-1">{{ i18n.t('The JSON view has unapplied changes. Apply or discard the JSON draft to edit here.') }}</span>
				<button
					type="button"
					data-testid="structure-open-json"
					class="min-h-6 cursor-pointer rounded-(--lab-radius) border border-default bg-default px-2 text-xs text-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
					@click="store.authorView.value = 'json'"
				>
					{{ i18n.t('Open the JSON view') }}
				</button>
			</div>
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
						<!-- Locked by a JSON draft: the controls stay focusable and readable (as while a command runs: `aria-disabled`)
							but send nothing, and look dimmed; the notice above says why. -->
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
								:busy="busy || draftLocked"
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
			<div
				v-else
				class="text-xs text-muted"
			>
				{{ i18n.t('Unresolved widgets are read-only in Structure.') }}
			</div>
		</div>
	</div>
</template>
