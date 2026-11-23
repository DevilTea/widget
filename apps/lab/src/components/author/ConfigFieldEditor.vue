<script setup lang="ts">
/**
 * One value of a widget's authored config in the Structure editor (audit U15), and, for an object or an array, the
 * values inside it, recursively. The control follows what the plugin's config JSON Schema (or, without one, the
 * value itself) says it is: a switch for a boolean, a number box that knows `integer` and `minimum`/`maximum`, a
 * list for an enum, a text box for a string, a list with Add and Remove for an array and an object with its optional
 * keys. A shape this editor does not read (an unmatched union) is edited as its JSON text.
 *
 * It only reports what the user asked for (`edit`, with the config-relative path); `AuthorStructureView.vue` turns
 * that into a command that goes through the Document, so nothing here writes source or validates semantics. Switches
 * and lists apply at once; text and number boxes apply on Enter or when they lose focus (Lab UX phase 3: there is no
 * "Set value" button), and Esc puts the Document's value back, so half-typed text is never committed by accident. A JSON
 * box applies on Cmd/Ctrl+Enter (Enter is a new line there) or on blur.
 */
import type { ConfigPath, JsonSchema } from '../../lab/config-schema'
import type { LabProblem } from '../../lab/problems'
import type { ConfigEdit } from '../../lab/types'
import UButton from '@nuxt/ui/components/Button.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { canAddItem, canRemoveItem, canRemoveKey, defaultValueFor, describeField, objectFieldKeys, parseNumberText } from '../../lab/config-schema'
import { claimsFieldProblem, uniqueProblemTexts } from '../../lab/problems'

const props = defineProps<{
	root: JsonSchema | null
	schema: JsonSchema | null
	value: unknown
	/** Path of this value inside the widget's config; `[]` for the config itself. */
	path: ConfigPath
	label: string
	/** The editor for the config itself: no frame or heading of its own. */
	bare?: boolean
	/** May be removed from its parent (an optional object key, or an array item above the minimum). */
	removable?: boolean
	/** Nothing may be sent (the controls stay focusable, carry `aria-disabled` and report no edit). */
	busy: boolean
	/**
	 * Locked while the JSON text does not parse (`busy` is set too, so nothing is sent): the text, number and JSON boxes are
	 * `readonly`, so they stay focusable and readable but take no typing, and when the lock lifts they show the Document's value
	 * again.
	 */
	locked?: boolean
	/** Edit the value as its JSON text whatever it is (the config of a widget whose config is not an object). */
	asJson?: boolean
	/**
	 * A commit at this path (config-relative, joined with `.`) was not applied, with why (`message`). A text, number or JSON box
	 * keeps what was typed and says it was not applied; a switch or a list shows the Document's value again. `tick` makes a
	 * repeat count.
	 */
	resync?: { readonly path: string, readonly tick: number, readonly message?: string } | null
	/**
	 * The selected widget's problems inside its config (Lab UX phase 2): each field shows the ones it claims
	 * (`claimsFieldProblem()`), with Core's code and message, verbatim, under the control, which then is `aria-invalid` and
	 * described by them. Passed down unchanged; every level picks its own.
	 */
	problems?: readonly LabProblem[]
}>()

const emit = defineEmits<{
	edit: [path: ConfigPath, edit: ConfigEdit]
}>()

const i18n = useLabI18n()
const id = useId()

const model = computed(() => props.asJson === true
	? { field: { kind: 'json' as const }, description: null, schema: null, viaUnion: false }
	: describeField(props.root, props.schema, props.value))
const field = computed(() => model.value.field)
const description = computed(() => model.value.description ?? undefined)

function toText(value: unknown): string {
	// A JSON box shows JSON, a string too (`"x"`), so what is typed back is the JSON of the value it replaces.
	if (field.value.kind !== 'json' && typeof value === 'string')
		return value
	if (field.value.kind !== 'json' && typeof value === 'number')
		return String(value)
	return JSON.stringify(value, null, 2) ?? ''
}

