<script setup lang="ts">
/**
 * Default two-column workbench (diagnostic #13 Widget Lab Phase 4 Checkpoint I, widened by issue #230 PR 3b): a
 * left tool group with tabs Author | Explain | Selected widget | Blueprint | Runtime | Events | Dependencies (Author initially
 * active, about half the width) and a persistent Preview on the right. Dockview owns tabs/resize/docking only —
 * it never becomes the semantic model for the panels. The layout is saved to `localStorage` and restored on
 * reload (`lab/layout-storage.ts`); "Reset layout" in the overflow menu goes back to the default.
 */
import type { DockviewApi, DockviewReadyEvent, DockviewTheme, SerializedDockview, VueComponent } from 'dockview-vue'
import type { LabToolTab } from '../composables/use-lab-store'
import { DockviewVue, themeAbyss } from 'dockview-vue'
import { defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useDocumentTools } from '../composables/use-document-tools'
import { useImplementationExplorer } from '../composables/use-implementation-explorer'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useLabStore } from '../composables/use-lab-store'
import { useWorkbenchLayout } from '../composables/use-workbench-layout'
import { CANONICAL_PANEL_IDS, clearSavedLayout, loadSavedLayout, saveLayout } from '../lab/layout-storage'
import NonClosableTab from './NonClosableTab.vue'
import AuthorPanel from './panels/AuthorPanel.vue'
import BlueprintPanel from './panels/BlueprintPanel.vue'
import DependenciesPanel from './panels/DependenciesPanel.vue'
import EventsPanel from './panels/EventsPanel.vue'
import ExplainPanel from './panels/ExplainPanel.vue'
import RuntimePanel from './panels/RuntimePanel.vue'
import SelectedWidgetPanel from './panels/SelectedWidgetPanel.vue'
import PreviewPanel from './preview/PreviewPanel.vue'

const store = useLabStore()
const i18n = useLabI18n()
const implementationExplorer = useImplementationExplorer()
const documentTools = useDocumentTools()
const workbenchLayout = useWorkbenchLayout()

/**
 * Dockview applies its theme via the `theme` option's `className` (dockview-core stamps it on its own
 * internal `.dv-shell` container), not via ambient CSS-class inheritance from an ancestor — passing
 * `class="dockview-theme-lab"` on `<DockviewVue>` itself only reaches the *outer* host element, one
 * level above where dockview-core would otherwise apply its own default (`dockview-theme-abyss`) and
 * shadow any same-named `--dv-*` custom properties set higher up. Basing this on `themeAbyss` keeps
 * its non-color layout defaults (gap, tab indicator, drag overlay, ...); only `className` changes, to
 * the small custom theme in `src/styles/dockview-theme.css` whose variables derive from the Lab palette
 * tokens (`src/styles/lab-tokens.css`).
 */
const labTheme: DockviewTheme = {
	...themeAbyss,
	name: 'lab',
	className: 'dockview-theme-lab',
}

// `dockview-vue`'s `VueComponent` alias is `DefineComponent<T = any>` filled with Vue's own default
// generic parameters, which a `<script setup>` SFC's inferred (concretely-instantiated) component
// type is not structurally identical to — a well-known Vue 3 typing friction point, not a runtime
// concern: every value below genuinely is a Vue component.
const components: Record<string, VueComponent> = {
	author: AuthorPanel as unknown as VueComponent,
	explain: ExplainPanel as unknown as VueComponent,
	blueprint: BlueprintPanel as unknown as VueComponent,
	runtime: RuntimePanel as unknown as VueComponent,
	events: EventsPanel as unknown as VueComponent,
	dependencies: DependenciesPanel as unknown as VueComponent,
	widget: SelectedWidgetPanel as unknown as VueComponent,
	preview: PreviewPanel as unknown as VueComponent,
	// diagnostic #25 P3 Scope D: `defineAsyncComponent` (not a plain import) is the actual lazy boundary —
	// `ImplementationPanel.vue` and everything it statically imports (the curated-file viewer, Shiki)
	// only enter their own chunk once Dockview first mounts this component, which only happens once
	// `implementationExplorer.open()` has been called at least once (see `watchImplementationOpenRequests`
	// below) — never merely because this record exists.
	implementation: defineAsyncComponent(() => import('./panels/ImplementationPanel.vue')) as unknown as VueComponent,
	documentTools: defineAsyncComponent(() => import('./panels/DocumentToolsPanel.vue')) as unknown as VueComponent,
}

