<script setup lang="ts">
/**
 * Local component boundary around the Monaco integration (`useMonacoJsonEditor`). Nothing outside
 * this file imports `modern-monaco` directly. Styling stays scoped here rather than joining the
 * application-wide PikaCSS surface.
 */
import { ref, watch } from 'vue'
import { useMonacoJsonEditor } from '../../composables/use-monaco-editor'

const props = defineProps<{
	modelValue: string
}>()

const emit = defineEmits<{
	'update:modelValue': [value: string]
}>()

const container = ref<HTMLElement | null>(null)
const modelValueRef = ref(props.modelValue)

// `modelValue` is a plain prop (not a ref), so the composable's internal `watch(options.modelValue)`
// needs a ref that tracks it — the parent still owns the authoritative text (`LabSession.draftSourceText`).
watch(() => props.modelValue, (next) => {
	modelValueRef.value = next
})

useMonacoJsonEditor(container, {
	modelValue: modelValueRef,
	onChange: text => emit('update:modelValue', text),
})
</script>

<template>
	<div
		ref="container"
		class="monaco-json-editor"
	/>
</template>

<style scoped>
.monaco-json-editor {
	width: 100%;
	height: 100%;
	min-height: 0;
}
</style>
