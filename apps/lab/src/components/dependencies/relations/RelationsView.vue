<script setup lang="ts">
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { RelationsViewModel } from '../../../graph/relations'
import type { GraphVertexKind } from '../../../graph/types'
import { useLabI18n } from '../../../composables/use-lab-i18n'
import RelationsEmptyState from './RelationsEmptyState.vue'
import RelationsGroupCard from './RelationsGroupCard.vue'

defineProps<{
	model: RelationsViewModel
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
	<!-- 1. Empty state -->
	<RelationsEmptyState
		v-if="model.mode === 'empty'"
		:message="model.message"
	/>

	<!-- 2 & 3. 3-column Inspector for Member or Widget Focus (stacked when the pane is narrow, see the container query below) -->
	<div
		v-else
		class="relations-container"
	>
		<div
			class="relations-view-surface flex flex-row h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-lab-surface"
		>
			<!-- Left Column: Used by (Incoming) -->
			<div
				class="relations-column relations-column--incoming flex-[1_1_33%] min-w-[220px] flex flex-col border-r border-r-lab-border min-h-0"
			>
				<div
					class="relations-column-header p-[8px_12px] border-b border-b-lab-border bg-lab-surface-alt flex items-center justify-between text-[11px] font-semibold flex-[0_0_auto]"
				>
					<div class="flex items-center gap-[6px]">
						<span class="text-lab-text-muted">←</span>
						<span>{{ i18n.t('Used by') }}</span>
					</div>
					<span
						class="relations-counter-badge text-[11px] p-[1px_6px] rounded-[999px] bg-lab-surface border border-lab-border text-lab-text-muted"
					>
						{{ model.totalUsedByCount }}
					</span>
				</div>

				<div
					class="relations-column-content flex-auto overflow-y-auto p-[8px] flex flex-col gap-[8px]"
				>
					<div
						v-if="model.usedBy.length === 0"
						class="p-[16px_12px] text-[11px] text-lab-text-muted text-center italic"
					>
						{{ i18n.t('No incoming dependencies') }}
					</div>
					<RelationsGroupCard
						v-for="group in model.usedBy"
						:key="group.key"
						:group="group"
						direction="incoming"
						:isWidgetMode="model.mode === 'widget'"
						@selectMember="payload => emit('selectMember', payload)"
						@selectWidget="nodeId => emit('selectWidget', nodeId)"
					/>
				</div>
			</div>

			<!-- Center Column: Selected Entity Identity & Context -->
			<div
				class="relations-column relations-column--center flex-[1_1_34%] min-w-[240px] flex flex-col border-r border-r-lab-border [background:color-mix(in_srgb,var(--lab-color-surface-alt)_40%,var(--lab-color-surface))] min-h-0"
			>
				<div
					class="relations-column-header p-[8px_12px] border-b border-b-lab-border bg-lab-surface-alt flex items-center justify-between text-[11px] font-semibold flex-[0_0_auto]"
				>
					<span>
						{{ model.mode === 'member' ? i18n.t('Focused member') : i18n.t('Focused widget') }}
					</span>
					<span
						v-if="model.mode === 'member'"
						class="relations-kind-badge"
						:class="`relations-kind-badge--${model.selectedMember.kind}`"
					>
						{{ memberKindShort(model.selectedMember.kind) }}
					</span>
					<span
						v-else
						class="text-[11px] text-lab-text-muted font-lab-mono"
					>
						#{{ model.selectedWidget.widgetId }}
					</span>
				</div>

				<div
					class="relations-column-content flex-auto overflow-y-auto p-[10px] flex flex-col gap-[12px]"
				>
					<!-- Member Context (when mode === 'member') -->
					<template v-if="model.mode === 'member'">
						<div
							class="relations-focus-card p-[10px_12px] rounded-lab border border-lab-border bg-lab-surface flex flex-col gap-[8px]"
						>
							<!-- Owning Widget link -->
							<div class="flex items-center gap-[6px] text-[11px]">
								<span class="text-lab-text-muted text-[11px]">{{ i18n.t('Widget:') }}</span>
								<button
									type="button"
									class="bg-transparent [border:none] p-0 cursor-pointer font-lab-mono text-[11px] text-lab-text hover:underline"
									:title="i18n.t('Focus widget {name}', { name: `${model.selectedMember.widgetType} #${model.selectedMember.widgetId}` })"
									@click="emit('selectWidget', model.selectedMember.nodeId)"
								>
									<strong>{{ model.selectedMember.widgetType }}</strong>
									<span class="text-lab-text-muted"> #{{ model.selectedMember.widgetId }}</span>
								</button>
							</div>

							<!-- Selected Member Display -->
							<div class="flex items-center gap-[8px] flex-wrap">
								<span
									class="relations-kind-badge"
									:class="`relations-kind-badge--${model.selectedMember.kind}`"
									:style="{ width: '18px', height: '18px', fontSize: '11px' }"
								>
									{{ memberKindShort(model.selectedMember.kind) }}
								</span>
								<span class="font-lab-mono text-[13px] font-bold">
									{{ model.selectedMember.name }}
								</span>
								<span
									v-if="model.selectedMember.transitivelyWrites"
									class="text-[11px] font-bold p-[1px_5px] rounded-[2px] [background:color-mix(in_srgb,var(--lab-color-warning)_20%,transparent)] text-lab-warning [border:1px_solid_color-mix(in_srgb,var(--lab-color-warning)_40%,transparent)]"
									:title="i18n.t('Writes State directly or through the Methods it invokes')"
								>
									W {{ i18n.t('writes') }}
								</span>
								<span
									v-if="model.selectedMember.transitivelyEmits"
									class="text-[11px] font-bold p-[1px_5px] rounded-[2px] [background:color-mix(in_srgb,var(--lab-color-warning)_20%,transparent)] text-lab-warning [border:1px_solid_color-mix(in_srgb,var(--lab-color-warning)_40%,transparent)]"
									:title="i18n.t('Emits an Event directly or through the Methods it invokes')"
								>
									E {{ i18n.t('emits') }}
								</span>
								<span
									v-if="model.selectedMember.invalidCycle"
									class="text-[11px] font-bold p-[1px_5px] rounded-[2px] [background:color-mix(in_srgb,var(--lab-color-danger)_20%,transparent)] text-lab-danger [border:1px_solid_color-mix(in_srgb,var(--lab-color-danger)_40%,transparent)]"
									:title="i18n.t('invalid evaluation cycle')"
								>
									! {{ i18n.t('cycle') }}
								</span>
							</div>

							<!-- Member Summary counts -->
							<div
								class="flex gap-[12px] pt-[6px] border-t border-t-lab-border text-[11px] text-lab-text-muted"
							>
								<div>{{ i18n.t('Used by:') }} <strong>{{ model.totalUsedByCount }}</strong></div>
								<div>{{ i18n.t('Depends on:') }} <strong>{{ model.totalDependsOnCount }}</strong></div>
							</div>
						</div>
					</template>

					<!-- Widget Context (when mode === 'widget') -->
					<template v-else>
						<div
							class="relations-focus-card p-[10px_12px] rounded-lab border border-lab-border bg-lab-surface flex flex-col gap-[8px]"
						>
							<div class="flex items-center justify-between">
								<div class="font-lab-mono text-[13px]">
									<strong>{{ model.selectedWidget.widgetType }}</strong>
									<span class="text-lab-text-muted"> #{{ model.selectedWidget.widgetId }}</span>
								</div>
							</div>

							<!-- Counts -->
							<div class="flex gap-[8px] text-[11px] font-lab-mono">
								<span
									v-if="model.selectedWidget.memberCounts.state"
									class="text-lab-ok"
								>
									S {{ model.selectedWidget.memberCounts.state }}
								</span>
								<span
									v-if="model.selectedWidget.memberCounts.property"
									class="text-lab-warning"
								>
									P {{ model.selectedWidget.memberCounts.property }}
								</span>
								<span
									v-if="model.selectedWidget.memberCounts.method"
									class="text-lab-accent"
								>
									M {{ model.selectedWidget.memberCounts.method }}
								</span>
								<span class="text-lab-text-muted ml-[auto]">
									{{ model.selectedWidget.memberCounts.total }} {{ i18n.t('members') }}
								</span>
							</div>

							<!-- Widget Members list -->
							<div class="flex flex-col gap-[4px] mt-[4px]">
								<span class="text-[11px] text-lab-text-muted font-semibold uppercase">
									{{ i18n.t('Members') }}
								</span>
								<div class="flex flex-wrap gap-[4px]">
									<button
										v-for="member in model.selectedWidget.members"
										:key="`${member.kind}:${member.name}`"
										type="button"
										class="inline-flex items-center gap-[4px] p-[2px_6px] rounded-[3px] border border-lab-border bg-lab-surface-alt text-lab-text font-lab-mono text-[11px] cursor-pointer hover:border-lab-accent"
										:title="i18n.t('Focus {kind} {name}', { kind: member.kind, name: member.name })"
										@click="emit('selectMember', { nodeId: member.nodeId, member: { type: member.kind, name: member.name } })"
									>
										<span
											class="relations-kind-badge"
											:class="`relations-kind-badge--${member.kind}`"
										>
											{{ memberKindShort(member.kind) }}
										</span>
										<span>{{ member.name }}</span>
										<span
											v-if="member.transitivelyWrites"
											class="text-lab-warning font-bold"
										>W</span>
										<span
											v-if="member.transitivelyEmits"
											class="text-lab-warning font-bold"
											:title="i18n.t('Emits an Event directly or through the Methods it invokes')"
										>E</span>
										<span
											v-if="member.invalidCycle"
											class="text-lab-danger font-bold"
										>!</span>
									</button>
								</div>
							</div>
						</div>

						<!-- Internal dependencies section (requirement 3: compact separate section) -->
						<div
							class="relations-internal-section p-[10px_12px] rounded-lab border border-lab-border bg-lab-surface flex flex-col gap-[6px]"
						>
							<div class="flex items-center justify-between text-[11px]">
								<span class="font-semibold">{{ i18n.t('Internal dependencies') }}</span>
								<span class="text-[11px] text-lab-text-muted">
									{{ model.totalInternalCount }}
								</span>
							</div>

							<div
								v-if="model.internal.length === 0"
								class="text-[11px] text-lab-text-muted italic"
							>
								{{ i18n.t('No internal dependencies between members') }}
							</div>

							<div
								v-else
								class="flex flex-col gap-[4px]"
							>
								<div
									v-for="item in model.internal"
									:key="item.id"
									class="flex items-center gap-[5px] text-[11px] font-lab-mono p-[3px_0] border-b border-b-lab-border [border-bottom-style:dashed]"
								>
									<!-- Source member button -->
									<button
										type="button"
										class="bg-transparent [border:none] p-0 cursor-pointer inline-flex items-center gap-[3px] font-lab-mono text-[11px] text-lab-text hover:underline"
										@click="emit('selectMember', { nodeId: item.sourceMember.nodeId, member: { type: item.sourceMember.kind, name: item.sourceMember.name } })"
									>
										<span
											class="relations-kind-badge"
											:class="`relations-kind-badge--${item.sourceMember.kind}`"
										>
											{{ memberKindShort(item.sourceMember.kind) }}
										</span>
										<span>{{ item.sourceMember.name }}</span>
									</button>

									<span class="text-lab-text-muted text-[11px]">
										{{ item.operation }}
									</span>

									<!-- Target member button -->
									<button
										v-if="item.resolved && item.targetMember"
										type="button"
										class="bg-transparent [border:none] p-0 cursor-pointer inline-flex items-center gap-[3px] font-lab-mono text-[11px] text-lab-text hover:underline"
										@click="emit('selectMember', { nodeId: item.targetMember.nodeId, member: { type: item.targetMember.kind, name: item.targetMember.name } })"
									>
										<span
											class="relations-kind-badge"
											:class="`relations-kind-badge--${item.targetMember.kind}`"
										>
											{{ memberKindShort(item.targetMember.kind) }}
										</span>
										<span>{{ item.targetMember.name }}</span>
									</button>

									<span
										v-else-if="item.stubTarget"
										class="relations-internal-stub-target inline-flex items-center gap-[4px] p-[1px_6px] rounded-[3px] border border-lab-danger border-dashed [background:color-mix(in_srgb,var(--lab-color-danger)_8%,transparent)] text-lab-text"
										:title="`${item.stubStatus}: ${item.stubTarget.targetDescription}`"
									>
										<span
											class="relations-kind-badge"
											:class="`relations-kind-badge--${item.stubTarget.memberKind}`"
										>
											{{ memberKindShort(item.stubTarget.memberKind) }}
										</span>
										<span class="font-lab-mono">{{ item.stubTarget.memberName }}</span>
										<span class="text-[11px] text-lab-danger font-semibold">{{ i18n.t('unresolved') }}</span>
									</span>
								</div>
							</div>
						</div>
					</template>
				</div>
			</div>

			<!-- Right Column: Depends on (Outgoing) -->
			<div
				class="relations-column relations-column--outgoing flex-[1_1_33%] min-w-[220px] flex flex-col min-h-0"
			>
				<div
					class="relations-column-header p-[8px_12px] border-b border-b-lab-border bg-lab-surface-alt flex items-center justify-between text-[11px] font-semibold flex-[0_0_auto]"
				>
					<div class="flex items-center gap-[6px]">
						<span>{{ i18n.t('Depends on') }}</span>
						<span class="text-lab-text-muted">→</span>
					</div>
					<span
						class="relations-counter-badge text-[11px] p-[1px_6px] rounded-[999px] bg-lab-surface border border-lab-border text-lab-text-muted"
					>
						{{ model.totalDependsOnCount }}
					</span>
				</div>

				<div
					class="relations-column-content flex-auto overflow-y-auto p-[8px] flex flex-col gap-[8px]"
				>
					<div
						v-if="model.dependsOn.length === 0"
						class="p-[16px_12px] text-[11px] text-lab-text-muted text-center italic"
					>
						{{ i18n.t('No outgoing dependencies') }}
					</div>
					<RelationsGroupCard
						v-for="group in model.dependsOn"
						:key="group.key"
						:group="group"
						direction="outgoing"
						:isWidgetMode="model.mode === 'widget'"
						@selectMember="payload => emit('selectMember', payload)"
						@selectWidget="nodeId => emit('selectWidget', nodeId)"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
/*
 * Three columns need about 680px (220 + 240 + 220). Narrower than that, which is what the tool area gets at 1280px
 * with the tutorial rail open (about 460px), they stack (Used by, the focus, Depends on) and the pane scrolls
 * vertically instead of scrolling sideways. The pane's own width decides, not the window's: dragging the divider
 * changes it too. Unlayered, so it wins over the Tailwind utilities of the template.
 */
.relations-container {
	container-type: inline-size;
	width: 100%;
	height: 100%;
	min-height: 0;
}

/* Audit U19: every link and button of the view (the group cards' too) is a 24px-high target. */
.relations-container :deep(button) {
	min-height: 24px;
	box-sizing: border-box;
}

@container (max-width: 679px) {
	.relations-view-surface {
		flex-direction: column;
		overflow-x: hidden;
		overflow-y: auto;
	}

	.relations-column {
		flex: 0 0 auto;
		min-width: 0;
		border-right: 0;
		border-bottom: 1px solid var(--lab-color-border);
	}
}

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
</style>