// diagnostic #27 Finding 2: the canonical panels' tab content renderer, close-button-free by construction
// (see NonClosableTab.vue) — selected per-panel below via `AddPanelOptions.tabComponent`.
const tabComponents: Record<string, VueComponent> = {
	nonClosable: NonClosableTab as unknown as VueComponent,
}

const workbenchEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
// Merge-gate review hygiene note (diagnostic #25 P1): `watchTutorialTabActivation()` below is only ever
// called from `onReady()`, a child-emitted event-callback invocation rather than `setup()`'s own
// synchronous body or a lifecycle hook Vue explicitly re-activates this component's effect scope for —
// so a `watch()` created there is not reliably guaranteed to be auto-disposed on unmount. Retaining its
// stop handle and calling it from `onBeforeUnmount` (alongside the existing `resizeObserver.disconnect()`)
// makes the cleanup explicit rather than relying on that scope behavior.
let stopTutorialTabActivationWatch: (() => void) | null = null
// Same hygiene note as `stopTutorialTabActivationWatch` above — this `watch()` is also only ever
// created from `onReady()`, so its stop handle is retained and called explicitly from
// `onBeforeUnmount` instead.
let stopImplementationOpenWatch: (() => void) | null = null
let stopDocumentToolsOpenWatch: (() => void) | null = null
let stopLayoutPersistence: (() => void) | null = null
let stopLayoutResetWatch: (() => void) | null = null
let stopTitleWatch: (() => void) | null = null

/**
 * `dockview-vue`'s `<DockviewVue>` measures its container exactly once, synchronously, in its own
 * `onMounted` (`api.layout(el.clientWidth, el.clientHeight)`) and never re-measures on its own — no
 * `ResizeObserver`, no window resize listener. At that moment `.workbench`'s flex-resolved height may
 * not have settled yet (a child component can mount before an ancestor's flex layout stabilizes),
 * so dockview-core falls back to its own internal default height. Observing the actual host element
 * ourselves and re-calling `api.layout()` on every size change fixes both the initial measurement and
 * real window/divider resizes going forward.
 */
function observeSize(api: DockviewApi): void {
	const el = workbenchEl.value
	if (el === null)
		return
	resizeObserver = new ResizeObserver(() => {
		api.layout(el.clientWidth, el.clientHeight)
	})
	resizeObserver.observe(el)
}

onBeforeUnmount(() => {
	resizeObserver?.disconnect()
	stopTutorialTabActivationWatch?.()
	stopImplementationOpenWatch?.()
	stopDocumentToolsOpenWatch?.()
	stopLayoutPersistence?.()
	stopLayoutResetWatch?.()
	stopTitleWatch?.()
})

/** The panels whose activation is mirrored in `LabStore.activeTab` (see `watchTutorialTabActivation`). */
const CANONICAL_TAB_IDS: ReadonlySet<string> = new Set<LabToolTab>(['author', 'explain', 'widget', 'blueprint', 'runtime', 'events', 'dependencies', 'preview'])

/**
 * Tab titles follow the Lab language at the moment a layout is built or restored (as they always did). Widget vocabulary
 * (Blueprint, Runtime, Preview) stays English; the Events log is "Events" in English and "Events 紀錄" in Taiwan Chinese,
 * through its own message so the Catalog's "Events" label keeps the bare word.
 */
function canonicalTitles(): Readonly<Record<string, string>> {
	return {
		author: i18n.t('Author'),
		explain: i18n.t('Explain'),
		widget: i18n.t('Selected widget'),
		blueprint: 'Blueprint',
		runtime: 'Runtime',
		events: i18n.locale.value === 'en' ? 'Events' : i18n.t('Events log'),
		dependencies: i18n.t('Dependencies'),
		preview: 'Preview',
	}
}

/** Titles of the panels opened on request; they follow a language switch like the canonical ones. */
function requestedPanelTitles(): Readonly<Record<string, string>> {
	return {
		'implementation': i18n.t('Implementation'),
		'document-tools': i18n.t('Document Tools'),
	}
}

/**
 * The default layout: the tool group (Author, Explain, Selected widget, Blueprint, Runtime, Events, Dependencies; Author active)
 * left and the persistent Preview right. The tool area is wide on purpose (audit U12: Relations and the
 * Implementation source are clipped in a column of about 29%): about half the workbench, between 420 and 940px.
 * Users may resize the divider afterwards (Dockview owns that) and the result is remembered.
 */
