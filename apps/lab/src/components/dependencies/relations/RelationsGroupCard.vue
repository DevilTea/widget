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
		class="relations-group-card"
		:class="[
			pika({
				borderRadius: 'var(--lab-radius)',
				border: '1px solid var(--lab-color-border)',
				background: 'var(--lab-color-surface)',
				display: 'flex',
				flexDirection: 'column',
				overflow: 'hidden',
			}),
			!group.isResolved && 'relations-group-card--unresolved',
		]"
	>
		<!-- Group Header (Remote Widget) -->
		<div
			class="relations-group-header"
			:class="pika({
				padding: '5px 8px',
				background: 'var(--lab-color-surface-alt)',
				borderBottom: '1px solid var(--lab-color-border)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: '6px',
				fontSize: '11px',
			})"
		>
			<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0' })">
				<button
					v-if="group.isResolved && group.nodeId !== undefined"
					type="button"
					:class="pika({
						'background': 'transparent',
						'border': 'none',
						'padding': '0',
						'cursor': 'pointer',
						'display': 'flex',
						'alignItems': 'center',
						'gap': '5px',
						'fontFamily': 'var(--lab-font-mono)',
						'fontSize': '11px',
						'color': 'var(--lab-color-text)',
						'textDecoration': 'none',
						'$:hover': { textDecoration: 'underline' },
					})"
					:title="`${group.widgetType ?? ''} #${group.widgetId}`"
					@click="emit('selectWidget', group.nodeId)"
				>
					<span
						v-if="group.widgetType"
						:class="pika({ fontWeight: 'bold' })"
					>{{ group.widgetType }}</span>
					<span :class="pika({ color: 'var(--lab-color-text-muted)' })">#{{ group.widgetId }}</span>
				</button>
				<div
					v-else
					:class="pika({
						display: 'flex',
						alignItems: 'center',
						gap: '5px',
						fontFamily: 'var(--lab-font-mono)',
						fontSize: '11px',
						color: 'var(--lab-color-text)',
					})"
				>
					<span
						v-if="group.widgetType"
						:class="pika({ fontWeight: 'bold' })"
					>{{ group.widgetType }}</span>
					<span :class="pika({ color: 'var(--lab-color-text-muted)' })">#{{ group.widgetId }}</span>
				</div>

				<span
					v-if="group.isSameWidget"
					:class="pika({
						fontSize: '9px',
						padding: '1px 4px',
						borderRadius: '2px',
						background: 'var(--lab-color-surface)',
						border: '1px solid var(--lab-color-border)',
						color: 'var(--lab-color-text-muted)',
					})"
				>
					{{ i18n.t('this widget') }}
				</span>
				<span
					v-if="!group.isResolved"
					:class="pika({
						fontSize: '9px',
						padding: '1px 4px',
						borderRadius: '2px',
						background: 'color-mix(in srgb, var(--lab-color-danger) 15%, transparent)',
						color: 'var(--lab-color-danger)',
						fontWeight: '600',
					})"
				>
					{{ i18n.t('unresolved') }}
				</span>
			</div>
			<span :class="pika({ fontSize: '10px', color: 'var(--lab-color-text-muted)' })">
				{{ group.rows.length }}
			</span>
		</div>

		<!-- Rows -->
		<div :class="pika({ display: 'flex', flexDirection: 'column' })">
			<div
				v-for="(row, index) in group.rows"
				:key="row.id"
				class="relations-row"
				:class="[
					pika({
						padding: '6px 8px',
						display: 'flex',
						flexDirection: 'column',
						gap: '3px',
						fontSize: '11px',
					}),
					index > 0 && pika({ borderTop: '1px dashed var(--lab-color-border)' }),
				]"
			>
				<!-- Operation and Members -->
				<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' })">
					<!-- In Widget Mode: show local member name -->
					<span
						v-if="isWidgetMode"
						:class="pika({
							fontFamily: 'var(--lab-font-mono)',
							fontSize: '10px',
							color: 'var(--lab-color-text)',
							background: 'var(--lab-color-surface-alt)',
							padding: '1px 5px',
							borderRadius: '3px',
						})"
						:title="`${row.localMember.kind}: ${row.localMember.name}`"
					>
						{{ row.localMember.name }}
					</span>

					<!-- Arrow indicating direction -->
					<span
						:class="pika({
							fontSize: '11px',
							color: 'var(--lab-color-text-muted)',
						})"
						aria-hidden="true"
					>
						{{ direction === 'incoming' ? '←' : '→' }}
					</span>

					<!-- Operation pill -->
					<span
						class="relations-operation-pill"
						:class="[
							`relations-operation-pill--${row.operation}`,
							pika({
								fontSize: '9px',
								padding: '1px 5px',
								borderRadius: '999px',
								fontFamily: 'var(--lab-font-mono)',
								textTransform: 'uppercase',
							}),
						]"
					>
						{{ row.operation }}
					</span>

					<!-- Remote member target -->
					<button
						v-if="row.resolved && row.remoteMember"
						type="button"
						class="relations-member-button"
						:class="[
							`relations-member-button--${row.remoteMember.kind}`,
							pika({
								'display': 'inline-flex',
								'alignItems': 'center',
								'gap': '4px',
								'padding': '1px 6px',
								'borderRadius': '3px',
								'border': '1px solid var(--lab-color-border)',
								'background': 'var(--lab-color-surface-alt)',
								'color': 'var(--lab-color-text)',
								'fontFamily': 'var(--lab-font-mono)',
								'fontSize': '11px',
								'cursor': 'pointer',
								'$:hover': {
									borderColor: 'var(--lab-color-accent)',
								},
							}),
						]"
						:title="`Focus ${row.remoteMember.kind} '${row.remoteMember.name}' in ${row.remoteMember.widgetType} #${row.remoteMember.widgetId}`"
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
						class="relations-stub-target"
						:class="[
							`relations-stub-target--${row.stubStatus}`,
							pika({
								display: 'inline-flex',
								alignItems: 'center',
								gap: '4px',
								padding: '1px 6px',
								borderRadius: '3px',
								border: '1px dashed var(--lab-color-danger)',
								background: 'color-mix(in srgb, var(--lab-color-danger) 8%, transparent)',
								color: 'var(--lab-color-text)',
								fontFamily: 'var(--lab-font-mono)',
								fontSize: '11px',
							}),
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
							:class="[pika({ fontSize: '9px', color: 'var(--lab-color-text-muted)', fontStyle: 'italic' }), row.stubStatus === 'invalid' && 'relations-stub-status--invalid']"
						>
							({{ row.stubStatus }})
						</span>
					</span>

					<!-- Invalid cycle flag -->
					<span
						v-if="row.invalidCycle"
						:class="pika({
							fontSize: '9px',
							fontWeight: 'bold',
							color: 'var(--lab-color-danger)',
							padding: '0 4px',
							borderRadius: '2px',
							background: 'color-mix(in srgb, var(--lab-color-danger) 15%, transparent)',
						})"
						title="invalid evaluation cycle"
					>
						! cycle
					</span>
				</div>

				<!-- Path context -->
				<div
					v-if="formatDiagnosticPath(row.path)"
					class="relations-row-path"
					:class="[
						pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '10px', color: 'var(--lab-color-text-muted)' }),
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
