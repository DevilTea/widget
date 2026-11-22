<script setup lang="ts">
/**
 * The Explain tab's "Used by / Depends on": a compact list over the same Relations projection the Dependencies panel shows
 * (`projectRelations`, widget focus), one entry per other widget with the members involved. A resolved widget is a button
 * that selects it through the shared Document focus; a reference that names no widget in the document is listed without one.
 * Dependencies inside the widget itself are left out here (Relations lists them).
 */
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { RelationsDependencyRow, RelationsWidgetGroup } from '../../graph/relations'
import { useLabI18n } from '../../composables/use-lab-i18n'

defineProps<{
	usedBy: readonly RelationsWidgetGroup[]
	dependsOn: readonly RelationsWidgetGroup[]
}>()

const emit = defineEmits<{ select: [nodeId: InspectionNodeId] }>()
const i18n = useLabI18n()

function rowText(row: RelationsDependencyRow, direction: 'usedBy' | 'dependsOn'): string {
	const remote = row.remoteMember?.name ?? row.stubTarget?.memberName ?? '?'
	const local = row.localMember.name
	const [source, target] = direction === 'usedBy' ? [remote, local] : [local, remote]
	switch (row.operation) {
		case 'reads': return i18n.t('{source} reads {target}', { source, target })
		case 'writes': return i18n.t('{source} writes {target}', { source, target })
		default: return i18n.t('{source} calls {target}', { source, target })
	}
}

function groupText(group: RelationsWidgetGroup, direction: 'usedBy' | 'dependsOn'): string {
	const texts = [...new Set(group.rows.map(row => rowText(row, direction)))]
	return texts.join(i18n.locale.value === 'zh-TW' ? '；' : '; ')
}

function external(groups: readonly RelationsWidgetGroup[]): readonly RelationsWidgetGroup[] {
	return groups.filter(group => !group.isSameWidget)
}
</script>

<template>
	<div class="grid gap-3 @min-[520px]:grid-cols-2">
		<div
			v-for="direction in (['usedBy', 'dependsOn'] as const)"
			:key="direction"
			:data-testid="direction === 'usedBy' ? 'explain-used-by' : 'explain-depends-on'"
			class="min-w-0"
		>
			<h4
				:id="`explain-relations-${direction}`"
				class="m-0 mb-1 text-[11px] font-semibold uppercase text-muted"
			>
				{{ direction === 'usedBy' ? i18n.t('Used by') : i18n.t('Depends on') }}
			</h4>
			<ul
				v-if="external(direction === 'usedBy' ? usedBy : dependsOn).length > 0"
				:aria-labelledby="`explain-relations-${direction}`"
				class="m-0 flex list-none flex-col gap-1 p-0 text-xs"
			>
				<li
					v-for="group in external(direction === 'usedBy' ? usedBy : dependsOn)"
					:key="group.key"
					data-testid="explain-relation"
					:data-widget="group.widgetId"
					class="min-w-0"
				>
					<button
						v-if="group.isResolved && group.nodeId !== undefined"
						type="button"
						data-testid="explain-relation-widget"
						class="min-h-6 cursor-pointer rounded-(--lab-radius) border-0 bg-transparent p-0 font-lab-mono text-xs text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-primary"
						:title="i18n.t('Select widget {id}', { id: group.widgetId })"
						@click="emit('select', group.nodeId)"
						v-text="`#${group.widgetId}`"
					/>
					<span
						v-else
						class="font-lab-mono"
						v-text="`#${group.widgetId}`"
					/>
					<span
						v-if="group.widgetType !== undefined"
						class="text-muted"
						v-text="` : ${group.widgetType}`"
					/>
					<span
						v-if="!group.isResolved"
						class="text-muted"
						v-text="` (${i18n.t('reference not resolved')})`"
					/>
					<span
						class="block break-words text-muted"
						v-text="groupText(group, direction)"
					/>
				</li>
			</ul>
			<p
				v-else
				class="m-0 text-xs text-muted"
			>
				{{ direction === 'usedBy' ? i18n.t('No other widget uses this one.') : i18n.t('This widget does not depend on another widget.') }}
			</p>
		</div>
	</div>
</template>