function buildDefaultLayout(api: DockviewApi): void {
	const titles = canonicalTitles()
	// `tabComponent: 'nonClosable'` on every canonical panel (diagnostic #27 Finding 2) — see
	// NonClosableTab.vue/tabComponents above for the mechanism.
	api.addPanel({ id: 'author', component: 'author', tabComponent: 'nonClosable', title: titles.author })
	for (const id of ['explain', 'widget', 'blueprint', 'runtime', 'events', 'dependencies']) {
		api.addPanel({
			id,
			component: id,
			tabComponent: 'nonClosable',
			title: titles[id],
			position: { referencePanel: 'author', direction: 'within' },
			inactive: true,
		})
	}
	api.addPanel({
		id: 'preview',
		component: 'preview',
		tabComponent: 'nonClosable',
		title: titles.preview,
		position: { referencePanel: 'author', direction: 'right' },
	})

	const toolWidth = Math.round(Math.max(420, Math.min(940, api.width * 0.48)))
	api.getPanel('author')?.group.api.setSize({ width: toolWidth })
}

/**
 * Restores the saved layout if there is a usable one. A layout Dockview cannot load (it can still throw for data
 * that looks right) is discarded for good and the default is built instead. Panels that are opened on request
 * (Implementation, Document Tools) are not in the loaded layout at all (`loadSavedLayout` strips them), so none is
 * created and none can leave a neighbour active. The restored active panel is written to `LabStore.activeTab`
 * here, because the Dockview-to-store subscription (`watchTutorialTabActivation`) is made after the restore.
 */
function restoreOrBuildLayout(api: DockviewApi): void {
	const saved = loadSavedLayout()
	if (saved !== null) {
		try {
			api.fromJSON(saved as unknown as SerializedDockview)
			const titles = canonicalTitles()
			for (const id of CANONICAL_PANEL_IDS)
				api.getPanel(id)?.api.setTitle(titles[id] ?? id)
			const active = api.activePanel?.id
			if (active !== undefined && CANONICAL_TAB_IDS.has(active))
				store.activeTab.value = active as LabToolTab
			return
		}
		catch {
			api.clear()
		}
	}
	// Whatever was stored was not usable (or nothing was): forget it, the default layout is saved on the next change.
	clearSavedLayout()
	buildDefaultLayout(api)
}

/** Saves the layout shortly after it settles, and once more when the page goes away. */
function persistLayoutChanges(api: DockviewApi): void {
	let timer: ReturnType<typeof setTimeout> | null = null
	const flush = (): void => {
		if (timer !== null) {
			clearTimeout(timer)
			timer = null
		}
		saveLayout(api.toJSON())
	}
	const subscription = api.onDidLayoutChange(() => {
		if (timer !== null)
			clearTimeout(timer)
		timer = setTimeout(flush, 250)
	})
	window.addEventListener('pagehide', flush)
	stopLayoutPersistence = () => {
		subscription.dispose()
		window.removeEventListener('pagehide', flush)
		if (timer !== null)
			clearTimeout(timer)
	}
}

/** Tab titles follow a language switch (they used to be fixed when the panel was added). */
function watchTitleLocale(api: DockviewApi): void {
	stopTitleWatch = watch(i18n.locale, () => {
		const titles = canonicalTitles()
		for (const id of CANONICAL_PANEL_IDS)
			api.getPanel(id)?.api.setTitle(titles[id] ?? id)
		for (const [id, title] of Object.entries(requestedPanelTitles()))
			api.getPanel(id)?.api.setTitle(title)
	})
}

/** "Reset layout" (overflow menu): forget the saved layout and go back to the default one. */
function watchLayoutResetRequests(api: DockviewApi): void {
	stopLayoutResetWatch = watch(
		() => workbenchLayout.resetRequestTick.value,
		() => {
			clearSavedLayout()
			api.clear()
			buildDefaultLayout(api)
			store.activeTab.value = 'author'
			api.getPanel('author')?.api.setActive()
		},
	)
}

function onReady(event: DockviewReadyEvent): void {
	const { api } = event

	restoreOrBuildLayout(api)

	observeSize(api)
	persistLayoutChanges(api)
	watchLayoutResetRequests(api)
	watchTitleLocale(api)
	watchTutorialTabActivation(api)
	watchImplementationOpenRequests(api)
	watchDocumentToolsOpenRequests(api)
}

