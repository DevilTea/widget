<script setup lang="ts">
/**
 * Monaco-only — deliberately not forced into the inspector tree/detail layout the other panels share
 * (issue #13 Widget Lab Phase 4 "inspector panel interaction contract"). Source cursor/scroll are
 * Source-local; no authoritative source-position linking to Blueprint/Runtime exists yet.
 */
import { useLabStore } from '../../composables/use-lab-store'
import MonacoJsonEditor from '../editor/MonacoJsonEditor.vue'

const store = useLabStore()
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<div
			v-if="store.parseError.value !== null"
			:class="pika({ padding: '6px 10px', fontSize: '12px', color: 'var(--lab-color-danger)', background: 'color-mix(in srgb, var(--lab-color-danger) 12%, transparent)', borderBottom: '1px solid var(--lab-color-border)', fontFamily: 'var(--lab-font-mono)' })"
		>
			SyntaxError: {{ store.parseError.value.message }}
		</div>
		<div :class="pika({ flex: '1 1 auto', minHeight: '0' })">
			<MonacoJsonEditor
				:modelValue="store.draftSourceText.value"
				@update:modelValue="store.setDraftSourceText"
			/>
		</div>
	</div>
</template>
