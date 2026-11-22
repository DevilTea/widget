<script setup lang="ts">
/**
 * Lab header (audit U01, U02, U04, U05, U24), grouped by job and kept on one row from 1280px up:
 *
 *   Widget Lab | Examples menu | status chip ⓘ ... | (Discard JSON changes) / Undo | overflow menu
 *
 * - The Examples menu combines showcase and preset and always names what is open: the showcase plus the last
 *   loaded preset, or "edited" once the source no longer matches it. Loading either while the JSON text does not parse
 *   first asks (`DraftGuardDialog`), and so does switching showcase away from committed edits (Lab UX phase 2).
 * - One plain-language status chip (Lab UX phase 3, `LabStatus.chip`): "Up to date", "N problems · Preview shows the last
 *   working version", "JSON syntax error — not applied", "Preview unavailable", "Updating the preview…" and, briefly after
 *   a commit replaced the Runtime, "Preview restarted". With problems or a syntax error it is a button that shows them in
 *   the current Author view. Revision numbers, Linked/Diverged and the recovery facts are developer details in a popover
 *   (`StatusDetails.vue`).
 * - There is no Apply or Revert: every edit is committed when it is made (Lab UX phase 3). Undo (the previously committed
 *   source, as a new revision) stays; "Discard JSON changes" appears only while the JSON text does not parse. Format lives
 *   in the JSON view's own toolbar. A disabled action stays focusable (`aria-disabled`) so its tooltip can say why.
 * - The overflow menu holds the tutorial, theme, language, Reset layout (the Dockview layout is remembered across
 *   reloads) and the Developer submenu (Implementation and Document Tools).
 *
 * Built on Nuxt UI (explicit imports; see AGENTS.md "Nuxt UI and Tailwind"). The tutorial dialogs and the
 * draft guard are native `<dialog>`s, which is fine here: no Nuxt UI overlay is ever opened from inside one.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ComponentPublicInstance } from 'vue'
import type { LabLocale } from '../i18n/locale'
import type { ShowcasePreset } from '../showcases/registry'
import type { LabTheme } from '../theme/theme'
import UBadge from '@nuxt/ui/components/Badge.vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import { useDocumentTools } from '../composables/use-document-tools'
import { useDraftGuard } from '../composables/use-draft-guard'
import { useImplementationExplorer } from '../composables/use-implementation-explorer'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useLabStore } from '../composables/use-lab-store'
import { useLabTheme } from '../composables/use-lab-theme'
import { useTutorialStore } from '../composables/use-tutorial'
import { useWorkbenchLayout } from '../composables/use-workbench-layout'
import { getShowcase } from '../showcases/registry'
import StatusDetails from './StatusDetails.vue'

const store = useLabStore()
const theme = useLabTheme()
const tutorial = useTutorialStore()
const i18n = useLabI18n()
const draftGuard = useDraftGuard()
const implementationExplorer = useImplementationExplorer()
const documentTools = useDocumentTools()
const workbenchLayout = useWorkbenchLayout()

// ---------------------------------------------------------------------------------------------------------
// Examples menu

// Listed showcases only, plus the current one when a hidden test fixture was opened with `?showcase=<id>`,
// so the menu always shows what is open.
const showcaseOptions = computed(() => {
	const current = getShowcase(store.showcaseId.value)
	return current === undefined || store.showcases.includes(current) ? store.showcases : [...store.showcases, current]
})
const currentShowcaseLabel = computed(() => {
	const current = getShowcase(store.showcaseId.value)
	return i18n.t(current?.label ?? store.showcaseId.value)
})
const exampleLabel = computed(() => {
	const example = store.example.value
	return example.kind === 'preset' ? i18n.t(example.preset.label) : i18n.t('edited')
})

// An action that may open a modal dialog (the draft guard, the tutorial's own confirmation) waits until the
// menu that chose it has closed and focus is back on the menu's trigger: the dialog then records that trigger
// as the control to return focus to, instead of a menu item that is about to disappear. `onCloseAutoFocus` is
// Reka's hook for that moment; the trigger is focused here (and Reka's own restore, which runs a task later
// than anything scheduled from this handler, prevented) so the order is guaranteed, and the action runs in the
// next task, after focus has settled.
//
// Like Reka's own handler, this refocuses the trigger only when the menu closed WITHOUT an interaction outside
// it (Escape, an item select). A non-modal menu also closes because the user clicked or focused something else
// (into Monaco, onto the other header menu); stealing focus back to the trigger then would swallow the typing
// or close the menu that click just opened. `onInteractOutside` records that case (mirroring Reka, any outside
// interaction of a non-modal menu counts); the flag is reset when the menu opens and when it has been consumed.
let afterMenuClose: (() => void) | null = null
const examplesTrigger = useTemplateRef<ComponentPublicInstance>('examplesTrigger')
const overflowTrigger = useTemplateRef<ComponentPublicInstance>('overflowTrigger')

function createMenuFocusHandling(align: 'start' | 'end', trigger: typeof examplesTrigger) {
	let interactedOutside = false
	return {
		content: {
			align,
			onInteractOutside: (event: Event) => {
				if (!event.defaultPrevented)
					interactedOutside = true
			},
			onCloseAutoFocus: (event: Event) => {
				const outside = interactedOutside
				interactedOutside = false
				const action = afterMenuClose
				afterMenuClose = null
				if (outside) {
					// Leave focus where the user put it (Reka's own handler skips the refocus too). A chosen item's
					// action must still run, though: a click elsewhere can land while the menu is still leaving.
					if (action !== null)
						setTimeout(action, 0)
					return
				}
				event.preventDefault()
				;(trigger.value?.$el as HTMLElement | undefined)?.focus()
				if (action !== null)
					setTimeout(action, 0)
			},
		},
		onOpenChange: (open: boolean) => {
			if (open)
				interactedOutside = false
		},
	}
}
const examplesFocus = createMenuFocusHandling('start', examplesTrigger)
const overflowFocus = createMenuFocusHandling('end', overflowTrigger)

function chooseShowcase(id: string, label: string): void {
	if (id === store.showcaseId.value)
		return
	// A switch starts a new session with an empty Undo stack: it asks about committed edits as well as a draft.
	afterMenuClose = () => draftGuard.request({ subject: label, undoable: false, run: () => void store.switchShowcase(id) })
}

function choosePreset(preset: ShowcasePreset): void {
	// A preset load is an ordinary commit: it asks only about a draft, and the store offers Undo for replaced edits.
	afterMenuClose = () => draftGuard.request({ subject: i18n.t(preset.label), undoable: true, run: () => void store.applyPreset(preset.id) })
}

const exampleItems = computed<DropdownMenuItem[][]>(() => [
	[
		{ type: 'label', label: i18n.t('Showcase') },
		...showcaseOptions.value.map(showcase => ({
			type: 'checkbox' as const,
			label: i18n.t(showcase.label),
			checked: showcase.id === store.showcaseId.value,
			onSelect: () => chooseShowcase(showcase.id, i18n.t(showcase.label)),
		})),
	],
	[
		{ type: 'label', label: i18n.t('Preset') },
		...store.presets.value.map(preset => ({
			type: 'checkbox' as const,
			label: i18n.t(preset.label),
			description: i18n.t(preset.description),
			checked: store.example.value.kind === 'preset' && store.example.value.preset.id === preset.id,
			onSelect: () => choosePreset(preset),
		})),
	],
])

// ---------------------------------------------------------------------------------------------------------
// The status chip (Lab UX phase 3): one plain-language state at a time (`LabStatus.chip`, see `lab/status.ts`), replacing
// the validity, draft and preview chips of phases 1 and 2. The ⓘ popover keeps the technical facts.

const chip = computed(() => store.status.value.chip)
const chipLabel = computed(() => {
	const value = chip.value
	switch (value.kind) {
		case 'syntax-error': return i18n.t('JSON syntax error — not applied')
		case 'problems':
			if (value.previewShown)
				return i18n.t(value.count === 1 ? '{count} problem · Preview shows the last working version' : '{count} problems · Preview shows the last working version', { count: value.count })
			return i18n.t(value.count === 1 ? '{count} problem · Preview unavailable' : '{count} problems · Preview unavailable', { count: value.count })
		case 'preview-unavailable': return i18n.t('Preview unavailable')
		case 'updating': return i18n.t('Updating the preview…')
		case 'stale': return i18n.t('Preview shows the last working version')
		case 'restarted': return i18n.t('Preview restarted')
		default: return i18n.t('Up to date')
	}
})
const chipColor = computed(() => {
	switch (chip.value.kind) {
		case 'syntax-error': return 'error' as const
		case 'problems': return 'error' as const
		case 'preview-unavailable': return 'warning' as const
		case 'stale': return 'warning' as const
		case 'up-to-date': return 'success' as const
		default: return 'info' as const
	}
})
const chipIcon = computed(() => {
	switch (chip.value.kind) {
		case 'syntax-error': return 'i-lucide-braces'
		case 'problems': return 'i-lucide-circle-alert'
		case 'preview-unavailable': return 'i-lucide-circle-x'
		case 'updating': return 'i-lucide-loader-circle'
		case 'stale': return 'i-lucide-triangle-alert'
		case 'restarted': return 'i-lucide-rotate-cw'
		default: return 'i-lucide-circle-check'
	}
})
/** With problems or a syntax error the chip is a button that shows them in the current view; its name says so. */
const chipIsButton = computed(() => chip.value.kind === 'problems' || chip.value.kind === 'syntax-error')
/** The committed Document's problem count (`data-problem-count`, also while a syntax error is what the chip says). */
const problemCount = computed(() => {
	const validity = store.status.value.validity
	return validity.kind === 'problems' ? validity.count : 0
})
const showProblemsLabel = computed(() => i18n.t('{problems}: show them', { problems: chipLabel.value }))

