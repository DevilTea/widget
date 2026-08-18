<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, provide, watchEffect } from 'vue'
import LabHeader from './components/LabHeader.vue'
import TutorialConfirmDialog from './components/tutorial/TutorialConfirmDialog.vue'
import TutorialRail from './components/tutorial/TutorialRail.vue'
import WelcomeCard from './components/tutorial/WelcomeCard.vue'
import Workbench from './components/Workbench.vue'
import { createImplementationExplorerStore, ImplementationExplorerKey } from './composables/use-implementation-explorer'
import { createLabI18nStore, LabI18nKey } from './composables/use-lab-i18n'
import { createLabStore, LabStoreKey } from './composables/use-lab-store'
import { createLabThemeStore, LabThemeKey } from './composables/use-lab-theme'
import { createTutorialStore, TutorialStoreKey } from './composables/use-tutorial'
import { disposeLayoutWorker } from './graph/layout-client'
import { installLabTestSeam } from './lab-test-seam'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/dockview-theme.css'
import './styles/tutorial-theme.css'

// #43/#44: locale and theme are independent presentation preferences. Neither depends on LabStore or
// semantic application state; descendants receive both before any semantic/runtime surface mounts.
const i18n = createLabI18nStore()
provide(LabI18nKey, i18n)
const theme = createLabThemeStore()
provide(LabThemeKey, theme)

const store = createLabStore()
provide(LabStoreKey, store)
// Issue #28 browser-contract seam (`?lab-test` only; inert otherwise) — see `lab-test-seam.ts`.
installLabTestSeam(store)

// issue #25 P3: a small store of its own (see `use-implementation-explorer.ts`'s file header for why
// this is a parallel mechanism rather than an extension of `LabStore.activeTab`), created/provided the
// same way `LabStore`/`TutorialStore` are, and handed to `createTutorialStore()` below so the Survey
// tour's step 8 "Implementation" link can open it too.
const implementationExplorer = createImplementationExplorerStore()
provide(ImplementationExplorerKey, implementationExplorer)

// issue #25 P1: `createTutorialStore(store, ...)` takes the already-created `LabStore`/
// `ImplementationExplorerStore` directly rather than injecting them back via `useLabStore()`/
// `useImplementationExplorer()` — `inject()` resolves against a component's *parent* provides, so a
// component can never see its own `provide()` call; passing them directly sidesteps that entirely.
const tutorial = createTutorialStore(store, implementationExplorer)
provide(TutorialStoreKey, tutorial)

const tutorialRailVisible = computed(() => tutorial.snapshot.value.status === 'active')

// Spotlight (issue #25 P1 Scope E): plain CSS class toggling on whichever element currently carries the
// current step's `data-tutorial-target` attribute — no position-cloned overlay. This lives in App.vue
// (rather than a per-panel component) because it is the one place with an unobstructed `document`-wide
// view across Preview renderers, panels, and the rail itself.
watchEffect(() => {
	const target = tutorialRailVisible.value ? (tutorial.snapshot.value.step?.target ?? null) : null
	for (const el of document.querySelectorAll('.tutorial-spotlight'))
		el.classList.remove('tutorial-spotlight')
	if (target !== null) {
		const el = document.querySelector(`[data-tutorial-target="${CSS.escape(target)}"]`)
		el?.classList.add('tutorial-spotlight')
	}
})

function onKeydown(event: KeyboardEvent): void {
	// Cmd/Ctrl+Enter is a UX shortcut for the same Apply command the header button invokes.
	if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
		event.preventDefault()
		void store.apply()
	}
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
// `store.dispose()` (which disposes the final active Runtime) runs from `onUnmounted`, not
// `onBeforeUnmount`: Vue only guarantees every descendant — including Workbench's Preview
// `WidgetRenderer` subtree — has fully unmounted by the time a component's own `onUnmounted` fires.
// `onBeforeUnmount` fires before children unmount, which would dispose the Runtime while Preview's
// widget bridges may still be live.
onUnmounted(() => store.dispose())
// Worker shutdown is app lifecycle cleanup (issue #13 Phase 5 "Dependency Graph worker loading"
// comment) — unrelated to widget-core Runtime ownership/disposal, which `store.dispose()` already owns.
onUnmounted(() => disposeLayoutWorker())
</script>

<template>
	<div class="lab-app">
		<LabHeader />
		<div class="lab-body">
			<Workbench />
			<TutorialRail v-if="tutorialRailVisible" />
		</div>
		<!--
			issue #25 P1 merge-gate review (blocker 1): both dialogs stay always-mounted now — each is a
			native `<dialog>` whose OWN `showModal()`/`close()` (via `useModalDialog`, driven one-way by
			`welcomeVisible`/`confirmVisible`) is the single thing that opens/closes it, mirroring
			`ModalRenderer.vue`'s semantic-widget pattern. A `v-if` here would race that: the same reactive
			flip that flows into `useModalDialog`'s watcher would also unmount the component from a
			different reactive path, with no ordering guarantee between "run the watcher's close/focus-
			restore logic" and "Vue tears down the component".
		-->
		<WelcomeCard />
		<TutorialConfirmDialog />
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

/*
 * issue #25 P1: `.lab-body` is the tutorial rail's `position: fixed` positioning reference in spirit
 * only — `TutorialRail.vue` actually positions itself against the viewport (`top`/`bottom`/`right: 0`),
 * not this container, since the rail must stay docked to the real right edge regardless of `.lab-body`'s
 * own box. This wrapper's job is narrower: give `Workbench` a sibling slot in the flex column without
 * disturbing `Workbench.vue`'s own `flex: 1 1 auto` sizing/`ResizeObserver` behavior — the rail, being
 * `position: fixed`, never participates in this flex layout at all, which is exactly what keeps
 * Workbench/Dockview's measured width unaffected by whether the rail is open (see `TutorialRail.vue`'s
 * header comment on the viewport contract).
 */
.lab-body {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
}

/*
 * issue #27 Finding 3: minimum supported workbench viewport, chosen at 900px width — narrower than that,
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
