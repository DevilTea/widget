<script setup lang="ts">
/**
 * Lab header (audit U01, U02, U04, U05, U24), grouped by job and kept on one row from 1280px up:
 *
 *   Widget Lab | Examples menu | status chips ... | Apply / Revert / Undo / Format | overflow menu
 *
 * - The Examples menu combines showcase and preset and always names what is open: the showcase plus the last
 *   loaded preset, or "edited" once the source no longer matches it. Loading either with an unapplied editor
 *   draft first asks (`DraftGuardDialog`).
 * - Two plain-language chips replace the internal-vocabulary ones: is the Document valid, and does the
 *   Preview show it. Revision numbers, Linked/Diverged and the draft/recovery facts that the Author panel used to show in its own
 *   box are developer details in a popover (`StatusDetails.vue`).
 * - Apply, Revert, Undo (the previously applied source, as a new revision) and Format are the edit actions.
 *   A disabled one stays focusable (`aria-disabled`) so its tooltip can say why.
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
import { computed, useTemplateRef } from 'vue'
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
	afterMenuClose = () => draftGuard.request(label, () => void store.switchShowcase(id))
}

function choosePreset(preset: ShowcasePreset): void {
	afterMenuClose = () => draftGuard.request(i18n.t(preset.label), () => void store.applyPreset(preset.id))
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
// Status chips

const validity = computed(() => store.status.value.validity)
const previewState = computed(() => store.status.value.preview)
const validityLabel = computed(() => {
	const value = validity.value
	if (value.kind === 'valid')
		return i18n.t('Valid')
	return i18n.t(value.count === 1 ? '{count} problem' : '{count} problems', { count: value.count })
})
const previewLabel = computed(() => {
	switch (previewState.value) {
		case 'current': return i18n.t('Preview up to date')
		case 'stale': return i18n.t('Preview shows the last valid version')
		case 'failed': return i18n.t('Preview failed to load')
		default: return i18n.t('No preview yet')
	}
})
const previewColor = computed(() => previewState.value === 'current' ? 'success' : previewState.value === 'stale' ? 'warning' : previewState.value === 'failed' ? 'error' : 'neutral')

// ---------------------------------------------------------------------------------------------------------
// Edit actions. Disabled buttons use `aria-disabled` (not `disabled`) so they stay focusable and keep their
// tooltip, which explains why they are unavailable.

const applyLabel = computed(() => i18n.t(store.isApplying.value ? 'Applying…' : 'Apply'))
const applyTooltip = computed(() => {
	if (store.isApplying.value)
		return i18n.t('Applying…')
	return store.isDirty.value ? i18n.t('Apply your edits to the document and preview') : i18n.t('Nothing to apply: no unapplied edits')
})
const revertTooltip = computed(() => store.isDirty.value
	? i18n.t('Discard your unapplied edits')
	: i18n.t('Nothing to revert: no unapplied edits'))
const undoTooltip = computed(() => {
	if (store.canUndo.value)
		return i18n.t('Undo last apply: restore the previously applied version as a new revision')
	if (store.isApplying.value)
		return i18n.t('Wait for the current Apply to finish')
	if (store.isDirty.value)
		return i18n.t('Apply or revert your unapplied edits before undoing')
	return i18n.t('Nothing to undo yet')
})

function onApply(): void {
	if (store.canApply.value)
		void store.apply()
}

function onRevert(): void {
	if (store.isDirty.value)
		store.revert()
}

function onUndo(): void {
	if (store.canUndo.value)
		void store.undoLastApply()
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
			label: i18n.t('Language'),
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

		<UBadge
			data-testid="document-status"
			:data-state="validity.kind"
			:data-problem-count="validity.kind === 'problems' ? validity.count : 0"
			:color="validity.kind === 'valid' ? 'success' : 'error'"
			variant="subtle"
			size="md"
			:icon="validity.kind === 'valid' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
			:label="validityLabel"
			:ui="{ label: 'text-default' }"
			class="whitespace-nowrap"
		/>
		<UBadge
			data-testid="preview-status"
			:data-state="previewState"
			:color="previewColor"
			variant="subtle"
			size="md"
			:icon="previewState === 'current' ? 'i-lucide-circle-check' : previewState === 'stale' ? 'i-lucide-triangle-alert' : previewState === 'failed' ? 'i-lucide-circle-x' : 'i-lucide-circle-dashed'"
			:label="previewLabel"
			:ui="{ label: 'text-default' }"
			class="whitespace-nowrap"
		/>

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
				:text="applyTooltip"
				:kbds="['meta', 'enter']"
			>
				<UButton
					data-testid="apply-button"
					color="primary"
					variant="solid"
					icon="i-lucide-check"
					:label="applyLabel"
					:aria-disabled="!store.canApply.value"
					class="aria-disabled:opacity-50"
					@click="onApply"
				/>
			</UTooltip>
			<UTooltip :text="revertTooltip">
				<UButton
					data-testid="revert-button"
					color="neutral"
					variant="outline"
					icon="i-lucide-rotate-ccw"
					:label="i18n.t('Revert')"
					:aria-disabled="!store.isDirty.value"
					class="aria-disabled:opacity-50"
					@click="onRevert"
				/>
			</UTooltip>
			<UTooltip :text="undoTooltip">
				<UButton
					data-testid="undo-button"
					color="neutral"
					variant="outline"
					icon="i-lucide-undo-2"
					:label="i18n.t('Undo')"
					:aria-label="i18n.t('Undo last apply')"
					:aria-disabled="!store.canUndo.value"
					class="aria-disabled:opacity-50"
					@click="onUndo"
				/>
			</UTooltip>
			<UTooltip :text="i18n.t('Format the JSON draft')">
				<UButton
					data-testid="format-button"
					color="neutral"
					variant="outline"
					icon="i-lucide-align-left"
					:label="i18n.t('Format')"
					@click="store.format()"
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
