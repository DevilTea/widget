<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, provide, watch, watchEffect } from 'vue'
import DraftGuardDialog from './components/DraftGuardDialog.vue'
import LabHeader from './components/LabHeader.vue'
import TutorialConfirmDialog from './components/tutorial/TutorialConfirmDialog.vue'
import TutorialRail from './components/tutorial/TutorialRail.vue'
import WelcomeCard from './components/tutorial/WelcomeCard.vue'
import Workbench from './components/Workbench.vue'
import { createDocumentToolsStore, DocumentToolsKey } from './composables/use-document-tools'
import { createDraftGuardStore, DraftGuardKey } from './composables/use-draft-guard'
import { createImplementationExplorerStore, ImplementationExplorerKey } from './composables/use-implementation-explorer'
import { createLabI18nStore, LabI18nKey } from './composables/use-lab-i18n'
import { createLabStore, LabStoreKey } from './composables/use-lab-store'
import { createLabThemeStore, LabThemeKey } from './composables/use-lab-theme'
import { useNuxtUiThemeBridge } from './composables/use-nuxt-ui-theme-bridge'
import { useSupportedWorkbenchViewport } from './composables/use-supported-workbench-viewport'
import { createTutorialStore, TutorialStoreKey } from './composables/use-tutorial'
import { createWorkbenchLayoutStore, WorkbenchLayoutKey } from './composables/use-workbench-layout'
import { disposeLayoutWorker } from './graph/layout-client'
import { installLabTestSeam } from './lab-test-seam'
import { resolveInitialShowcase, urlWithShowcase } from './showcases/registry'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/dockview-theme.css'
import './styles/tutorial-theme.css'

// #43/#44: locale and theme are independent presentation preferences. Neither depends on LabStore or
// semantic application state; descendants receive both before any semantic/runtime surface mounts.
const i18n = createLabI18nStore()
provide(LabI18nKey, i18n)
const theme = createLabThemeStore()
provide(LabThemeKey, theme)
// Nuxt UI's `.dark` class follows the Lab theme store (the single source of truth); see the composable.
useNuxtUiThemeBridge(theme.theme)

// `?showcase=<id>` picks the starting showcase (also hidden test fixtures such as `sandbox`); unknown ids
// fall back to the default. See `showcases/registry.ts`'s `resolveInitialShowcase`.
const store = createLabStore(resolveInitialShowcase(location.search))
provide(LabStoreKey, store)
// Keep `?showcase=<id>` in the address bar in sync with the active showcase (no history entry), so a reload
// restores it. The hidden Sandbox fixture is written too: the URL always names what is open.
watch(store.showcaseId, (id) => {
	history.replaceState(history.state, '', urlWithShowcase(location.href, id))
}, { immediate: true })
// Diagnostic #28 browser-contract seam (`?lab-test` only; inert otherwise) — see `lab-test-seam.ts`.
installLabTestSeam(store)

// diagnostic #25 P3: a small store of its own (see `use-implementation-explorer.ts`'s file header for why
// this is a parallel mechanism rather than an extension of `LabStore.activeTab`), created/provided the
// same way `LabStore`/`TutorialStore` are, and handed to `createTutorialStore()` below so the Survey
// tour's step 8 "Implementation" link can open it too.
const implementationExplorer = createImplementationExplorerStore()
provide(ImplementationExplorerKey, implementationExplorer)

// Phase 6: Document Tools parallels the Implementation explorer — a small request store for a lazy,
// closable developer panel, while all Document data remains owned by LabSession/WidgetDocument.
const documentTools = createDocumentToolsStore()
provide(DocumentToolsKey, documentTools)

// "Reset layout" (overflow menu) is a request that Workbench carries out on its Dockview instance.
provide(WorkbenchLayoutKey, createWorkbenchLayoutStore())

// diagnostic #25 P1: `createTutorialStore(store, ...)` takes the already-created `LabStore`/
// `ImplementationExplorerStore` directly rather than injecting them back via `useLabStore()`/
// `useImplementationExplorer()` — `inject()` resolves against a component's *parent* provides, so a
// component can never see its own `provide()` call; passing them directly sidesteps that entirely.
const tutorial = createTutorialStore(store, implementationExplorer)
provide(TutorialStoreKey, tutorial)