/** What is typed into a text, number or JSON box; follows the Document when the value changes under it. */
const text = ref(toText(props.value))
const invalid = ref(false)
/** Why the text in the box was not applied, while it is still there; `null` when nothing was refused. */
const notApplied = ref<string | null>(null)
/** The text that was refused, while the note about it is shown: leaving the box with that same text does not send it again. */
let refusedText: string | null = null
watch(() => props.value, (value, previous) => {
	// A JSON box compares by content: an equal value that is a new object (the same config re-read) changes nothing typed.
	if (field.value.kind === 'json' && JSON.stringify(value) === JSON.stringify(previous))
		return
	text.value = toText(value)
	invalid.value = false
	notApplied.value = null
})
// Typed back to what the Document holds: nothing is pending any more.
watch(text, (value) => {
	if (notApplied.value !== null && value === toText(props.value))
		notApplied.value = null
})

/**
 * A commit at this field's path was refused (a dirty JSON draft, a patch error, a stale selection). A text, number or JSON
 * box keeps the rejected input, so nothing typed is lost, and says it was not applied, with a way back to the Document's
 * value. A switch or a list, which the user only moved, is re-created (`controlKey`) so it shows what the Document holds.
 * Other fields are untouched either way.
 */
const controlKey = ref(0)
watch(() => props.resync, (resync) => {
	if (resync === null || resync === undefined || resync.path !== props.path.join('.'))
		return
	const kind = field.value.kind
	if (kind === 'string' || kind === 'number' || kind === 'json') {
		notApplied.value = resync.message ?? i18n.t('The change was not applied.')
		refusedText = text.value
		return
	}
	controlKey.value++
})

// The lock lifted (the draft was applied or discarded): no text typed before it is left in a box as if it were the Document's.
// Only on lifting: a refusal that arrives while the lock is coming on must keep its rejected text and note.
watch(() => props.locked === true, (locked, wasLocked) => {
	if (locked || !wasLocked)
		return
	text.value = toText(props.value)
	invalid.value = false
	notApplied.value = null
})

async function useDocumentValue(): Promise<void> {
	text.value = toText(props.value)
	invalid.value = false
	notApplied.value = null
	// The button goes away with the note: keyboard focus goes back to the box instead of the page.
	await nextTick()
	document.getElementById(`${id}-control`)
		?.focus()
}

/**
 * While a command runs the controls stay in the page and stay focusable (a disabled control would hand keyboard focus to
 * the body at every commit); they only stop reporting edits.
 */
function emitEdit(path: ConfigPath, edit: ConfigEdit): boolean {
	if (props.busy)
		return false
	emit('edit', path, edit)
	return true
}

function commitText(): void {
	const current = field.value
	if (current.kind === 'string') {
		if (text.value !== props.value)
			emitEdit(props.path, { op: 'replace', value: text.value })
		return
	}
	if (current.kind === 'number') {
		const parsed = parseNumberText(text.value)
		invalid.value = parsed === null
		if (parsed !== null && parsed !== props.value)
			emitEdit(props.path, { op: 'replace', value: parsed })
		return
	}
	try {
		const parsed = JSON.parse(text.value) as never
		invalid.value = false
		emitEdit(props.path, { op: 'replace', value: parsed })
	}
	catch {
		invalid.value = true
	}
}

const fieldEl = useTemplateRef<HTMLElement>('fieldEl')

/**
 * Leaving a box commits what was typed (Lab UX phase 3). Only text the user changed is sent, so tabbing through the boxes
 * commits nothing, and text that was just refused (its "Not applied" note is shown) is not sent again by leaving: that is what
 * makes "Use the Document value" safe even where clicking a button does not focus it (macOS Safari and Firefox leave
 * `relatedTarget` empty). Moving to that button is not leaving either. (The Remove button is leaving: the value is committed,
 * then removed, both in order; skipping the commit there would leave the text unsent once focus moves on from the button.)
 */
