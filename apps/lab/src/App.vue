<script setup lang="ts">
import { computed, onUnmounted, provide, watch, watchEffect } from 'vue'
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
import { createToolOpener } from './composables/use-open-tool'
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
// same way `LabStore`/`TutorialStore` are. With Document Tools and `LabStore.openTool()` it is how the expert views of the
// Tools tab are opened (Lab UX phase 3B, `use-open-tool.ts`), also by the tutorial (below).
const implementationExplorer = createImplementationExplorerStore()
provide(ImplementationExplorerKey, implementationExplorer)

// Phase 6: Document Tools parallels the Implementation explorer — a small request store for a lazy,
// closable developer panel, while all Document data remains owned by LabSession/WidgetDocument.
const documentTools = createDocumentToolsStore()
provide(DocumentToolsKey, documentTools)

// "Reset layout" (overflow menu) is a request that Workbench carries out on its Dockview instance.
provide(WorkbenchLayoutKey, createWorkbenchLayoutStore())

// diagnostic #25 P1: `createTutorialStore(store, ...)` takes the already-created `LabStore` and a tool opener over the
// request stores directly rather than injecting them back via `useLabStore()`/`useOpenTool()` — `inject()` resolves against a component's *parent* provides, so a
// component can never see its own `provide()` call; passing them directly sidesteps that entirely.
const tutorial = createTutorialStore(store, createToolOpener(store, implementationExplorer, documentTools))
provide(TutorialStoreKey, tutorial)

// Confirmation for loading a preset / switching showcase over JSON text that does not parse or committed edits (audit U03).
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
// The Author view is a dependency too: a target inside it (the Structure pane) is a new element after the view changes (JSON ->
// Structure during the edit step), so the class is put on the new one. That is the only remount a target sees today.
watchEffect(() => {
	const target = tutorialRailVisible.value ? (tutorial.snapshot.value.step?.target ?? null) : null
	void store.authorView.value
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

// Lab UX phase 3: there is no Apply, so Cmd/Ctrl+Enter has no window-wide meaning any more. Inside the JSON editor it commits
// the text at once (an editor action, `use-monaco-editor.ts`); a Structure text box commits on Enter itself.

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
