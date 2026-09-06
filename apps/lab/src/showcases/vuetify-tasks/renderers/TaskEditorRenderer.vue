<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import { VBtn, VCard, VCardActions, VCardText, VCardTitle, VDialog, VSpacer, VTextField } from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { TaskEditorPlugin } from '../plugins/task-editor'

const { useState, useProperties, useMethods, useMethodDiagnostics, widgetId, widgetType } = useWidget(TaskEditorPlugin)
const { open, title } = useState()
const { mode, messages } = useProperties()
const { save, cancel } = useMethods()
const { save: saveDiagnostics } = useMethodDiagnostics()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)

function onDialogUpdate(nextOpen: boolean): void {
	if (!nextOpen && open.value)
		cancel()
}

function onTitleUpdate(nextTitle: string | null): void {
	title.value = nextTitle ?? ''
}

function onCancel(): void {
	cancel()
}

function onSave(): void {
	save()
}
</script>

<template>
	<div
		v-bind="inspectAnchor"
		style="display: contents"
	>
		<VDialog
			contained
			:modelValue="open ?? false"
			maxWidth="520"
			@update:modelValue="onDialogUpdate"
		>
			<VCard>
				<VCardTitle>
					{{ mode === 'edit' ? (messages?.editTask ?? 'Edit task') : (messages?.newTask ?? 'Create task') }}
				</VCardTitle>
				<VCardText>
					<VTextField
						:modelValue="title ?? ''"
						:label="messages?.taskTitle ?? 'Task title'"
						maxlength="160"
						autofocus
						variant="outlined"
						@update:modelValue="onTitleUpdate"
					/>
					<p
						v-for="diagnostic in saveDiagnostics"
						:key="diagnostic.message"
						style="margin: 0; color: rgb(var(--v-theme-error)); font-size: 0.8rem"
					>
						{{ diagnostic.message }}
					</p>
				</VCardText>
				<VCardActions>
					<VSpacer />
					<VBtn
						variant="text"
						@click="onCancel"
					>
						{{ messages?.cancel ?? 'Cancel' }}
					</VBtn>
					<VBtn
						color="primary"
						variant="flat"
						@click="onSave"
					>
						{{ messages?.save ?? 'Save' }}
					</VBtn>
				</VCardActions>
			</VCard>
		</VDialog>
	</div>
</template>
