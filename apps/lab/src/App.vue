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
	</div>
</template>

<style scoped>
.lab-app {
	display: flex;
	flex-direction: column;
	height: 100%;
}
</style>
