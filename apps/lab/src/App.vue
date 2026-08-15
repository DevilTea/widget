<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, provide } from 'vue'
import LabHeader from './components/LabHeader.vue'
import Workbench from './components/Workbench.vue'
import { createLabStore, LabStoreKey } from './composables/use-lab-store'
import { disposeLayoutWorker } from './graph/layout-client'
import { installLabTestSeam } from './lab-test-seam'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/dockview-theme.css'

const store = createLabStore()
provide(LabStoreKey, store)
// Issue #28 browser-contract seam (`?lab-test` only; inert otherwise) — see `lab-test-seam.ts`.
installLabTestSeam(store)

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
		<Workbench />
		<div
			class="narrow-viewport-gate"
			role="alert"
		>
			<p>Widget Lab is designed for a desktop-sized viewport. Widen the window to continue.</p>
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
