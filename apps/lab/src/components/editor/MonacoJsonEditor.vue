<script setup lang="ts">
/**
 * Local component boundary around the Monaco integration (`useMonacoJsonEditor`). Nothing outside
 * this file imports `modern-monaco` directly. Styling stays scoped here rather than joining the
 * application-wide stylesheets.
 */
import type { EditorMarker } from '../../composables/use-monaco-editor'
import { computed, ref, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useMonacoJsonEditor } from '../../composables/use-monaco-editor'

const props = withDefaults(defineProps<{
	modelValue: string
	/** Error squiggles over ranges of `modelValue`. */
	markers?: readonly EditorMarker[]
}>(), { markers: () => [] })

const emit = defineEmits<{
	'update:modelValue': [value: string]
	/** Cmd/Ctrl+Enter inside the editor: commit the text now. */
	'commit': []
	/** The editor got keyboard focus (an editing session starts). */
	'focus': []
	/** The editor lost keyboard focus, or went away while it had it (the editing session ends). */
	'blur': []
}>()

const container = ref<HTMLElement | null>(null)
const modelValueRef = ref(props.modelValue)

// `modelValue` is a plain prop (not a ref), so the composable's internal `watch(options.modelValue)`
// needs a ref that tracks it — the parent still owns the authoritative text (`LabSession.draftSourceText`).
watch(() => props.modelValue, (next) => {
	modelValueRef.value = next
})

const markersRef = computed(() => props.markers)
const i18n = useLabI18n()
// The command-palette name of the commit action, in the Lab language.
const commitLabel = computed(() => i18n.t('Apply the JSON now'))

const { revealRange } = useMonacoJsonEditor(container, {
	modelValue: modelValueRef,
	onChange: text => emit('update:modelValue', text),
	markers: markersRef,
	onCommit: () => emit('commit'),
	commitLabel,
	onFocus: () => emit('focus'),
	onBlur: () => emit('blur'),
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
