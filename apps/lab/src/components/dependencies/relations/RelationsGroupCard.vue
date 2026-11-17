<script setup lang="ts">
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { RelationsWidgetGroup } from '../../../graph/relations'
import type { GraphVertexKind } from '../../../graph/types'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import { formatDiagnosticPath } from '../../../lib/diagnostic-format'

defineProps<{
	group: RelationsWidgetGroup
	direction: 'incoming' | 'outgoing'
	isWidgetMode: boolean
}>()

const emit = defineEmits<{
	selectMember: [payload: { nodeId: InspectionNodeId, member: { type: GraphVertexKind, name: string } }]
	selectWidget: [nodeId: InspectionNodeId]
}>()

const i18n = useLabI18n()

function memberKindShort(kind: GraphVertexKind): string {
	switch (kind) {
		case 'state':
			return 'S'
		case 'property':
			return 'P'
		case 'method':
			return 'M'
	}
}
</script>

<template>
	<div
		class="relations-group-card rounded-lab border border-lab-border bg-lab-surface flex flex-col overflow-hidden"
		:class="[
			!group.isResolved && 'relations-group-card--unresolved',
		]"
	>
		<!-- Group Header (Remote Widget) -->
		<div
			class="relations-group-header p-[5px_8px] bg-lab-surface-alt border-b border-b-lab-border flex items-center justify-between gap-[6px] text-[11px]"
		>
			<div class="flex items-center gap-[6px] min-w-0">
				<button
					v-if="group.isResolved && group.nodeId !== undefined"
					type="button"
					class="bg-transparent [border:none] p-0 cursor-pointer flex items-center gap-[5px] font-lab-mono text-[11px] text-lab-text no-underline hover:underline"
					:title="`${group.widgetType ?? ''} #${group.widgetId}`"
					@click="emit('selectWidget', group.nodeId)"
				>
					<span
						v-if="group.widgetType"
						class="font-bold"
					>{{ group.widgetType }}</span>
					<span class="text-lab-text-muted">#{{ group.widgetId }}</span>
				</button>
				<div
					v-else
					class="flex items-center gap-[5px] font-lab-mono text-[11px] text-lab-text"
				>
					<span
						v-if="group.widgetType"
						class="font-bold"
					>{{ group.widgetType }}</span>
					<span class="text-lab-text-muted">#{{ group.widgetId }}</span>
				</div>

				<span
					v-if="group.isSameWidget"
					class="text-[11px] p-[1px_4px] rounded-[2px] bg-lab-surface border border-lab-border text-lab-text-muted"
				>
					{{ i18n.t('this widget') }}
				</span>
				<span
					v-if="!group.isResolved"
					class="text-[11px] p-[1px_4px] rounded-[2px] [background:color-mix(in_srgb,var(--lab-color-danger)_15%,transparent)] text-lab-danger font-semibold"
				>
					{{ i18n.t('unresolved') }}
				</span>
			</div>
			<span class="text-[11px] text-lab-text-muted">
				{{ group.rows.length }}
			</span>
		</div>

		<!-- Rows -->
		<div class="flex flex-col">
			<div
				v-for="(row, index) in group.rows"
				:key="row.id"
				class="relations-row p-[6px_8px] flex flex-col gap-[3px] text-[11px]"
				:class="[
					index > 0 && 'border-t border-t-lab-border [border-top-style:dashed]',
				]"
			>
				<!-- Operation and Members -->
				<div class="flex items-center gap-[6px] flex-wrap">
					<!-- In Widget Mode: show local member name -->
					<span
						v-if="isWidgetMode"
						class="font-lab-mono text-[11px] text-lab-text bg-lab-surface-alt p-[1px_5px] rounded-[3px]"
						:title="`${row.localMember.kind}: ${row.localMember.name}`"
					>
						{{ row.localMember.name }}
					</span>

					<!-- Arrow indicating direction -->
					<span
						class="text-[11px] text-lab-text-muted"
						aria-hidden="true"
					>
						{{ direction === 'incoming' ? '←' : '→' }}
					</span>

					<!-- Operation pill -->
					<span
						class="relations-operation-pill text-[11px] p-[1px_5px] rounded-[999px] font-lab-mono uppercase"
						:class="[
							`relations-operation-pill--${row.operation}`,
						]"
					>
						{{ row.operation }}
					</span>

					<!-- Remote member target -->
					<button
						v-if="row.resolved && row.remoteMember"
						type="button"
						class="relations-member-button inline-flex items-center gap-[4px] p-[1px_6px] rounded-[3px] border border-lab-border bg-lab-surface-alt text-lab-text font-lab-mono text-[11px] cursor-pointer hover:border-lab-accent"
						:class="[
							`relations-member-button--${row.remoteMember.kind}`,
						]"
						:title="i18n.t('Focus {kind} {name} in {widget}', { kind: row.remoteMember.kind, name: row.remoteMember.name, widget: `${row.remoteMember.widgetType} #${row.remoteMember.widgetId}` })"
						@click="emit('selectMember', { nodeId: row.remoteMember.nodeId, member: { type: row.remoteMember.kind, name: row.remoteMember.name } })"
					>
						<span
							class="relations-kind-badge"
							:class="`relations-kind-badge--${row.remoteMember.kind}`"
						>
							{{ memberKindShort(row.remoteMember.kind) }}
						</span>
						<span>{{ row.remoteMember.name }}</span>
					</button>

					<!-- Unresolved stub target -->
					<span
						v-else-if="row.stubTarget"
						class="relations-stub-target inline-flex items-center gap-[4px] p-[1px_6px] rounded-[3px] border border-lab-danger border-dashed [background:color-mix(in_srgb,var(--lab-color-danger)_8%,transparent)] text-lab-text font-lab-mono text-[11px]"
						:class="[
							`relations-stub-target--${row.stubStatus}`,
						]"
						:title="`${row.stubStatus}: ${row.stubTarget.targetDescription}`"
					>
						<span
							class="relations-kind-badge"
							:class="`relations-kind-badge--${row.stubTarget.memberKind}`"
						>
							{{ memberKindShort(row.stubTarget.memberKind) }}
						</span>
						<span>{{ row.stubTarget.memberName }}</span>
						<span
							class="text-[11px] text-lab-text-muted italic"
							:class="[row.stubStatus === 'invalid' && 'relations-stub-status--invalid']"
						>
							({{ row.stubStatus }})
						</span>
					</span>

					<!-- Invalid cycle flag -->
					<span
						v-if="row.invalidCycle"
						class="text-[11px] font-bold text-lab-danger p-[0_4px] rounded-[2px] [background:color-mix(in_srgb,var(--lab-color-danger)_15%,transparent)]"
						:title="i18n.t('invalid evaluation cycle')"
					>
						! {{ i18n.t('cycle') }}
					</span>
				</div>

				<!-- Path context -->
				<div
					v-if="formatDiagnosticPath(row.path)"
					class="relations-row-path font-lab-mono text-[11px] text-lab-text-muted"
					:class="[
						isWidgetMode && 'relations-row-path--widget-mode',
					]"
				>
					path: {{ formatDiagnosticPath(row.path) }}
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.relations-kind-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 18px;
	height: 18px;
	border-radius: 3px;
	font-size: 11px;
	font-weight: 700;
	line-height: 1;
}

