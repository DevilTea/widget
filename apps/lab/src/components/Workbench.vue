<script setup lang="ts">
/**
 * The workbench (Lab UX phase 3B, design "information architecture"): a left tool group with three tabs, Edit | Explain |
 * Tools (Edit initially active, about half the width), and a persistent Preview on the right. The expert views of the Tools
 * menu (`lab/tools.ts`) open on request as their own closable, named tabs in a separate **Tools group** below the Preview,
 * never inside the Edit/Explain group, so what the user was reading on the left stays where it was. Dockview owns tabs,
 * resize and docking only; it never becomes the semantic model for the panels. The layout is saved to `localStorage` and
 * restored on reload without the Tools group (`lab/layout-storage.ts`); "Reset layout" in the overflow menu goes back to the
 * default.
 */
import type { DockviewApi, DockviewReadyEvent, DockviewTheme, IDockviewPanel, SerializedDockview, VueComponent } from 'dockview-vue'
import type { LabToolTab } from '../composables/use-lab-store'
import type { ToolId } from '../lab/tools'
import { DockviewVue, themeAbyss } from 'dockview-vue'
import { defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useDependenciesView } from '../composables/use-dependencies-view'
import { useDocumentTools } from '../composables/use-document-tools'
import { useImplementationExplorer } from '../composables/use-implementation-explorer'
import { useLabI18n } from '../composables/use-lab-i18n'
import { useLabStore } from '../composables/use-lab-store'
import { useWorkbenchLayout } from '../composables/use-workbench-layout'
import { CANONICAL_PANEL_IDS, clearSavedLayout, loadSavedLayout, saveLayout } from '../lab/layout-storage'
import { isToolId, TOOL_COMPONENTS, TOOL_IDS, TOOL_TEXT } from '../lab/tools'
import NonClosableTab from './NonClosableTab.vue'
import AuthorPanel from './panels/AuthorPanel.vue'
import BlueprintPanel from './panels/BlueprintPanel.vue'
import DependenciesPanel from './panels/DependenciesPanel.vue'
import EventsPanel from './panels/EventsPanel.vue'
import ExplainPanel from './panels/ExplainPanel.vue'
import RuntimePanel from './panels/RuntimePanel.vue'
import SelectedWidgetPanel from './panels/SelectedWidgetPanel.vue'
import ToolsPanel from './panels/ToolsPanel.vue'
import PreviewPanel from './preview/PreviewPanel.vue'
import ToolsGroupActions from './ToolsGroupActions.vue'

const store = useLabStore()
const i18n = useLabI18n()
const implementationExplorer = useImplementationExplorer()
const documentTools = useDocumentTools()
const workbenchLayout = useWorkbenchLayout()
const dependenciesView = useDependenciesView()

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
	edit: AuthorPanel as unknown as VueComponent,
	explain: ExplainPanel as unknown as VueComponent,
	tools: ToolsPanel as unknown as VueComponent,
	preview: PreviewPanel as unknown as VueComponent,
	// The expert views (Tools group). The panels are mounted only once a view is opened (Dockview creates a panel's
	// component when the panel is added); their code stays in the shell bundle, as it was when they were canonical tabs.
	blueprint: BlueprintPanel as unknown as VueComponent,
	runtime: RuntimePanel as unknown as VueComponent,
	events: EventsPanel as unknown as VueComponent,
	dependencies: DependenciesPanel as unknown as VueComponent,
	widget: SelectedWidgetPanel as unknown as VueComponent,
	// diagnostic #25 P3 Scope D: `defineAsyncComponent` (not a plain import) is the actual lazy boundary —
	// `ImplementationPanel.vue` and everything it statically imports (the curated-file viewer, Shiki)
	// only enter their own chunk once Dockview first mounts this component, which only happens once
	// the Implementation view has been opened at least once — never merely because this record exists.
	implementation: defineAsyncComponent(() => import('./panels/ImplementationPanel.vue')) as unknown as VueComponent,
	documentTools: defineAsyncComponent(() => import('./panels/DocumentToolsPanel.vue')) as unknown as VueComponent,
}

// diagnostic #27 Finding 2: the canonical panels' tab content renderer, close-button-free by construction
// (see NonClosableTab.vue) — selected per-panel below via `AddPanelOptions.tabComponent`. The expert views use Dockview's
// default tab, which has a close button (and closes with Delete on the focused tab).
const tabComponents: Record<string, VueComponent> = {
	nonClosable: NonClosableTab as unknown as VueComponent,
}

