<script setup lang="ts">
import { useWidget } from '@deviltea/widget-vue'
import {
	VBtn,
	VCard,
	VCardText,
	VCardTitle,
	VCheckboxBtn,
	VList,
	VListItem,
} from 'vuetify/components'
import { useInspectAnchor } from '../../../composables/use-inspect-anchor'
import { TaskListPlugin } from '../plugins/task-list'

const { useProperties, useMethods, widgetId, widgetType } = useWidget(TaskListPlugin)
const { visibleTasks, count, messages } = useProperties()
const { toggle, edit, delete: deleteTask } = useMethods()
const inspectAnchor = useInspectAnchor(widgetId, widgetType)
</script>

<template>
	<VCard
		v-bind="inspectAnchor"
		variant="outlined"
	>
		<VCardTitle style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px">
			<span>{{ messages?.tasksTitle ?? 'Tasks' }}</span>
			<span style="font-size: 0.8rem; opacity: 0.68; font-weight: 400">
				{{ count ?? 0 }} {{ messages?.tasksShown ?? 'tasks shown' }}
			</span>
		</VCardTitle>
		<VCardText style="padding-top: 0">
			<div
				v-if="(visibleTasks?.length ?? 0) === 0"
				data-testid="task-empty-state"
				style="padding: 24px 4px; opacity: 0.72"
			>
				{{ messages?.empty ?? '' }}
			</div>
			<VList
				v-else
				lines="two"
				density="comfortable"
			>
				<VListItem
					v-for="task in visibleTasks"
					:key="task.id"
					:data-task-id="task.id"
					:title="task.title"
					:subtitle="task.done ? (messages?.filterDone ?? 'Done') : (messages?.filterOpen ?? 'Open')"
				>
					<template #prepend>
						<VCheckboxBtn
							:modelValue="task.done"
							:aria-label="`${task.done ? (messages?.filterDone ?? 'Done') : (messages?.filterOpen ?? 'Open')}: ${task.title}`"
							@update:modelValue="toggle(task.id)"
						/>
					</template>
					<template #append>
						<div style="display: flex; gap: 4px">
							<VBtn
								size="small"
								variant="text"
								@click="edit(task.id)"
							>
								{{ messages?.edit ?? 'Edit' }}
							</VBtn>
							<VBtn
								size="small"
								variant="text"
								color="error"
								@click="deleteTask(task.id)"
							>
								{{ messages?.delete ?? 'Delete' }}
							</VBtn>
						</div>
					</template>
				</VListItem>
			</VList>
		</VCardText>
	</VCard>
</template>