/**
 * What the polite live region announces: the chip's text once it has held for a moment, so typing in the JSON view (whose text
 * often stops parsing for a keystroke or two) does not announce every flip. "Up to date" is not announced; it is the quiet
 * state after the others.
 */
const ANNOUNCE_AFTER_MS = 1000
const announcement = shallowRef('')
let announceTimer: ReturnType<typeof setTimeout> | null = null
watch(chipLabel, (label) => {
	if (announceTimer !== null)
		clearTimeout(announceTimer)
	announceTimer = setTimeout(() => {
		announceTimer = null
		announcement.value = chip.value.kind === 'up-to-date' ? '' : label
	}, ANNOUNCE_AFTER_MS)
})
onBeforeUnmount(() => {
	if (announceTimer !== null)
		clearTimeout(announceTimer)
})

function onShowProblems(): void {
	store.showProblems()
}

// ---------------------------------------------------------------------------------------------------------
// Edit actions. A disabled button uses `aria-disabled` (not `disabled`) so it stays focusable and keeps its tooltip, which
// explains why it is unavailable. "Discard JSON changes" exists only while the JSON text does not parse.

const undoTooltip = computed(() => {
	if (store.canUndo.value)
		return i18n.t('Undo last change: restore the previous version as a new revision')
	if (store.hasJsonSyntaxError.value)
		return i18n.t('Fix or discard the JSON syntax error before undoing')
	return i18n.t('Nothing to undo yet')
})