function onBlur(event: FocusEvent): void {
	if (props.locked === true || text.value === toText(props.value))
		return
	if (notApplied.value !== null && text.value === refusedText)
		return
	const next = event.relatedTarget
	if (next instanceof Element && fieldEl.value?.contains(next) === true && next.closest('[data-use-document-value]') !== null)
		return
	commitText()
}

/** Esc puts the Document's value back in the box (and clears a refusal note); with nothing to undo it does nothing, so Esc keeps its other meanings. */
function onEscape(event: KeyboardEvent): void {
	if (text.value === toText(props.value) && notApplied.value === null && !invalid.value)
		return
	event.preventDefault()
	event.stopPropagation()
	text.value = toText(props.value)
	invalid.value = false
	notApplied.value = null
}

function onChoice(event: Event): void {
	const select = event.target as HTMLSelectElement
	const current = field.value
	if (current.kind !== 'enum')
		return
	const option = current.options[Number(select.value)]
	// Controlled: the list shows the Document's value again at once, and the new one when the commit has applied. A
	// commit that is refused (a dirty JSON draft, a patch error) therefore leaves it showing what the Document holds.
	select.value = String(current.options.indexOf(props.value as never))
	if (option !== undefined && option !== props.value)
		emitEdit(props.path, { op: 'replace', value: option })
}

const objectValue = computed(() => (typeof props.value === 'object' && props.value !== null && !Array.isArray(props.value) ? props.value as Record<string, unknown> : {}))
const arrayValue = computed(() => Array.isArray(props.value) ? props.value as unknown[] : [])

const keys = computed(() => field.value.kind === 'object' ? objectFieldKeys(field.value, objectValue.value) : { present: [], addable: [] })

/** The problems this field shows: its own, and those under it that no field below shows. */
const ownProblems = computed(() => {
	const all = props.problems ?? []
	if (all.length === 0)
		return []
	const kind = field.value.kind
	const childKeys = kind === 'object' ? keys.value.present : kind === 'array' ? arrayValue.value.map((_, index) => index) : null
	return all.filter(problem => claimsFieldProblem(props.path, childKeys, problem))
})
/**
 * The lines the field lists: its problems with each code and message once. Two diagnostics of one widget about the same broken
 * reference (one per member that reads it) are one line; `data-problem-keys` still names both, so "Show problems" finds the field
 * from either.
 */
const shownProblems = computed(() => uniqueProblemTexts(ownProblems.value))
const problemsId = computed(() => ownProblems.value.length > 0 ? `${id}-problems` : undefined)
/** The control's description: the field's problems and a "not applied" note, whichever are shown. */
const describedBy = computed(() => [problemsId.value, notApplied.value !== null ? `${id}-not-applied` : undefined].filter(Boolean)
	.join(' ') || undefined)
const newField = ref('')
const newKey = ref('')

function childSchema(key: string): JsonSchema | null {
	const current = field.value
	if (current.kind !== 'object')
		return null
	return current.properties[key] ?? current.additional
}

function addField(): void {
	const current = field.value
	if (current.kind !== 'object' || newField.value === '')
		return
	emitEdit([...props.path, newField.value], { op: 'add', value: defaultValueFor(props.root, current.properties[newField.value] ?? null) as never })
}

function addKey(): void {
	const current = field.value
	const key = newKey.value.trim()
	if (current.kind !== 'object' || current.additional === null || key === '' || Object.hasOwn(objectValue.value, key))
		return
	emitEdit([...props.path, key], { op: 'add', value: defaultValueFor(props.root, current.additional) as never })
}

// The add controls are cleared only once the Document holds what they added: a refused add keeps the choice or the typed key.
watch(objectValue, (value) => {
	if (newField.value !== '' && Object.hasOwn(value, newField.value))
		newField.value = ''
	if (newKey.value.trim() !== '' && Object.hasOwn(value, newKey.value.trim()))
		newKey.value = ''
})