// Unapplied-draft confirmation for loading a preset / switching showcase (audit U03).
const draftGuard = createDraftGuardStore(store)
provide(DraftGuardKey, draftGuard)

const tutorialRailVisible = computed(() => tutorial.snapshot.value.status === 'active')

// Spotlight (diagnostic #25 P1 Scope E): plain CSS class toggling on whichever element currently carries the
// current step's `data-tutorial-target` attribute — no position-cloned overlay. This lives in App.vue
// (rather than a per-panel component) because it is the one place with an unobstructed `document`-wide
// view across Preview renderers, panels, and the rail itself.
function applySpotlight(target: string | null): void {
	for (const el of document.querySelectorAll('.tutorial-spotlight'))
		el.classList.remove('tutorial-spotlight')
	if (target !== null) {
		const el = document.querySelector(`[data-tutorial-target="${CSS.escape(target)}"]`)
		el?.classList.add('tutorial-spotlight')
	}
}
// After the render (`flush: 'post'`), and once more in the next frame: a step whose target is in a workbench panel (the survey tour's
// Structure step, Lab UX phase 2) also activates that panel in its `onEnter`, and Dockview attaches an inactive panel's element to the
// document only once it is active, so the element may not be in the page when the step changes.
watchEffect(() => {
	const target = tutorialRailVisible.value ? (tutorial.snapshot.value.step?.target ?? null) : null
	applySpotlight(target)
	requestAnimationFrame(() => {
		const current = tutorialRailVisible.value ? (tutorial.snapshot.value.step?.target ?? null) : null
		if (current === target)
			applySpotlight(target)
	})
	// Preview lives in a separate document; project the same semantic target through the host.
	store.previewHost.setTutorialSpotlight(target)
}, { flush: 'post' })

// Presentation mirror of the CSS narrow-viewport gate: while unsupported, the still-mounted workbench is
// made `inert` so it cannot be focused or tabbed to behind the overlay (it stays mounted, per #27).
const supportedViewport = useSupportedWorkbenchViewport()

/**
 * Cmd/Ctrl+Enter is a UX shortcut for the same Apply command the header button invokes, so it honors the
 * button's enabled condition (`canApply`). Who gets the event first is deliberate:
 *
 * - Everything except Dockview tabs is handled in the BUBBLE phase, so a control that owns Enter wins
 *   (`defaultPrevented` is honoured; a Graph node's `@keydown.enter.prevent.stop` never reaches here at all).
 * - Dockview's tab buttons preventDefault Enter themselves (it activates the tab), so by the bubble phase a focused
 *   tab's event always looks "already handled" and Apply would never fire from it (audit U05). Events whose
 *   target is inside a tab are therefore handled in the CAPTURE phase, which runs before the tab's own handler;
 *   the handler then prevents the default, so the bubble listener below skips the same event.
 *
 * It yields to IME composition (keyCode 229 covers engines that report it without `isComposing`), key repeat, the
 * editor itself (Monaco binds Cmd/Ctrl+Enter to "insert line"; `use-monaco-editor.ts` registers the same
 * Apply as an editor action, so letting both run would Apply twice), open menus (Enter selects an item there),
 * open modal dialogs, and the narrow-viewport gate (the workbench is `inert` behind it).
 */
function applyOnShortcut(event: KeyboardEvent): void {
	if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey))
		return
	if (event.isComposing || event.keyCode === 229 || event.repeat || event.defaultPrevented)
		return
	if (event.target instanceof Element && event.target.closest('.monaco-editor, [role="menu"]') !== null)
		return
	if (tutorial.welcomeVisible.value || tutorial.confirmVisible.value || draftGuard.confirmVisible.value)
		return
	if (!supportedViewport.value)
		return
	if (!store.canApply.value)
		return
	event.preventDefault()
	void store.apply()
}

