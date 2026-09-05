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

	<!-- 2 & 3. 3-column Inspector for Member or Widget Focus -->
	<div
		v-else
		class="relations-view-surface"
		:class="pika({
			display: 'flex',
			flexDirection: 'row',
			height: '100%',
			minHeight: '0',
			width: '100%',
			overflowX: 'auto',
			overflowY: 'hidden',
			background: 'var(--lab-color-surface)',
		})"
	>
		<!-- Left Column: Used by (Incoming) -->
		<div
			class="relations-column relations-column--incoming"
			:class="pika({
				flex: '1 1 33%',
				minWidth: '220px',
				display: 'flex',
				flexDirection: 'column',
				borderRight: '1px solid var(--lab-color-border)',
				minHeight: '0',
			})"
		>
			<div
				class="relations-column-header"
				:class="pika({
					padding: '8px 12px',
					borderBottom: '1px solid var(--lab-color-border)',
					background: 'var(--lab-color-surface-alt)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					fontSize: '11px',
					fontWeight: '600',
					flex: '0 0 auto',
				})"
			>
				<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
					<span :class="pika({ color: 'var(--lab-color-text-muted)' })">←</span>
					<span>{{ i18n.t('Used by') }}</span>
				</div>
				<span
					class="relations-counter-badge"
					:class="pika({
						fontSize: '10px',
						padding: '1px 6px',
						borderRadius: '999px',
						background: 'var(--lab-color-surface)',
						border: '1px solid var(--lab-color-border)',
						color: 'var(--lab-color-text-muted)',
					})"
				>
					{{ model.totalUsedByCount }}
				</span>
			</div>

			<div
				class="relations-column-content"
				:class="pika({
					flex: '1 1 auto',
					overflowY: 'auto',
					padding: '8px',
					display: 'flex',
					flexDirection: 'column',
					gap: '8px',
				})"
			>
				<div
					v-if="model.usedBy.length === 0"
					:class="pika({
						padding: '16px 12px',
						fontSize: '11px',
						color: 'var(--lab-color-text-muted)',
						textAlign: 'center',
						fontStyle: 'italic',
					})"
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
			class="relations-column relations-column--center"
			:class="pika({
				flex: '1 1 34%',
				minWidth: '240px',
				display: 'flex',
				flexDirection: 'column',
				borderRight: '1px solid var(--lab-color-border)',
				background: 'color-mix(in srgb, var(--lab-color-surface-alt) 40%, var(--lab-color-surface))',
				minHeight: '0',
			})"
		>
			<div
				class="relations-column-header"
				:class="pika({
					padding: '8px 12px',
					borderBottom: '1px solid var(--lab-color-border)',
					background: 'var(--lab-color-surface-alt)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					fontSize: '11px',
					fontWeight: '600',
					flex: '0 0 auto',
				})"
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
					:class="pika({
						fontSize: '10px',
						color: 'var(--lab-color-text-muted)',
						fontFamily: 'var(--lab-font-mono)',
					})"
				>
					#{{ model.selectedWidget.widgetId }}
				</span>
			</div>

			<div
				class="relations-column-content"
				:class="pika({
					flex: '1 1 auto',
					overflowY: 'auto',
					padding: '10px',
					display: 'flex',
					flexDirection: 'column',
					gap: '12px',
				})"
			>
				<!-- Member Context (when mode === 'member') -->
				<template v-if="model.mode === 'member'">
					<div
						class="relations-focus-card"
						:class="pika({
							padding: '10px 12px',
							borderRadius: 'var(--lab-radius)',
							border: '1px solid var(--lab-color-border)',
							background: 'var(--lab-color-surface)',
							display: 'flex',
							flexDirection: 'column',
							gap: '8px',
						})"
					>
						<!-- Owning Widget link -->
						<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' })">
							<span :class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '10px' })">{{ i18n.t('Widget:') }}</span>
							<button
								type="button"
								:class="pika({
									'background': 'transparent',
									'border': 'none',
									'padding': '0',
									'cursor': 'pointer',
									'fontFamily': 'var(--lab-font-mono)',
									'fontSize': '11px',
									'color': 'var(--lab-color-text)',
									'$:hover': { textDecoration: 'underline' },
								})"
								:title="`Focus widget ${model.selectedMember.widgetType} #${model.selectedMember.widgetId}`"
								@click="emit('selectWidget', model.selectedMember.nodeId)"
							>
								<strong>{{ model.selectedMember.widgetType }}</strong>
								<span :class="pika({ color: 'var(--lab-color-text-muted)' })"> #{{ model.selectedMember.widgetId }}</span>
							</button>
						</div>

						<!-- Selected Member Display -->
						<div :class="pika({ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' })">
							<span
								class="relations-kind-badge"
								:class="`relations-kind-badge--${model.selectedMember.kind}`"
								:style="{ width: '18px', height: '18px', fontSize: '11px' }"
							>
								{{ memberKindShort(model.selectedMember.kind) }}
							</span>
							<span :class="pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '13px', fontWeight: 'bold' })">
								{{ model.selectedMember.name }}
							</span>
							<span
								v-if="model.selectedMember.transitivelyWrites"
								:class="pika({
									fontSize: '9px',
									fontWeight: 'bold',
									padding: '1px 5px',
									borderRadius: '2px',
									background: 'color-mix(in srgb, var(--lab-color-warning) 20%, transparent)',
									color: 'var(--lab-color-warning)',
									border: '1px solid color-mix(in srgb, var(--lab-color-warning) 40%, transparent)',
								})"
								title="transitivelyWrites: writes State directly or indirectly"
							>
								W writes
							</span>
							<span
								v-if="model.selectedMember.invalidCycle"
								:class="pika({
									fontSize: '9px',
									fontWeight: 'bold',
									padding: '1px 5px',
									borderRadius: '2px',
									background: 'color-mix(in srgb, var(--lab-color-danger) 20%, transparent)',
									color: 'var(--lab-color-danger)',
									border: '1px solid color-mix(in srgb, var(--lab-color-danger) 40%, transparent)',
								})"
								title="invalid evaluation cycle"
							>
								! cycle
							</span>
						</div>

						<!-- Member Summary counts -->
						<div
							:class="pika({
								display: 'flex',
								gap: '12px',
								paddingTop: '6px',
								borderTop: '1px solid var(--lab-color-border)',
								fontSize: '11px',
								color: 'var(--lab-color-text-muted)',
							})"
						>
							<div>{{ i18n.t('Used by:') }} <strong>{{ model.totalUsedByCount }}</strong></div>
							<div>{{ i18n.t('Depends on:') }} <strong>{{ model.totalDependsOnCount }}</strong></div>
						</div>
					</div>
				</template>

				<!-- Widget Context (when mode === 'widget') -->
				<template v-else>
					<div
						class="relations-focus-card"
						:class="pika({
							padding: '10px 12px',
							borderRadius: 'var(--lab-radius)',
							border: '1px solid var(--lab-color-border)',
							background: 'var(--lab-color-surface)',
							display: 'flex',
							flexDirection: 'column',
							gap: '8px',
						})"
					>
						<div :class="pika({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })">
							<div :class="pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '13px' })">
								<strong>{{ model.selectedWidget.widgetType }}</strong>
								<span :class="pika({ color: 'var(--lab-color-text-muted)' })"> #{{ model.selectedWidget.widgetId }}</span>
							</div>
						</div>

						<!-- Counts -->
						<div :class="pika({ display: 'flex', gap: '8px', fontSize: '10px', fontFamily: 'var(--lab-font-mono)' })">
							<span
								v-if="model.selectedWidget.memberCounts.state"
								:class="pika({ color: 'var(--lab-color-ok)' })"
							>
								S {{ model.selectedWidget.memberCounts.state }}
							</span>
							<span
								v-if="model.selectedWidget.memberCounts.property"
								:class="pika({ color: 'var(--lab-color-warning)' })"
							>
								P {{ model.selectedWidget.memberCounts.property }}
							</span>
							<span
								v-if="model.selectedWidget.memberCounts.method"
								:class="pika({ color: 'var(--lab-color-accent)' })"
							>
								M {{ model.selectedWidget.memberCounts.method }}
							</span>
							<span :class="pika({ color: 'var(--lab-color-text-muted)', marginLeft: 'auto' })">
								{{ model.selectedWidget.memberCounts.total }} {{ i18n.t('members') }}
							</span>
						</div>

						<!-- Widget Members list -->
						<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' })">
							<span :class="pika({ fontSize: '10px', color: 'var(--lab-color-text-muted)', fontWeight: '600', textTransform: 'uppercase' })">
								{{ i18n.t('Members') }}
							</span>
							<div :class="pika({ display: 'flex', flexWrap: 'wrap', gap: '4px' })">
								<button
									v-for="member in model.selectedWidget.members"
									:key="`${member.kind}:${member.name}`"
									type="button"
									:class="pika({
										'display': 'inline-flex',
										'alignItems': 'center',
										'gap': '4px',
										'padding': '2px 6px',
										'borderRadius': '3px',
										'border': '1px solid var(--lab-color-border)',
										'background': 'var(--lab-color-surface-alt)',
										'color': 'var(--lab-color-text)',
										'fontFamily': 'var(--lab-font-mono)',
										'fontSize': '10px',
										'cursor': 'pointer',
										'$:hover': { borderColor: 'var(--lab-color-accent)' },
									})"
									:title="`Focus ${member.kind} '${member.name}'`"
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
										:class="pika({ color: 'var(--lab-color-warning)', fontWeight: 'bold' })"
									>W</span>
									<span
										v-if="member.invalidCycle"
										:class="pika({ color: 'var(--lab-color-danger)', fontWeight: 'bold' })"
									>!</span>
								</button>
							</div>
						</div>
					</div>

					<!-- Internal dependencies section (requirement 3: compact separate section) -->
					<div
						class="relations-internal-section"
						:class="pika({
							padding: '10px 12px',
							borderRadius: 'var(--lab-radius)',
							border: '1px solid var(--lab-color-border)',
							background: 'var(--lab-color-surface)',
							display: 'flex',
							flexDirection: 'column',
							gap: '6px',
						})"
					>
						<div :class="pika({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' })">
							<span :class="pika({ fontWeight: '600' })">{{ i18n.t('Internal dependencies') }}</span>
							<span :class="pika({ fontSize: '10px', color: 'var(--lab-color-text-muted)' })">
								{{ model.totalInternalCount }}
							</span>
						</div>

						<div
							v-if="model.internal.length === 0"
							:class="pika({ fontSize: '10px', color: 'var(--lab-color-text-muted)', fontStyle: 'italic' })"
						>
							{{ i18n.t('No internal dependencies between members') }}
						</div>

						<div
							v-else
							:class="pika({ display: 'flex', flexDirection: 'column', gap: '4px' })"
						>
							<div
								v-for="item in model.internal"
								:key="item.id"
								:class="pika({
									display: 'flex',
									alignItems: 'center',
									gap: '5px',
									fontSize: '10px',
									fontFamily: 'var(--lab-font-mono)',
									padding: '3px 0',
									borderBottom: '1px dashed var(--lab-color-border)',
								})"
							>
								<!-- Source member button -->
								<button
									type="button"
									:class="pika({
										'background': 'transparent',
										'border': 'none',
										'padding': '0',
										'cursor': 'pointer',
										'display': 'inline-flex',
										'alignItems': 'center',
										'gap': '3px',
										'fontFamily': 'var(--lab-font-mono)',
										'fontSize': '10px',
										'color': 'var(--lab-color-text)',
										'$:hover': { textDecoration: 'underline' },
									})"
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

								<span :class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '9px' })">
									{{ item.operation }}
								</span>

								<!-- Target member button -->
								<button
									v-if="item.resolved && item.targetMember"
									type="button"
									:class="pika({
										'background': 'transparent',
										'border': 'none',
										'padding': '0',
										'cursor': 'pointer',
										'display': 'inline-flex',
										'alignItems': 'center',
										'gap': '3px',
										'fontFamily': 'var(--lab-font-mono)',
										'fontSize': '10px',
										'color': 'var(--lab-color-text)',
										'$:hover': { textDecoration: 'underline' },
									})"
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
									class="relations-internal-stub-target"
									:class="pika({
										display: 'inline-flex',
										alignItems: 'center',
										gap: '4px',
										padding: '1px 6px',
										borderRadius: '3px',
										border: '1px dashed var(--lab-color-danger)',
										background: 'color-mix(in srgb, var(--lab-color-danger) 8%, transparent)',
										color: 'var(--lab-color-text)',
									})"
									:title="`${item.stubStatus}: ${item.stubTarget.targetDescription}`"
								>
									<span
										class="relations-kind-badge"
										:class="`relations-kind-badge--${item.stubTarget.memberKind}`"
									>
										{{ memberKindShort(item.stubTarget.memberKind) }}
									</span>
									<span :class="pika({ fontFamily: 'var(--lab-font-mono)' })">{{ item.stubTarget.memberName }}</span>
									<span :class="pika({ fontSize: '9px', color: 'var(--lab-color-danger)', fontWeight: '600' })">{{ i18n.t('unresolved') }}</span>
								</span>
							</div>
						</div>
					</div>
				</template>
			</div>
		</div>

		<!-- Right Column: Depends on (Outgoing) -->
		<div
			class="relations-column relations-column--outgoing"
			:class="pika({
				flex: '1 1 33%',
				minWidth: '220px',
				display: 'flex',
				flexDirection: 'column',
				minHeight: '0',
			})"
		>
			<div
				class="relations-column-header"
				:class="pika({
					padding: '8px 12px',
					borderBottom: '1px solid var(--lab-color-border)',
					background: 'var(--lab-color-surface-alt)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					fontSize: '11px',
					fontWeight: '600',
					flex: '0 0 auto',
				})"
			>
				<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
					<span>{{ i18n.t('Depends on') }}</span>
					<span :class="pika({ color: 'var(--lab-color-text-muted)' })">→</span>
				</div>
				<span
					class="relations-counter-badge"
					:class="pika({
						fontSize: '10px',
						padding: '1px 6px',
						borderRadius: '999px',
						background: 'var(--lab-color-surface)',
						border: '1px solid var(--lab-color-border)',
						color: 'var(--lab-color-text-muted)',
					})"
				>
					{{ model.totalDependsOnCount }}
				</span>
			</div>

			<div
				class="relations-column-content"
				:class="pika({
					flex: '1 1 auto',
					overflowY: 'auto',
					padding: '8px',
					display: 'flex',
					flexDirection: 'column',
					gap: '8px',
				})"
			>
				<div
					v-if="model.dependsOn.length === 0"
					:class="pika({
						padding: '16px 12px',
						fontSize: '11px',
						color: 'var(--lab-color-text-muted)',
						textAlign: 'center',
						fontStyle: 'italic',
					})"
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
</template>

<style scoped>
.relations-kind-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 13px;
	height: 13px;
	border-radius: 2px;
	font-size: 9px;
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