function onDiscardJson(): void {
	if (store.hasJsonSyntaxError.value)
		store.discardJsonChanges()
}

function onUndo(): void {
	if (store.canUndo.value)
		void store.undo()
}

// ---------------------------------------------------------------------------------------------------------
// Overflow menu

const tutorialLabel = computed(() => {
	switch (tutorial.snapshot.value.status) {
		case 'paused': return i18n.t('Resume tutorial')
		case 'completed': return i18n.t('Restart tutorial')
		case 'active': return i18n.t('Pause tutorial')
		default: return i18n.t('Tutorial')
	}
})

function onTutorialSelect(): void {
	afterMenuClose = onTutorialAction
}

function onTutorialAction(): void {
	switch (tutorial.snapshot.value.status) {
		case 'paused':
			tutorial.requestResume()
			return
		case 'completed':
			tutorial.requestRestart()
			return
		case 'active':
			tutorial.pause()
			return
		default:
			tutorial.requestStart()
	}
}

const themeOptions: readonly { readonly value: LabTheme, readonly label: string }[] = [
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
]
const localeOptions: readonly { readonly value: LabLocale, readonly label: string }[] = [
	{ value: 'en', label: 'English' },
	{ value: 'zh-TW', label: '繁體中文' },
]

const overflowItems = computed<DropdownMenuItem[][]>(() => [
	[
		{
			label: tutorialLabel.value,
			icon: 'i-lucide-graduation-cap',
			disabled: tutorial.startPending.value,
			onSelect: onTutorialSelect,
		},
	],
	[
		{
			label: i18n.t('Theme'),
			icon: 'i-lucide-sun-moon',
			children: themeOptions.map(option => ({
				type: 'checkbox' as const,
				label: i18n.t(option.label),
				checked: theme.theme.value === option.value,
				onSelect: () => theme.setTheme(option.value),
			})),
		},
		{
			// The Lab's own language. A showcase may have a language of its own in the Preview (the survey's select): that
			// one is the showcase's State, so this entry says whose language it sets.
			label: i18n.t('Lab language'),
			icon: 'i-lucide-languages',
			children: localeOptions.map(option => ({
				type: 'checkbox' as const,
				label: option.label,
				checked: i18n.locale.value === option.value,
				onSelect: () => i18n.setLocale(option.value),
			})),
		},
	],
	[
		{
			label: i18n.t('Reset layout'),
			icon: 'i-lucide-layout-dashboard',
			onSelect: () => workbenchLayout.requestReset(),
		},
	],
	[
		{
			label: i18n.t('Developer'),
			icon: 'i-lucide-code',
			children: [
				{
					label: i18n.t('Implementation'),
					icon: 'i-lucide-file-code',
					onSelect: () => implementationExplorer.open('catalog'),
				},
				{
					label: i18n.t('Document Tools'),
					icon: 'i-lucide-wrench',
					onSelect: () => documentTools.open(),
				},
			],
		},
	],
])
</script>