function addItem(): void {
	const current = field.value
	if (current.kind !== 'array')
		return
	emitEdit([...props.path, arrayValue.value.length], { op: 'add', value: defaultValueFor(props.root, current.items) as never })
}

const controlClass = 'h-7 min-w-0 rounded-(--lab-radius) border border-default bg-default px-2 font-mono text-xs text-default focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary aria-disabled:opacity-60 aria-invalid:border-error'
</script>

<template>
	<div
		:data-config-path="path.join('.')"
		:data-config-kind="field.kind"
		:data-has-problems="ownProblems.length > 0 ? 'true' : undefined"
		class="@container min-w-0"
	>
		<!-- Leaf: switch, list, number, text or JSON. Narrow (the tutorial rail open at 1280px, report item 15): below 20rem of
			its own width the label goes on its own line above the control, and the box keeps at least 120px, so nothing is
			squeezed or covered. -->
		<div
			v-if="field.kind !== 'object' && field.kind !== 'array'"
			ref="fieldEl"
			class="mb-1.5 flex min-w-0 flex-wrap items-start gap-1.5"
		>
			<label
				:for="`${id}-control`"
				:title="description"
				class="w-28 shrink-0 break-words pt-1 font-mono text-xs @max-xs:w-full @max-xs:pt-0"
			>{{ label }}</label>
			<div class="flex min-w-30 flex-1 flex-col gap-1">
				<div
					v-if="field.kind === 'boolean'"
					class="flex items-center gap-2"
				>
					<USwitch
						:id="`${id}-control`"
						:key="controlKey"
						:modelValue="value === true"
						:aria-disabled="busy ? 'true' : undefined"
						:aria-invalid="ownProblems.length > 0 ? 'true' : undefined"
						:aria-describedby="describedBy"
						size="xl"
						@update:modelValue="emitEdit(path, { op: 'replace', value: $event })"
					/>
					<span
						class="text-xs text-muted"
						aria-hidden="true"
					>{{ value === true ? i18n.t('On') : i18n.t('Off') }}</span>
				</div>
				<select
					v-else-if="field.kind === 'enum'"
					:id="`${id}-control`"
					:key="controlKey"
					:value="field.options.indexOf(value as never)"
					:aria-disabled="busy ? 'true' : undefined"
					:aria-invalid="ownProblems.length > 0 ? 'true' : undefined"
					:aria-describedby="describedBy"
					:class="controlClass"
					@change="onChoice"
				>
					<option
						v-for="(option, index) in field.options"
						:key="index"
						:value="index"
					>
						{{ String(option) }}
					</option>
				</select>
				<div
					v-else
					class="flex min-w-0 flex-wrap items-start gap-1.5"
				>
					<textarea
						v-if="field.kind === 'json'"
						:id="`${id}-control`"
						:key="controlKey"
						v-model="text"
						:readonly="locked === true"
						:aria-disabled="busy ? 'true' : undefined"
						:aria-invalid="invalid || ownProblems.length > 0"
						:aria-describedby="describedBy"
						rows="3"
						class="h-auto min-w-30 flex-[1_1_7.5rem] py-1"
						:class="[controlClass]"
						@keydown.meta.enter.prevent="commitText"
						@keydown.ctrl.enter.prevent="commitText"
						@keydown.esc="onEscape"
						@blur="onBlur"
					/>
					<input
						v-else
						:id="`${id}-control`"
						:key="controlKey"
						v-model="text"
						type="text"
						:inputmode="field.kind === 'number' ? 'decimal' : undefined"
						:readonly="locked === true"
						:aria-disabled="busy ? 'true' : undefined"
						:aria-invalid="invalid || ownProblems.length > 0"
						:aria-describedby="describedBy"
						class="min-w-30 flex-[1_1_7.5rem]"
						:class="[controlClass]"
						@keydown.enter.prevent="commitText"
						@keydown.esc="onEscape"
						@blur="onBlur"
					>
				</div>
				<div
					v-if="notApplied !== null"
					:id="`${id}-not-applied`"
					data-testid="not-applied"
					class="flex flex-wrap items-center gap-1.5 text-xs text-warning"
				>
					<span>{{ i18n.t('Not applied: {reason}', { reason: notApplied }) }}</span>
					<UButton
						type="button"
						data-use-document-value
						color="neutral"
						variant="outline"
						size="xs"
						class="min-h-6"
						:aria-label="`${i18n.t('Use the Document value')}: ${label}`"
						@click="useDocumentValue"
					>
						{{ i18n.t('Use the Document value') }}
					</UButton>
				</div>
				<p
					v-if="invalid"
					role="alert"
					class="m-0 text-xs text-error"
				>
					{{ field.kind === 'json' ? i18n.t('Enter valid JSON.') : i18n.t('Enter a number, such as 12 or 2.5.') }}
				</p>
				<p
					v-if="model.viaUnion"
					data-testid="union-hint"
					class="m-0 text-xs text-muted"
				>
					{{ i18n.t('This value has other forms; the JSON view edits those.') }}
				</p>
				<ul
					v-if="ownProblems.length > 0"
					:id="problemsId"
					data-testid="field-problems"
					:data-problem-keys="ownProblems.map(problem => problem.key).join(' ')"
					class="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-error"
				>
					<li
						v-for="problem in shownProblems"
						:key="problem.key"
						data-testid="field-problem"
						:data-problem-code="problem.code ?? 'syntax-error'"
						class="wrap-anywhere"
					>
						<span class="font-mono">{{ problem.code }}</span>: {{ problem.message }}
					</li>
				</ul>
			</div>
			<UButton
				v-if="removable"
				type="button"
				color="neutral"
				variant="ghost"
				size="sm"
				class="shrink-0"
				square
				icon="i-lucide-trash-2"
				:aria-disabled="busy ? 'true' : undefined"
				:aria-label="i18n.t('Remove {name}', { name: label })"
				@click="emitEdit(path, { op: 'remove' })"
			/>
		</div>

		<!-- Object or array: a labelled group of its own values -->
		<div
			v-else
			role="group"
			:aria-label="label"
			:aria-describedby="problemsId"
			class="min-w-0"
			:class="bare ? '' : 'mb-2'"
		>
			<div
				v-if="!bare"
				class="mb-1 flex items-center gap-1.5"
			>
				<span
					:title="description"
					class="font-mono text-xs font-semibold"
				>
					{{ label }}
					<span
						v-if="field.kind === 'array'"
						class="font-sans font-normal text-muted"
					>{{ i18n.t('list ({count})', { count: arrayValue.length }) }}</span>
				</span>
				<span class="flex-1" />
				<UButton
					v-if="removable"
					type="button"
					color="neutral"
					variant="ghost"
					size="sm"
					square
					icon="i-lucide-trash-2"
					:aria-disabled="busy ? 'true' : undefined"
					:aria-label="i18n.t('Remove {name}', { name: label })"
					@click="emitEdit(path, { op: 'remove' })"
				/>
			</div>
			<p
				v-if="model.viaUnion"
				data-testid="union-hint"
				class="m-0 mb-1 text-xs text-muted"
			>
				{{ i18n.t('This value has other forms; the JSON view edits those.') }}
			</p>
			<!-- A group shows the problems about itself, or about a key it does not hold (a missing required key). Focusable, so
				"Show problems" can put focus on it. -->
			<ul
				v-if="ownProblems.length > 0"
				:id="problemsId"
				data-testid="field-problems"
				:data-problem-keys="ownProblems.map(problem => problem.key).join(' ')"
				tabindex="-1"
				class="m-0 mb-1 flex list-none flex-col gap-0.5 p-0 text-xs text-error outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				<li
					v-for="problem in shownProblems"
					:key="problem.key"
					data-testid="field-problem"
					:data-problem-code="problem.code ?? 'syntax-error'"
					class="wrap-anywhere"
				>
					<span class="font-mono">{{ problem.code }}</span>: {{ problem.message }}
				</li>
			</ul>
			<div :class="bare ? '' : 'ml-1 border-l border-default pl-3'">
				<template v-if="field.kind === 'object'">
					<ConfigFieldEditor
						v-for="key in keys.present"
						:key="key"
						:root="root"
						:schema="childSchema(key)"
						:value="objectValue[key]"
						:path="[...path, key]"
						:label="key"
						:removable="canRemoveKey(field, key)"
						:problems="problems"
						:resync="resync"
						:busy="busy"
						:locked="locked"
						@edit="(p, e) => emitEdit(p, e)"
					/>
					<p
						v-if="keys.present.length === 0"
						class="m-0 mb-1.5 text-xs text-muted"
					>
						{{ i18n.t('Nothing set yet.') }}
					</p>
					<div
						v-if="keys.addable.length > 0"
						class="mb-1.5 flex flex-wrap items-center gap-1.5"
					>
						<select
							v-model="newField"
							:aria-disabled="busy ? 'true' : undefined"
							:aria-label="i18n.t('Optional field to add to {name}', { name: label })"
							class="min-w-30 flex-1"
							:class="[controlClass]"
						>
							<option value="">
								{{ i18n.t('Add an optional field…') }}
							</option>
							<option
								v-for="key in keys.addable"
								:key="key"
								:value="key"
							>
								{{ key }}
							</option>
						</select>
						<UButton
							type="button"
							color="neutral"
							variant="outline"
							size="sm"
							icon="i-lucide-plus"
							:aria-disabled="busy || newField === '' ? 'true' : undefined"
							@click="addField"
						>
							{{ i18n.t('Add field') }}
						</UButton>
					</div>
					<div
						v-if="field.additional !== null"
						class="mb-1.5 flex flex-wrap items-center gap-1.5"
					>
						<input
							v-model="newKey"
							type="text"
							:aria-disabled="busy ? 'true' : undefined"
							:aria-label="i18n.t('Name of the key to add to {name}', { name: label })"
							:placeholder="i18n.t('New key')"
							class="min-w-30 flex-1"
							:class="[controlClass]"
							@keydown.enter.prevent="addKey"
						>
						<UButton
							type="button"
							color="neutral"
							variant="outline"
							size="sm"
							icon="i-lucide-plus"
							:aria-disabled="busy || newKey.trim() === '' || Object.hasOwn(objectValue, newKey.trim()) ? 'true' : undefined"
							@click="addKey"
						>
							{{ i18n.t('Add key') }}
						</UButton>
					</div>
				</template>
				<template v-else-if="field.kind === 'array'">
					<ConfigFieldEditor
						v-for="(item, index) in arrayValue"
						:key="index"
						:root="root"
						:schema="field.items"
						:value="item"
						:path="[...path, index]"
						:label="`#${index + 1}`"
						:removable="canRemoveItem(field, arrayValue.length)"
						:problems="problems"
						:resync="resync"
						:busy="busy"
						:locked="locked"
						@edit="(p, e) => emitEdit(p, e)"
					/>
					<p
						v-if="arrayValue.length === 0"
						class="m-0 mb-1.5 text-xs text-muted"
					>
						{{ i18n.t('The list is empty.') }}
					</p>
					<UButton
						v-if="canAddItem(field, arrayValue.length)"
						type="button"
						color="neutral"
						variant="outline"
						size="sm"
						icon="i-lucide-plus"
						class="mb-1.5"
						:aria-disabled="busy ? 'true' : undefined"
						@click="addItem"
					>
						{{ i18n.t('Add item to {name}', { name: label }) }}
					</UButton>
				</template>
			</div>
		</div>
	</div>
</template>