.relations-kind-badge--state {
	border: 1.5px solid var(--lab-color-ok);
	color: var(--lab-color-ok);
}

.relations-kind-badge--property {
	border: 1.5px solid var(--lab-color-warning);
	color: var(--lab-color-warning);
}

.relations-kind-badge--method {
	border: 1.5px solid var(--lab-color-accent);
	color: var(--lab-color-accent);
}

.relations-operation-pill--reads {
	background: var(--lab-color-surface-alt);
	color: var(--lab-color-text-muted);
	border: 1px solid var(--lab-color-border);
}

.relations-operation-pill--writes {
	background: color-mix(in srgb, var(--lab-color-warning) 16%, transparent);
	color: var(--lab-color-warning);
	border: 1px solid color-mix(in srgb, var(--lab-color-warning) 30%, transparent);
	font-weight: 600;
}

.relations-operation-pill--invokes {
	background: color-mix(in srgb, var(--lab-color-accent) 16%, transparent);
	color: var(--lab-color-accent);
	border: 1px dashed color-mix(in srgb, var(--lab-color-accent) 40%, transparent);
}

.relations-group-card--unresolved {
	border-color: color-mix(in srgb, var(--lab-color-danger) 40%, var(--lab-color-border));
}

.relations-stub-target--absent {
	border-color: var(--lab-color-border);
	background: var(--lab-color-surface-alt);
}

.relations-stub-status--invalid {
	color: var(--lab-color-danger);
}

.relations-row-path--widget-mode {
	padding-left: 8px;
}
</style>
