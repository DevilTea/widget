<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { catalogToJson, createAuthorCatalogViewModel } from '../../author/catalog'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { getShowcase } from '../../showcases/registry'
import DeclaredEvents from '../events/DeclaredEvents.vue'

const store = useLabStore()
const i18n = useLabI18n()
const viewModel = computed(() => {
	const showcase = getShowcase(store.showcaseId.value)
	return createAuthorCatalogViewModel(store.session.system, { docs: showcase?.docs, configSchemas: showcase?.configSchemas })
})

const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyResetTimer: ReturnType<typeof setTimeout> | undefined
let isUnmounted = false

async function copyCatalog(): Promise<void> {
	try {
		const writeText = navigator.clipboard?.writeText
		if (writeText === undefined)
			throw new Error('Clipboard API unavailable')
		await writeText.call(navigator.clipboard, JSON.stringify(catalogToJson(viewModel.value.catalog, viewModel.value.widgets), null, 2))
		copyState.value = 'copied'
	}
	catch {
		copyState.value = 'failed'
	}
	finally {
		if (!isUnmounted) {
			if (copyResetTimer !== undefined)
				clearTimeout(copyResetTimer)
			copyResetTimer = setTimeout(() => {
				copyState.value = 'idle'
				copyResetTimer = undefined
			}, 1500)
		}
	}
}

onUnmounted(() => {
	isUnmounted = true
	if (copyResetTimer !== undefined)
		clearTimeout(copyResetTimer)
	copyResetTimer = undefined
})

function copyLabel(): string {
	switch (copyState.value) {
		case 'copied': return i18n.t('Copied')
		case 'failed': return i18n.t('Copy failed')
		default: return i18n.t('Copy catalog JSON')
	}
}
</script>

<template>
	<div class="h-full overflow-auto p-[10px]">
		<div class="flex items-center justify-between gap-[8px] mb-[10px]">
			<div class="text-lab-text-muted text-[12px]">
				{{ i18n.t('Widget types and authoring metadata from the current WidgetSystem catalog.') }}
			</div>
			<button
				type="button"
				data-testid="author-catalog-copy"
				class="shrink-0 p-[3px_8px] min-h-[24px] text-[11px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer"
				@click="copyCatalog"
			>
				{{ copyLabel() }}
			</button>
		</div>
		<div class="flex flex-col gap-[8px]">
			<article
				v-for="widget in viewModel.widgets"
				:key="widget.entry.type"
				:data-testid="`author-catalog-${widget.entry.type}`"
				class="p-[9px] border border-lab-border rounded-lab bg-lab-surface-alt"
			>
				<h3 class="m-[0_0_3px] text-[13px] font-lab-mono">
					{{ widget.entry.type }}
				</h3>
				<p
					v-if="widget.description !== ''"
					class="m-[0_0_8px] text-[12px] whitespace-pre-line"
				>
					{{ widget.description }}
				</p>
				<div class="flex flex-wrap gap-[4px] mb-[7px]">
					<span
						v-for="capability in ['config', 'slots', 'state', 'properties', 'methods', 'events'] as const"
						:key="capability"
						class="p-[2px_5px] rounded-[999px] text-[11px] border border-lab-border"
						:style="{ opacity: widget.capabilities[capability] ? '1' : '0.4' }"
					>
						{{ i18n.t(capability === 'config' ? 'Config' : capability === 'slots' ? 'Slots' : capability === 'state' ? 'State' : capability === 'properties' ? 'Properties' : capability === 'methods' ? 'Methods' : 'Events') }}
					</span>
				</div>
				<div
					v-if="widget.configDescription"
					class="text-[11px] mb-[5px] whitespace-pre-line"
				>
					<strong>{{ i18n.t('Config description') }}:</strong> {{ widget.configDescription }}
				</div>
				<details
					v-if="widget.configSchemaText !== null"
					:data-testid="`author-catalog-schema-${widget.entry.type}`"
					class="text-[11px] mb-[5px]"
				>
					<summary class="cursor-pointer min-h-[24px] list-item leading-[24px]">
						<strong>{{ i18n.t('Config JSON Schema') }}</strong>
					</summary>
					<pre class="m-[4px_0_0] p-[6px] max-h-[240px] overflow-auto text-[11px] font-lab-mono border border-lab-border rounded-lab">{{ widget.configSchemaText }}</pre>
				</details>
				<div
					v-if="widget.slots.some(slot => slot.description !== '')"
					class="text-[11px]"
				>
					<strong>{{ i18n.t('Slot descriptions') }}:</strong>
					<ul class="m-[4px_0_0] pl-[18px]">
						<li
							v-for="slot in widget.slots.filter(entry => entry.description !== '')"
							:key="slot.name"
						>
							<code>{{ slot.name }}</code>: {{ slot.description }}
						</li>
					</ul>
				</div>
				<div
					v-if="widget.capabilities.events"
					:data-testid="`author-catalog-events-${widget.entry.type}`"
					class="text-[11px] mt-[5px]"
				>
					<strong>{{ i18n.t('Events') }}:</strong>
					<div class="mt-[4px]">
						<DeclaredEvents
							:events="widget.events"
							:declared="widget.capabilities.events"
						/>
					</div>
				</div>
			</article>
		</div>
	</div>
</template>
