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

type BlueprintNodeLocation = Exclude<BlueprintDiagnosticLocation, { type: 'source' }>

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

/** Two locations are the same when every field matches (the `node` by identity, the rest by value). */
function isSameLocation(a: BlueprintDiagnosticLocation, b: BlueprintDiagnosticLocation): boolean {
	const left = a as unknown as Record<string, unknown>
	const right = b as unknown as Record<string, unknown>
	const keys = Object.keys(left)
	return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key])
}

/**
 * The diagnostic's related locations other than its own location. Core may list the diagnostic's own
 * member among `related` (a `property-evaluation-cycle` lists every member of the cycle, itself included,
 * in one list its diagnostics share), and the header row already shows that location. Returns a new
 * array; the frozen list is never mutated and the other entries keep their order.
 */
function relatedOf(diagnostic: BlueprintDiagnostic): readonly BlueprintDiagnosticLocation[] {
	if (!('related' in diagnostic) || diagnostic.related === undefined)
		return []
	return diagnostic.related.filter(location => !isSameLocation(location, diagnostic.location))
}

function nodeIdOfLocation(location: BlueprintDiagnosticLocation, inspection: BlueprintInspection): InspectionNodeId | null {
	return inspectionNodeIdOfLocation(location, inspection)
}

/** The widget part of a node location: `id : type`, with Core's `?` hints and `(unresolved)` for an unresolved node. */
function widgetLabelOf(location: BlueprintNodeLocation, inspection: BlueprintInspection): string {
	const nodeId = nodeIdOf(location.node, inspection)
	const node = nodeId === null ? null : inspection.getNode(nodeId)
	// Unresolved nodes carry Core's best-effort `id`/`type` hints (`null` when the authored value is not a string).
	return node === null
		? 'unresolved node'
		: node.resolved
			? `${node.node.id} : ${node.node.type}`
			: `${node.id ?? '?'} : ${node.type ?? '?'} (unresolved)`
}

/** The member part of a node location (`property "name"`, `slot "name"[i]`, ...); a bare widget has none. */
function memberLabelOf(location: BlueprintNodeLocation): string | null {
	switch (location.type) {
		case 'widget': return null
		case 'slot': return `slot "${location.slot}"`
		case 'slot-child': return `slot "${location.slot}"[${location.index}]`
		case 'property': return `property "${location.name}"`
		case 'method': return `method "${location.name}"`
	}
}

function locationLabel(diagnostic: BlueprintDiagnostic, inspection: BlueprintInspection): string {
	const location = diagnostic.location
	if (location.type === 'source')
		return 'source'
	const widget = `widget "${widgetLabelOf(location, inspection)}"`
	const member = memberLabelOf(location)
	return member === null ? widget : `${widget} · ${member}`
}

function sourcePathOf(location: BlueprintNodeLocation, inspection: BlueprintInspection): string | null {
	const nodeId = nodeIdOf(location.node, inspection)
	const node = nodeId === null ? null : inspection.getNode(nodeId)
	return node === null ? null : formatDiagnosticPath(node.sourcePath)
}

/**
 * A related chip names its widget with the header's `id : type` vocabulary and the same ` · ` separator, then
 * the member: `guests : Question · property "value"`. One rule everywhere: a related location on the
 * diagnostic's own widget (same `node`) stays short (member only, `widget` for the bare widget) because the
 * header already names that widget; every other location carries its widget. When two widgets in the
 * diagnostic (its own and its related ones) read the same `id : type` (`duplicate-widget-id`), the widget
 * also carries its source path (`@ slots.items[1]`) so the chips can be told apart.
 */
function relatedLocationLabel(location: BlueprintDiagnosticLocation, diagnostic: BlueprintDiagnostic, inspection: BlueprintInspection): string {
	if (location.type === 'source')
		return 'source'
	const member = memberLabelOf(location)
	const own = diagnostic.location
	if (own.type !== 'source' && own.node === location.node)
		return member ?? 'widget'
	const widgetLabel = widgetLabelOf(location, inspection)
	const labels = [own, ...relatedOf(diagnostic)].map(other => other.type === 'source' ? null : widgetLabelOf(other, inspection))
	const path = labels.filter(label => label === widgetLabel).length > 1 ? sourcePathOf(location, inspection) : null
	const widget = path === null ? widgetLabel : `${widgetLabel} @ ${path}`
	return member === null ? widget : `${widget} · ${member}`
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
					:title="relatedLocationLabel(location, diagnostic, inspection)"
					:class="pika({ 'fontSize': '11px', 'color': 'var(--lab-color-accent)', 'background': 'var(--lab-color-surface-alt)', 'border': '1px solid var(--lab-color-border)', 'borderRadius': '999px', 'cursor': 'pointer', 'padding': '1px 7px', 'maxWidth': '100%', 'minWidth': '0', 'overflow': 'hidden', 'textOverflow': 'ellipsis', 'whiteSpace': 'nowrap', '$:disabled': { color: 'var(--lab-color-text-muted)', cursor: 'default' } })"
					@click="onNavigateToLocation(location, inspection)"
				>
					{{ relatedLocationLabel(location, diagnostic, inspection) }}
				</button>
			</div>
		</li>
	</ul>
</template>
