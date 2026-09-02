<script setup lang="ts">
/**
 * Renders the frozen Blueprint diagnostic snapshot. Taxonomy is read from the top-level `code` and
 * ownership from `location`; variant payloads are never recovered by parsing `message`.
 */
import type { BlueprintDependencyReference, BlueprintDiagnostic, BlueprintDiagnosticLocation, BlueprintWidgetNode, DiagnosticPath } from '@deviltea/widget-core'
import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { inspectionNodeIdOfLocation } from '../../lab/diagnostics'
import { formatDependencyReference, formatDiagnosticPath } from '../../lib/diagnostic-format'

defineProps<{
	diagnostics: readonly BlueprintDiagnostic[]
	inspection: BlueprintInspection
}>()

const emit = defineEmits<{
	navigate: [nodeId: InspectionNodeId]
}>()

const i18n = useLabI18n()

function nodeIdOf(node: BlueprintWidgetNode, inspection: BlueprintInspection): InspectionNodeId | null {
	return inspection.getNodeId(node)
}

function pathOf(diagnostic: BlueprintDiagnostic): DiagnosticPath | undefined {
	return 'path' in diagnostic ? diagnostic.path : undefined
}

function dependencyOf(diagnostic: BlueprintDiagnostic): BlueprintDependencyReference | undefined {
	return 'dependency' in diagnostic ? diagnostic.dependency : undefined
}

function relatedOf(diagnostic: BlueprintDiagnostic): readonly BlueprintDiagnosticLocation[] {
	return 'related' in diagnostic && diagnostic.related !== undefined ? diagnostic.related : []
}

function nodeIdOfLocation(location: BlueprintDiagnosticLocation, inspection: BlueprintInspection): InspectionNodeId | null {
	return inspectionNodeIdOfLocation(location, inspection)
}

function locationLabel(diagnostic: BlueprintDiagnostic, inspection: BlueprintInspection): string {
	const location = diagnostic.location
	if (location.type === 'source')
		return 'source'
	const nodeId = nodeIdOf(location.node, inspection)
	const node = nodeId === null ? null : inspection.getNode(nodeId)
	const nodeLabel = node?.resolved
		? `${node.node.id} : ${node.node.type}`
		: (() => {
				const source = node?.node.source
				if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
					const hintedId = typeof (source as Record<string, unknown>).id === 'string' ? (source as Record<string, string>).id : '?'
					const hintedType = typeof (source as Record<string, unknown>).type === 'string' ? (source as Record<string, string>).type : '?'
					return `${hintedId} : ${hintedType} (unresolved)`
				}
				return 'unresolved node'
			})()
	switch (location.type) {
		case 'widget': return `widget "${nodeLabel}"`
		case 'slot': return `widget "${nodeLabel}" · slot "${location.slot}"`
		case 'slot-child': return `widget "${nodeLabel}" · slot "${location.slot}"[${location.index}]`
		case 'property': return `widget "${nodeLabel}" · property "${location.name}"`
		case 'method': return `widget "${nodeLabel}" · method "${location.name}"`
	}
}

function relatedLocationLabel(location: BlueprintDiagnosticLocation): string {
	switch (location.type) {
		case 'source':
			return 'source'
		case 'widget':
			return 'widget'
		case 'slot':
			return `slot "${location.slot}"`
		case 'slot-child':
			return `slot "${location.slot}"[${location.index}]`
		case 'property':
			return `property "${location.name}"`
		case 'method':
			return `method "${location.name}"`
	}
}

function onNavigateToLocation(location: BlueprintDiagnosticLocation, inspection: BlueprintInspection): void {
	const nodeId = nodeIdOfLocation(location, inspection)
	if (nodeId !== null)
		emit('navigate', nodeId)
}
</script>

<template>
	<ul :class="pika({ listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '6px' })">
		<li
			v-if="diagnostics.length === 0"
			:class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '12px' })"
		>
			{{ i18n.t('No diagnostics.') }}
		</li>
		<li
			v-for="(diagnostic, index) in diagnostics"
			:key="index"
			:data-testid="`blueprint-diagnostic-${index}`"
			:class="pika({ border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', padding: '6px 8px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' })"
		>
			<div :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
				<span :class="pika({ fontFamily: 'var(--lab-font-mono)', fontSize: '10px', padding: '1px 5px', borderRadius: '999px', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text-muted)' })">
					{{ diagnostic.code }}
				</span>
				<button
					v-if="nodeIdOfLocation(diagnostic.location, inspection) !== null"
					type="button"
					:data-testid="`blueprint-diagnostic-navigate-${index}`"
					:class="pika({ marginLeft: 'auto', fontSize: '11px', color: 'var(--lab-color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0' })"
					@click="emit('navigate', nodeIdOfLocation(diagnostic.location, inspection)!)"
				>
					{{ i18n.t('jump to node') }}
				</button>
			</div>

			<div>{{ diagnostic.message }}</div>
			<dl
				:data-testid="`blueprint-diagnostic-location-${index}`"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('location') }}: {{ locationLabel(diagnostic, inspection) }}
			</dl>

			<dl
				v-if="pathOf(diagnostic) !== undefined"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })"
			>
				path: {{ formatDiagnosticPath(pathOf(diagnostic)) }}
			</dl>
			<dl
				v-if="diagnostic.location.type === 'slot' || diagnostic.location.type === 'slot-child'"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })"
			>
				slot: "{{ diagnostic.location.slot }}"<template v-if="diagnostic.location.type === 'slot-child'">
					[{{ diagnostic.location.index }}]
				</template>
			</dl>
			<dl
				v-if="dependencyOf(diagnostic) !== undefined"
				:class="pika({ margin: '0', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', color: 'var(--lab-color-text-muted)' })"
			>
				dependency: {{ formatDependencyReference(dependencyOf(diagnostic)!) }}
			</dl>

			<div
				v-if="relatedOf(diagnostic).length > 0"
				:class="pika({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', fontSize: '11px' })"
			>
				<span :class="pika({ color: 'var(--lab-color-text-muted)' })">related:</span>
				<button
					v-for="(location, relatedIndex) in relatedOf(diagnostic)"
					:key="relatedIndex"
					type="button"
					:disabled="nodeIdOfLocation(location, inspection) === null"
					:class="pika({ 'fontSize': '11px', 'color': 'var(--lab-color-accent)', 'background': 'var(--lab-color-surface-alt)', 'border': '1px solid var(--lab-color-border)', 'borderRadius': '999px', 'cursor': 'pointer', 'padding': '1px 7px', '$:disabled': { color: 'var(--lab-color-text-muted)', cursor: 'default' } })"
					@click="onNavigateToLocation(location, inspection)"
				>
					{{ relatedLocationLabel(location) }}
				</button>
			</div>
		</li>
	</ul>
</template>