/**
 * The minimal "tab-activation bridge" diagnostic #25 P1's Survey tour view-map step (and its "See it in
 * Runtime" link) needs: `LabStore.activeTab` already existed as a plain `Ref<LabToolTab>` with no
 * observable effect on Dockview — this is the one place that makes assigning it actually switch the
 * visible tab, via `DockviewApi.getPanel(id)?.api.setActive()` (`dockview-core`'s
 * `DockviewPanelApi.setActive()`). It is also followed the other way (Dockview -> `activeTab`): a tab the
 * user clicks becomes `activeTab`, so a later request for a tab that is already `activeTab` in the store but
 * no longer on screen ("Show problems" asking for Author after the user opened Runtime) still switches.
 * Both directions only ever set the same value, so they cannot loop.
 */
function watchTutorialTabActivation(api: DockviewApi): void {
	const stopWatch = watch(
		() => store.activeTab.value,
		(tab) => {
			// Activating moves DOM focus (into the panel's group), so never re-activate what the user already
			// activated themselves: that is what a tab click echoed through `activeTab` would otherwise do,
			// stealing focus from, say, the Monaco editor the user just clicked into.
			if (api.activePanel?.id !== tab)
				api.getPanel(tab)?.api.setActive()
		},
	)
	const activePanelChange = api.onDidActivePanelChange(({ panel }) => {
		if (panel !== undefined && CANONICAL_TAB_IDS.has(panel.id))
			store.activeTab.value = panel.id as LabToolTab
	})
	stopTutorialTabActivationWatch = () => {
		stopWatch()
		activePanelChange.dispose()
	}
}

/**
 * Diagnostic #25 P3 Scope D "Opening = `api.addPanel` if absent else activate". Deliberately not `immediate`
 * (matching `watchTutorialTabActivation` above): `openRequestTick` starts at `0` and every real
 * `open()` call increments it, so the watch only ever fires on an actual request, never at setup time.
 * The Implementation panel is added `within` the same tab group as Author/Blueprint/Runtime/Dependencies, with
 * NO `tabComponent` override — Dockview's own default tab (close button included) is exactly the
 * "closable, default tab component" the panel is specified to use, unlike the seven canonical panels'
 * `nonClosable` tab.
 */
function watchImplementationOpenRequests(api: DockviewApi): void {
	stopImplementationOpenWatch = watch(
		() => implementationExplorer.openRequestTick.value,
		() => {
			const existing = api.getPanel('implementation')
			if (existing !== undefined) {
				existing.api.setActive()
				return
			}
			api.addPanel({
				id: 'implementation',
				component: 'implementation',
				title: requestedPanelTitles().implementation!,
				position: { referencePanel: 'author', direction: 'within' },
			})
		},
	)
}

/** Phase 6: adds the developer panel only after an explicit header request; the default tab remains closable. */
function watchDocumentToolsOpenRequests(api: DockviewApi): void {
	stopDocumentToolsOpenWatch = watch(
		() => documentTools.openRequestTick.value,
		() => {
			const existing = api.getPanel('document-tools')
			if (existing !== undefined) {
				existing.api.setActive()
				return
			}
			api.addPanel({
				id: 'document-tools',
				component: 'documentTools',
				title: requestedPanelTitles()['document-tools']!,
				position: { referencePanel: 'author', direction: 'within' },
			})
		},
	)
}
</script>

<template>
	<div
		ref="workbenchEl"
		class="workbench"
	>
		<DockviewVue
			class="workbench__dockview"
			:theme="labTheme"
			:components="components"
			:tabComponents="tabComponents"
			@ready="onReady"
		/>
	</div>
</template>

<style scoped>
/*
 * `<DockviewVue>` is a multi-root component (its own host `<div>` plus a sibling
 * `<DockviewPortals>`; see dockview-vue's `dockview.vue`) that binds `class`/`style` onto its host
 * element via an explicit `v-bind="$attrs"` rather than Vue's automatic single-root attr
 * fallthrough. That explicit spread does not carry this component's scoped-CSS `data-v-*`
 * attribute, so a plain scoped `.workbench__dockview { ... }` rule silently matched nothing (the
 * class attribute renders, but with no scope attribute for the scoped selector to require) and the
 * whole workbench collapsed to zero height. `:deep()` compiles to a descendant selector scoped
 * through the ancestor `.workbench` (which *does* carry the scope attribute) instead, so it matches
 * regardless of whether the target element itself carries this component's scope attribute.
 *
 * `.workbench` is also switched from percentage-height chaining to `display: flex` so its one child
 * fills both axes via flex-grow/stretch directly, instead of depending on `height: 100%` resolving
 * correctly through a percentage-of-flex-item chain.
 */
.workbench {
	position: relative;
	display: flex;
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
}

:deep(.workbench__dockview) {
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
}
</style>
