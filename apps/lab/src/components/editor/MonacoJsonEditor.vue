<script setup lang="ts">
/**
 * Local component boundary around the Monaco integration (`useMonacoJsonEditor`). Nothing outside
 * this file imports `modern-monaco` directly. Styling stays scoped here rather than joining the
 * application-wide PikaCSS surface.
 */
import type { EditorMarker } from '../../composables/use-monaco-editor'
import { computed, ref, watch } from 'vue'
import { useMonacoJsonEditor } from '../../composables/use-monaco-editor'

const props = withDefaults(defineProps<{
	modelValue: string
	/** Error squiggles over ranges of `modelValue`. */
	markers?: readonly EditorMarker[]
}>(), { markers: () => [] })

const emit = defineEmits<{
	'update:modelValue': [value: string]
	/** Cmd/Ctrl+Enter inside the editor. */
	'apply': []
}>()

const container = ref<HTMLElement | null>(null)
const modelValueRef = ref(props.modelValue)

// `modelValue` is a plain prop (not a ref), so the composable's internal `watch(options.modelValue)`
// needs a ref that tracks it — the parent still owns the authoritative text (`LabSession.draftSourceText`).
watch(() => props.modelValue, (next) => {
	modelValueRef.value = next
})

const markersRef = computed(() => props.markers)

const { revealRange } = useMonacoJsonEditor(container, {
	modelValue: modelValueRef,
	onChange: text => emit('update:modelValue', text),
	markers: markersRef,
	onApply: () => emit('apply'),
})

defineExpose({ revealRange })
</script>

<template>
	<div
		ref="container"
		data-testid="json-editor"
		:data-marker-count="markers.length"
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