// The right-hand header action of every group; it draws the Tools group's Maximize / Restore button and nothing elsewhere.
const headerActions = ToolsGroupActions as unknown as VueComponent

/** How much of the right column's height a newly created Tools group takes from the Preview. */
const TOOLS_GROUP_SHARE = 0.5

const workbenchEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
// The watches and Dockview subscriptions below are only ever created from `onReady()`, a child-emitted event callback
// rather than `setup()`'s own synchronous body, so they are not reliably disposed with this component's effect scope:
// their stop handles are kept and called from `onBeforeUnmount` (diagnostic #25 P1 merge-gate review hygiene).
const stopHandles: (() => void)[] = []

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
	for (const stop of stopHandles.splice(0))
		stop()
})

/** The panels whose activation is mirrored in `LabStore.activeTab` (see `watchTabActivation`). */
const CANONICAL_TAB_IDS: ReadonlySet<string> = new Set<LabToolTab>(['edit', 'explain', 'tools', 'preview'])

/**
 * Tab titles follow the Lab language (set when a layout is built or restored, and again on a language switch). Widget
 * vocabulary (Preview) stays English.
 */
function canonicalTitles(): Readonly<Record<string, string>> {
	return {
		edit: i18n.t('Edit'),
		explain: i18n.t('Explain'),
		tools: i18n.t('Tools'),
		preview: 'Preview',
	}
}

/** The tab title of an expert view. Implementation sets its own (it names the selected widget, see `ImplementationPanel.vue`). */
function toolTitle(tool: ToolId): string {
	return i18n.t(TOOL_TEXT[tool].title)
}

/**
 * The default layout: the tool group (Edit, Explain, Tools; Edit active) left and the persistent Preview right. The Preview is
 * rendered with Dockview's `always` renderer: its content lives in Dockview's overlay container and is only positioned over its
 * group, so splitting its column for the Tools group (which moves the group's element into a new branch) does not move the
 * Preview's iframe in the DOM, which would reload it and drop the running Runtime's connection. The tool
 * area is wide on purpose (audit U12: Relations and the Implementation source are clipped in a column of about 29%): about
 * half the workbench, between 420 and 940px. There is no Tools group until a view is opened. Users may resize the divider
 * afterwards (Dockview owns that) and the result is remembered.
 */
function buildDefaultLayout(api: DockviewApi): void {
	const titles = canonicalTitles()
	// `tabComponent: 'nonClosable'` on every canonical panel (diagnostic #27 Finding 2) — see
	// NonClosableTab.vue/tabComponents above for the mechanism.
	api.addPanel({ id: 'edit', component: 'edit', tabComponent: 'nonClosable', title: titles.edit })
	for (const id of ['explain', 'tools']) {
		api.addPanel({
			id,
			component: id,
			tabComponent: 'nonClosable',
			title: titles[id],
			position: { referencePanel: 'edit', direction: 'within' },
			inactive: true,
		})
	}
	api.addPanel({
		id: 'preview',
		component: 'preview',
		tabComponent: 'nonClosable',
		title: titles.preview,
		position: { referencePanel: 'edit', direction: 'right' },
		renderer: 'always',
	})

	const toolWidth = Math.round(Math.max(420, Math.min(940, api.width * 0.48)))
	api.getPanel('edit')?.group.api.setSize({ width: toolWidth })
}

/**
 * Restores the saved layout if there is a usable one. A layout Dockview cannot load (it can still throw for data
 * that looks right) is discarded for good and the default is built instead. The expert views are not in the loaded
 * layout at all (`loadSavedLayout` strips them), so the Tools group is not restored and none can leave a neighbour active.
 * The restored active panel is written to `LabStore.activeTab` here, because the Dockview-to-store subscription
 * (`watchTabActivation`) is made after the restore.
 */
