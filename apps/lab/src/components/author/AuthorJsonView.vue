<script setup lang="ts">
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import MonacoJsonEditor from '../editor/MonacoJsonEditor.vue'

const store = useLabStore()
const i18n = useLabI18n()
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<div :class="pika({ padding: '7px 10px', color: 'var(--lab-color-text-muted)', fontSize: '11px', borderBottom: '1px solid var(--lab-color-border)' })">
			{{ i18n.t('Expert JSON view: edit the draft, then use Apply. JSON is parsed into one root SourcePatch.') }}
		</div>
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
