<script setup lang="ts">
/**
 * Default two-column workbench (issue #13 Widget Lab Phase 4 Checkpoint I): a left tool group with
 * tabs Source | Blueprint | Runtime | Graph (Source initially active, ~35-40% width) and a persistent
 * Preview on the right (~60-65% width, the dominant surface). Dockview owns tabs/resize/docking only —
 * it never becomes the semantic model for Source/Blueprint/Runtime/Graph/Preview.
 */
import type { DockviewApi, DockviewReadyEvent, DockviewTheme, VueComponent } from 'dockview-vue'
import { DockviewVue, themeAbyss } from 'dockview-vue'
import { defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useImplementationExplorer } from '../composables/use-implementation-explorer'
import { useLabStore } from '../composables/use-lab-store'
import NonClosableTab from './NonClosableTab.vue'
import BlueprintPanel from './panels/BlueprintPanel.vue'
import GraphPanel from './panels/GraphPanel.vue'
import RuntimePanel from './panels/RuntimePanel.vue'
import SourcePanel from './panels/SourcePanel.vue'
import PreviewPanel from './preview/PreviewPanel.vue'

const store = useLabStore()
const implementationExplorer = useImplementationExplorer()

/**
 * Dockview applies its theme via the `theme` option's `className` (dockview-core stamps it on its own
 * internal `.dv-shell` container), not via ambient CSS-class inheritance from an ancestor — passing
 * `class="dockview-theme-lab"` on `<DockviewVue>` itself only reaches the *outer* host element, one
 * level above where dockview-core would otherwise apply its own default (`dockview-theme-abyss`) and
 * shadow any same-named `--dv-*` custom properties set higher up. Basing this on `themeAbyss` keeps
 * its non-color layout defaults (gap, tab indicator, drag overlay, ...); only `className` changes, to
 * the small custom theme in `src/styles/dockview-theme.css` whose variables derive from PikaCSS
 * tokens.
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
	source: SourcePanel as unknown as VueComponent,
	blueprint: BlueprintPanel as unknown as VueComponent,
	runtime: RuntimePanel as unknown as VueComponent,
	graph: GraphPanel as unknown as VueComponent,
	preview: PreviewPanel as unknown as VueComponent,
	// issue #25 P3 Scope D: `defineAsyncComponent` (not a plain import) is the actual lazy boundary —
	// `ImplementationPanel.vue` and everything it statically imports (the curated-file viewer, Shiki)
	// only enter their own chunk once Dockview first mounts this component, which only happens once
	// `implementationExplorer.open()` has been called at least once (see `watchImplementationOpenRequests`
	// below) — never merely because this record exists.
	implementation: defineAsyncComponent(() => import('./panels/ImplementationPanel.vue')) as unknown as VueComponent,
}

// issue #27 Finding 2: the canonical panels' tab content renderer, close-button-free by construction
// (see NonClosableTab.vue) — selected per-panel below via `AddPanelOptions.tabComponent`.
const tabComponents: Record<string, VueComponent> = {
	nonClosable: NonClosableTab as unknown as VueComponent,
}

const workbenchEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null
// Merge-gate review hygiene note (issue #25 P1): `watchTutorialTabActivation()` below is only ever
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
})

function onReady(event: DockviewReadyEvent): void {
	const { api } = event

	// `tabComponent: 'nonClosable'` on every canonical panel (issue #27 Finding 2) — see
	// NonClosableTab.vue/tabComponents above for the mechanism.
	api.addPanel({ id: 'source', component: 'source', tabComponent: 'nonClosable', title: 'Source' })
	api.addPanel({
		id: 'blueprint',
		component: 'blueprint',
		tabComponent: 'nonClosable',
		title: 'Blueprint',
		position: { referencePanel: 'source', direction: 'within' },
		inactive: true,
	})
	api.addPanel({
		id: 'runtime',
		component: 'runtime',
		tabComponent: 'nonClosable',
		title: 'Runtime',
		position: { referencePanel: 'source', direction: 'within' },
		inactive: true,
	})
	api.addPanel({
		id: 'graph',
		component: 'graph',
		tabComponent: 'nonClosable',
		title: 'Graph',
		position: { referencePanel: 'source', direction: 'within' },
		inactive: true,
	})
	api.addPanel({
		id: 'preview',
		component: 'preview',
		tabComponent: 'nonClosable',
		title: 'Preview',
		position: { referencePanel: 'source', direction: 'right' },
	})

	// Default ~35-40% / ~60-65% split. Users may resize the divider afterwards (Dockview owns that).
	const toolWidth = Math.round(Math.max(360, Math.min(560, api.width * 0.38)))
	api.getPanel('source')?.group.api.setSize({ width: toolWidth })

	observeSize(api)
	watchTutorialTabActivation(api)
	watchImplementationOpenRequests(api)
}

/**
 * The minimal "tab-activation bridge" issue #25 P1's Survey tour view-map step (and its "See it in
 * Runtime" link) needs: `LabStore.activeTab` already existed as a plain `Ref<LabToolTab>` with no
 * observable effect on Dockview — this is the one place that makes assigning it actually switch the
 * visible tab, via `DockviewApi.getPanel(id)?.api.setActive()` (`dockview-core`'s
 * `DockviewPanelApi.setActive()`). One-directional on purpose (Dockview -> `activeTab` is not wired):
 * nothing outside the tutorial reads `activeTab` today, so keeping this minimal avoids a second source
 * of truth for "which tab is active" that the rest of the shell would have to stay in sync with.
 */
function watchTutorialTabActivation(api: DockviewApi): void {
	stopTutorialTabActivationWatch = watch(
		() => store.activeTab.value,
		(tab) => {
			api.getPanel(tab)?.api.setActive()
		},
	)
}

/**
 * Issue #25 P3 Scope D "Opening = `api.addPanel` if absent else activate". Deliberately not `immediate`
 * (matching `watchTutorialTabActivation` above): `openRequestTick` starts at `0` and every real
 * `open()` call increments it, so the watch only ever fires on an actual request, never at setup time.
 * The Implementation panel is added `within` the same tab group as Source/Blueprint/Runtime/Graph, with
 * NO `tabComponent` override — Dockview's own default tab (close button included) is exactly the
 * "closable, default tab component" the panel is specified to use, unlike the five canonical panels'
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
				title: 'Implementation',
				position: { referencePanel: 'source', direction: 'within' },
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
	min-height: 0;
}

:deep(.workbench__dockview) {
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
}
</style>
