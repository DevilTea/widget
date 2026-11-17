<script setup lang="ts">
/**
 * The diagnostics a Method's latest call that returned reported (issue #230, audit U08): the structured facts of each
 * Core `RuntimeMethodDiagnostic` as the Inspector protocol 0.5 carries them. The `code`, `reason`, `path`,
 * `dependency` and `related` fields come from the diagnostic's structure and `message` is shown verbatim, never parsed.
 * `args` (a rejected call) and `result` / `received` (a failed call, a rejected dependency value) open as the same
 * expandable value tree the Runtime values use, with whatever the Inspector snapshot cut marked where it was cut, and a
 * dependency failure shows the diagnostic it was caused by. Shared by the Runtime inspectors and the Events log.
 * Presentation only: it invokes nothing.
 */
import type { InspectorRuntimeDiagnostic, InspectorRuntimeDiagnosticLocation } from '@deviltea/widget-inspector/protocol'
import type { InspectableValue } from '@deviltea/widget-inspector/value'
import { computed } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { formatDependencyReference, formatDiagnosticPath } from '../../lib/diagnostic-format'
import { hasTruncation } from '../../runtime-inspector/format-value'
import InspectableValueTree from './InspectableValueTree.vue'

defineOptions({ name: 'MethodDiagnosticList' })

const props = defineProps<{
	diagnostics: readonly InspectorRuntimeDiagnostic[]
	/** A list inside another diagnostic (its cause): no truncation note of its own and a lighter frame. */
	nested?: boolean
}>()

const i18n = useLabI18n()

function locationText(location: InspectorRuntimeDiagnosticLocation): string {
	return `${location.type} ${location.widgetId}.${location.name}`
}

/** The values a diagnostic carries, each labelled with the field it came from. */
function valuesOf(diagnostic: InspectorRuntimeDiagnostic): readonly { readonly field: string, readonly label?: string, readonly value: InspectableValue }[] {
	return [
		...(diagnostic.args ?? []).map((value, index) => ({ field: 'args', label: String(index), value })),
		...(diagnostic.result === undefined ? [] : [{ field: 'result', value: diagnostic.result }]),
		...(diagnostic.received === undefined ? [] : [{ field: 'received', value: diagnostic.received }]),
	]
}

const truncated = computed(() => !props.nested && props.diagnostics.some(function someTruncated(diagnostic): boolean {
	return valuesOf(diagnostic)
		.some(item => hasTruncation(item.value)) || (diagnostic.cause !== undefined && someTruncated(diagnostic.cause))
}))
</script>

<template>
	<div>
		<ul class="m-0 flex list-none flex-col gap-1.5 p-0">
			<li
				v-for="(diagnostic, index) in diagnostics"
				:key="index"
				data-testid="method-diagnostic"
				:data-code="diagnostic.code"
				class="flex flex-col gap-1 rounded-(--lab-radius) border border-default p-1.5 text-[11px]"
			>
				<span
					data-testid="method-diagnostic-code"
					class="self-start rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted"
				>{{ diagnostic.code }}</span>
				<div
					data-testid="method-diagnostic-message"
					class="whitespace-pre-wrap break-words"
				>
					{{ diagnostic.message }}
				</div>
				<dl
					v-if="diagnostic.reason !== undefined || diagnostic.path !== undefined || diagnostic.dependency !== undefined || (diagnostic.related?.length ?? 0) > 0"
					class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-mono text-muted"
				>
					<template v-if="diagnostic.reason !== undefined">
						<dt>reason</dt>
						<dd
							data-testid="method-diagnostic-reason"
							class="m-0 break-words"
						>
							{{ diagnostic.reason }}
						</dd>
					</template>
					<template v-if="diagnostic.path !== undefined && formatDiagnosticPath(diagnostic.path) !== null">
						<dt>path</dt>
						<dd class="m-0 break-words">
							{{ formatDiagnosticPath(diagnostic.path) }}
						</dd>
					</template>
					<template v-if="diagnostic.dependency !== undefined">
						<dt>dependency</dt>
						<dd class="m-0 break-words">
							{{ formatDependencyReference(diagnostic.dependency) }}
						</dd>
					</template>
					<template v-if="diagnostic.related !== undefined && diagnostic.related.length > 0">
						<dt>related</dt>
						<dd class="m-0 break-words">
							{{ diagnostic.related.map(locationText).join(', ') }}
						</dd>
					</template>
				</dl>
				<div
					v-for="item in valuesOf(diagnostic)"
					:key="`${item.field}:${item.label ?? ''}`"
					:data-testid="`method-diagnostic-${item.field}`"
					class="rounded-(--lab-radius) border border-default bg-muted p-1"
				>
					<span class="font-mono text-muted">{{ item.field }}{{ item.label === undefined ? '' : `[${item.label}]` }}</span>
					<InspectableValueTree :value="item.value" />
				</div>
				<div
					v-if="diagnostic.cause !== undefined"
					data-testid="method-diagnostic-cause"
				>
					<p class="m-0 mb-1 text-muted">
						{{ i18n.t('Caused by') }}
					</p>
					<MethodDiagnosticList
						:diagnostics="[diagnostic.cause]"
						nested
					/>
				</div>
			</li>
		</ul>
		<p
			v-if="truncated"
			data-testid="value-snapshot-note"
			class="m-0 mt-1 border-t border-default px-1 pt-1 text-[11px] text-muted"
		>
			{{ i18n.t('Parts of this value were left out by the Inspector snapshot, which limits depth, entries and string length. The Lab shows what the Inspector sends.') }}
		</p>
	</div>
</template>