function restoreOrBuildLayout(api: DockviewApi): void {
	const saved = loadSavedLayout()
	if (saved !== null) {
		try {
			api.fromJSON(saved as unknown as SerializedDockview)
			const titles = canonicalTitles()
			for (const id of CANONICAL_PANEL_IDS)
				api.getPanel(id)?.api.setTitle(titles[id] ?? id)
			api.getPanel('preview')?.api.setRenderer('always')
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
	stopHandles.push(() => {
		subscription.dispose()
		window.removeEventListener('pagehide', flush)
		if (timer !== null)
			clearTimeout(timer)
	})
}

/** Tab titles follow a language switch (they used to be fixed when the panel was added). */
function watchTitleLocale(api: DockviewApi): void {
	stopHandles.push(watch(i18n.locale, () => {
		const titles = canonicalTitles()
		for (const id of CANONICAL_PANEL_IDS)
			api.getPanel(id)?.api.setTitle(titles[id] ?? id)
		for (const tool of TOOL_IDS) {
			if (tool !== 'implementation')
				api.getPanel(tool)?.api.setTitle(toolTitle(tool))
		}
	}))
}

/** "Reset layout" (overflow menu): forget the saved layout and go back to the default one, without the Tools group. */
function watchLayoutResetRequests(api: DockviewApi): void {
	stopHandles.push(watch(
		() => workbenchLayout.resetRequestTick.value,
		() => {
			clearSavedLayout()
			// A maximized Tools group is left first, so nothing of it outlives the rebuilt default.
			if (api.hasMaximizedGroup())
				api.exitMaximizedGroup()
			// The Dependencies view is shared per store, not the rebuilt panel's own state: a reset starts it over at Relations too.
			dependenciesView.reset()
			api.clear()
			buildDefaultLayout(api)
			store.activeTab.value = 'edit'
			api.getPanel('edit')?.api.setActive()
			// The rebuilt grid has the size the old one had, so Dockview sees no resize and never positions the Preview's overlay
			// (the `always` renderer): it stayed hidden until the window was resized. A forced layout positions it.
			requestAnimationFrame(() => {
				const el = workbenchEl.value
				if (el !== null)
					api.layout(el.clientWidth, el.clientHeight, true)
			})
		},
	))
}

/** Keeps `LabStore.openTools` (the Tools menu marks the open views) in step with Dockview. */
function trackOpenTools(api: DockviewApi): void {
	const sync = (): void => {
		store.openTools.value = new Set(api.panels.map(panel => panel.id)
			.filter(isToolId))
		// Dockview leaves a maximized group when that group goes away; this only makes sure no maximized state outlives the last view.
		if (store.openTools.value.size === 0 && api.hasMaximizedGroup())
			api.exitMaximizedGroup()
	}
	sync()
	const added = api.onDidAddPanel(sync)
	const removed = api.onDidRemovePanel(sync)
	stopHandles.push(() => {
		added.dispose()
		removed.dispose()
	})
}

function onReady(event: DockviewReadyEvent): void {
	const { api } = event

	restoreOrBuildLayout(api)

	observeSize(api)
	persistLayoutChanges(api)
	watchLayoutResetRequests(api)
	watchTitleLocale(api)
	watchTabActivation(api)
	trackOpenTools(api)
	watchToolOpenRequests(api)
}

/**
 * The tab-activation bridge (diagnostic #25 P1): `LabStore.showTab()` requests activate that canonical panel
 * (`DockviewPanelApi.setActive()`), and Dockview's active canonical panel is mirrored into `LabStore.activeTab`. Requests are
 * objects with a tick (since the phase 3B review), so asking for the tab that is already `activeTab` still restores a
 * maximized Tools group and shows it; `activeTab` itself is only state.
 */
function watchTabActivation(api: DockviewApi): void {
	// Every `LabStore.showTab()` request is handled, the same tab as the active one included (a request object, like
	// `toolOpenRequest`): a maximized Tools group hides the tab even when it is the active one, so a request is first a restore.
	const stopWatch = watch(
		() => store.tabRequest.value,
		(request) => {
			if (request === null)
				return
			const panel = api.getPanel(request.tab)
			if (panel === undefined)
				return
			if (api.hasMaximizedGroup() && !panel.group.api.isMaximized())
				api.exitMaximizedGroup()
			// Activating moves DOM focus (into the panel's group), so a tab that is already shown and active is left alone: the
			// requester (Show problems) moves focus where it belongs itself.
			if (api.activePanel?.id !== request.tab || panel.group.activePanel?.id !== request.tab)
				panel.api.setActive()
		},
	)
	// The tool group's own shown panel (Lab UX phase 2): `activeTab` follows whichever group is active, often the Preview's
	// or the Tools group's, so the tutorial records this one to restore. The tool group is the group that holds Edit.
	const syncToolGroupTab = (): void => {
		const shown = api.getPanel('edit')?.group.activePanel?.id
		store.toolGroupTab.value = shown !== undefined && shown !== 'preview' && CANONICAL_TAB_IDS.has(shown) ? shown as LabToolTab : null
	}
	syncToolGroupTab()
	const activePanelChange = api.onDidActivePanelChange(({ panel }) => {
		if (panel !== undefined && CANONICAL_TAB_IDS.has(panel.id))
			store.activeTab.value = panel.id as LabToolTab
		syncToolGroupTab()
	})
	stopHandles.push(() => {
		stopWatch()
		activePanelChange.dispose()
	})
}

/**
 * Dockview closes the focused tab on Delete or Backspace (its tab strip's own keyboard handling), whatever its tab renderer draws, so a
 * canonical tab (Edit, Explain, Tools, Preview) could be closed from the keyboard and never come back short of "Reset layout". Opening a
 * view now moves focus onto tabs often, so the key is stopped here, in the capture phase, before it reaches the tab strip, for a tab
 * drawn by `NonClosableTab.vue` (`data-non-closable`). An expert view's tab still closes with it.
 */
function guardCanonicalTabClose(event: KeyboardEvent): void {
	if (event.key !== 'Delete' && event.key !== 'Backspace')
		return
	const target = event.target
	if (!(target instanceof HTMLElement) || !target.matches('.dv-tab'))
		return
	if (target.querySelector('[data-non-closable]') !== null)
		event.stopPropagation()
}

/** Moves keyboard focus to the tab of `panel` (its group's selected tab), once Dockview has laid it out. */
function focusTabOf(panel: IDockviewPanel): void {
	void nextTick(() => requestAnimationFrame(() => {
		if (panel.group.activePanel?.id !== panel.id)
			return
		panel.group.element.querySelector<HTMLElement>('.dv-tabs-container [role="tab"][aria-selected="true"]')
			?.focus()
	}))
}

/**
 * Opens an expert view (Lab UX phase 3B): adds its panel to the Tools group, or activates the tab that is already open, and
 * moves keyboard focus to that tab, so its name is announced and the panel the user was reading stays on screen.
 *
 * The Tools group is a group that holds an expert view and none of the canonical panels: the view is added `within` it. When
 * there is none (no view open yet, or the user dragged every view elsewhere), a new group is created **below the Preview**,
 * with half of its height: beside the Preview, the right column keeps its full width for the Preview and for the views that
 * need it (Implementation source, Relations, the Graph), and the left column (Edit/Explain) is not touched.
 */
function openToolPanel(api: DockviewApi, tool: ToolId): void {
	const existing = api.getPanel(tool)
	if (existing !== undefined) {
		existing.api.setActive()
		focusTabOf(existing)
		return
	}
	const anchor = api.panels.find(panel => isToolId(panel.id) && !panel.group.panels.some(member => CANONICAL_TAB_IDS.has(member.id)))
	const preview = api.getPanel('preview')
	// Measured before the split: half of the column the Preview has now.
	const toolsHeight = preview === undefined ? 0 : Math.round(Math.max(240, preview.group.api.height * TOOLS_GROUP_SHARE))
	const panel = api.addPanel({
		id: tool,
		component: TOOL_COMPONENTS[tool],
		title: toolTitle(tool),
		position: anchor !== undefined
			? { referencePanel: anchor.id, direction: 'within' }
			: preview !== undefined
				? { referencePanel: preview.id, direction: 'below' }
				: { direction: 'right' },
	})
	if (anchor === undefined && preview !== undefined)
		panel.group.api.setSize({ height: toolsHeight })
	focusTabOf(panel)
}

/**
 * Every way to open an expert view lands here: `LabStore.openTool()` for the views without request metadata, and the
 * Implementation explorer's and Document Tools' own request stores. Not `immediate`: each request bumps a tick, so the
 * watches only ever fire on an actual request, never at setup time.
 */
function watchToolOpenRequests(api: DockviewApi): void {
	stopHandles.push(
		watch(() => store.toolOpenRequest.value, (request) => {
			if (request !== null)
				openToolPanel(api, request.tool)
		}),
		watch(() => implementationExplorer.openRequestTick.value, () => openToolPanel(api, 'implementation')),
		watch(() => documentTools.openRequestTick.value, () => openToolPanel(api, 'document-tools')),
	)
}
</script>

<template>
	<div
		ref="workbenchEl"
		class="workbench"
		@keydown.capture="guardCanonicalTabClose"
	>
		<DockviewVue
			class="workbench__dockview"
			:theme="labTheme"
			:components="components"
			:tabComponents="tabComponents"
			:rightHeaderActionsComponent="headerActions"
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