function onKeydownCapture(event: KeyboardEvent): void {
	if (event.target instanceof Element && event.target.closest('.dv-tab') !== null)
		applyOnShortcut(event)
}

onMounted(() => {
	window.addEventListener('keydown', onKeydownCapture, true)
	window.addEventListener('keydown', applyOnShortcut)
})
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKeydownCapture, true)
	window.removeEventListener('keydown', applyOnShortcut)
})
// `store.dispose()` (which disposes the final active Runtime) runs from `onUnmounted`, not
// `onBeforeUnmount`: Vue only guarantees every descendant — including Workbench's Preview
// `WidgetRenderer` subtree — has fully unmounted by the time a component's own `onUnmounted` fires.
// `onBeforeUnmount` fires before children unmount, which would dispose the Runtime while Preview's
// widget bridges may still be live.
onUnmounted(() => store.dispose())
// Worker shutdown is app lifecycle cleanup (diagnostic #13 Phase 5 "Dependency Graph worker loading"
// comment) — unrelated to widget-core Runtime ownership/disposal, which `store.dispose()` already owns.
onUnmounted(() => disposeLayoutWorker())
</script>

<template>
	<div class="lab-app">
		<!-- `display: contents` keeps header/body direct flex items of `.lab-app`; the wrapper only carries `inert`. -->
		<div
			class="lab-covered"
			:inert="!supportedViewport"
		>
			<LabHeader />
			<div class="lab-body">
				<Workbench />
				<TutorialRail v-if="tutorialRailVisible" />
			</div>
		</div>
		<!--
			diagnostic #25 P1 merge-gate review (blocker 1): both dialogs stay always-mounted now — each is a
			native `<dialog>` whose OWN `showModal()`/`close()` (via `useModalDialog`, driven one-way by
			`welcomeVisible`/`confirmVisible`) is the single thing that opens/closes it, mirroring
			`ModalRenderer.vue`'s semantic-widget pattern. A `v-if` here would race that: the same reactive
			flip that flows into `useModalDialog`'s watcher would also unmount the component from a
			different reactive path, with no ordering guarantee between "run the watcher's close/focus-
			restore logic" and "Vue tears down the component".
		-->
		<WelcomeCard />
		<TutorialConfirmDialog />
		<DraftGuardDialog />
		<div
			class="narrow-viewport-gate"
			role="alert"
		>
			<p>{{ i18n.t('Widget Lab is designed for a desktop-sized viewport. Widen the window to continue.') }}</p>
		</div>
	</div>
</template>

<style scoped>
.lab-app {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.lab-covered {
	display: contents;
}

/*
 * `.lab-body` is a flex row below the header: the workbench takes the remaining width and the tutorial rail,
 * when open, is a fixed-width column beside it (issue #230 PR 3b, audit U13; it used to be `position: fixed`
 * and then `absolute`, both of which covered what was under them). `Workbench.vue` observes its own size, so
 * Dockview re-lays out when the rail opens or closes; the header, the overflow menu and the Preview frame are
 * never under the rail.
 */
.lab-body {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
}

/*
 * diagnostic #27 Finding 3: minimum supported workbench viewport, chosen at 900px width — narrower than that,
 * Dockview's default two-column split (tool group + Preview, each with a meaningful minimum width) no
 * longer has room to lay out usefully (see Workbench.vue's `toolWidth` clamp), so this app is not a
 * supported experience below the threshold. A pure CSS media query (no JS resize listener/state) shows a
 * blocking explanatory overlay instead of a degraded layout; it disappears the instant the viewport
 * widens back past the threshold. `position: fixed` pins it to the actual viewport rather than the
 * document, so it still fully covers the workbench even if underlying content is scrolled horizontally.
 * The underlying app (`Workbench`/Dockview) is left mounted, not torn down.
 */
.narrow-viewport-gate {
	display: none;
}

@media (max-width: 899px) {
	.narrow-viewport-gate {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		text-align: center;
		background: var(--lab-color-bg);
		color: var(--lab-color-text);
		font-family: var(--lab-font-sans);
		font-size: 14px;
		line-height: 1.5;
	}
}
</style>