<template>
	<header class="flex flex-none items-center gap-2 border-b border-default bg-muted px-3 py-1.5">
		<strong class="whitespace-nowrap text-[13px] tracking-wide">Widget Lab</strong>

		<UDropdownMenu
			:items="exampleItems"
			:content="examplesFocus.content"
			:modal="false"
			:ui="{ content: 'w-80 max-w-[90vw]' }"
			@update:open="examplesFocus.onOpenChange"
		>
			<UButton
				ref="examplesTrigger"
				data-testid="examples-menu"
				:data-showcase-id="store.showcaseId.value"
				:data-preset-id="store.example.value.kind === 'preset' ? store.example.value.preset.id : ''"
				color="neutral"
				variant="outline"
				size="sm"
				trailingIcon="i-lucide-chevron-down"
				class="min-w-0 max-w-88 justify-between"
			>
				<span class="sr-only">{{ i18n.t('Examples:') }}</span>
				<span
					data-testid="examples-showcase"
					class="truncate font-semibold"
				>{{ currentShowcaseLabel }}</span>
				<span
					data-testid="examples-preset"
					:data-example-kind="store.example.value.kind"
					class="truncate text-muted"
				>· {{ exampleLabel }}</span>
			</UButton>
		</UDropdownMenu>

		<span class="flex-1" />

		<!-- One status chip. With problems or a JSON syntax error it is a button that shows them in the current Author view
			(the action of the stale-preview notice's "Show problems"); otherwise it is a plain chip. It is not a live region
			itself: the visually hidden region next to it announces the state once it has settled. -->
		<UTooltip
			v-if="chipIsButton"
			:text="i18n.t('Show problems')"
		>
			<UButton
				data-testid="lab-status"
				:data-state="chip.kind"
				:data-problem-count="problemCount"
				:data-validity="store.status.value.validity.kind"
				:data-preview="store.status.value.preview"
				:color="chipColor"
				variant="subtle"
				size="sm"
				:icon="chipIcon"
				:label="chipLabel"
				:aria-label="showProblemsLabel"
				:ui="{ label: 'text-default' }"
				class="whitespace-nowrap"
				@click="onShowProblems"
			/>
		</UTooltip>
		<UBadge
			v-else
			data-testid="lab-status"
			:data-state="chip.kind"
			:data-problem-count="problemCount"
			:data-validity="store.status.value.validity.kind"
			:data-preview="store.status.value.preview"
			:color="chipColor"
			variant="subtle"
			size="md"
			:icon="chipIcon"
			:label="chipLabel"
			:ui="{ label: 'text-default', leadingIcon: chip.kind === 'updating' ? 'animate-spin motion-reduce:animate-none' : '' }"
			class="whitespace-nowrap"
		/>
		<span
			data-testid="lab-status-announcement"
			role="status"
			class="sr-only"
		>{{ announcement }}</span>

		<UPopover :content="{ align: 'end' }">
			<UButton
				data-testid="status-details"
				color="neutral"
				variant="ghost"
				size="sm"
				square
				icon="i-lucide-info"
				:aria-label="i18n.t('Document and preview details')"
			/>
			<template #content>
				<StatusDetails />
			</template>
		</UPopover>

		<UFieldGroup size="sm">
			<UTooltip
				v-if="store.hasJsonSyntaxError.value"
				:text="i18n.t('Throw away the JSON text that does not parse and show the document again')"
			>
				<UButton
					data-testid="discard-json-button"
					color="error"
					variant="outline"
					icon="i-lucide-x"
					:label="i18n.t('Discard JSON changes')"
					@click="onDiscardJson"
				/>
			</UTooltip>
			<UTooltip :text="undoTooltip">
				<UButton
					data-testid="undo-button"
					color="neutral"
					variant="outline"
					icon="i-lucide-undo-2"
					:label="i18n.t('Undo')"
					:aria-label="i18n.t('Undo last change')"
					:aria-disabled="!store.canUndo.value"
					class="aria-disabled:opacity-50"
					@click="onUndo"
				/>
			</UTooltip>
		</UFieldGroup>

		<UDropdownMenu
			:items="overflowItems"
			:content="overflowFocus.content"
			:modal="false"
			@update:open="overflowFocus.onOpenChange"
		>
			<UButton
				ref="overflowTrigger"
				data-testid="overflow-menu"
				color="neutral"
				variant="ghost"
				size="sm"
				square
				icon="i-lucide-ellipsis"
				:aria-label="i18n.t('More')"
			/>
		</UDropdownMenu>
	</header>
</template>
