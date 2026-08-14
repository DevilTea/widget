<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide } from 'vue'
import LabHeader from './components/LabHeader.vue'
import Workbench from './components/Workbench.vue'
import { createLabStore, LabStoreKey } from './composables/use-lab-store'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/dockview-theme.css'

const store = createLabStore()
provide(LabStoreKey, store)

function onKeydown(event: KeyboardEvent): void {
	// Cmd/Ctrl+Enter is a UX shortcut for the same Apply command the header button invokes.
	if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
		event.preventDefault()
		void store.apply()
	}
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
	window.removeEventListener('keydown', onKeydown)
	store.dispose()
})
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
