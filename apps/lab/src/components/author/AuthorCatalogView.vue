<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { catalogToJson, createAuthorCatalogViewModel } from '../../author/catalog'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import DeclaredEvents from '../events/DeclaredEvents.vue'

const store = useLabStore()
const i18n = useLabI18n()
const viewModel = computed(() => {
	void store.showcaseId.value
	return createAuthorCatalogViewModel(store.session.system)
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

function slotDescriptions(widget: ReturnType<typeof createAuthorCatalogViewModel>['widgets'][number]): readonly [string, string][] {
	return widget.entry.descriptions.slots === null ? [] : [...widget.entry.descriptions.slots.entries()]
}
</script>

<template>
	<div :class="pika({ height: '100%', overflow: 'auto', padding: '10px' })">
		<div :class="pika({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' })">
			<div :class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '12px' })">
				{{ i18n.t('Widget types and authoring metadata from the current WidgetSystem catalog.') }}
			</div>
			<button
				type="button"
				data-testid="author-catalog-copy"
				:class="pika({ flexShrink: '0', padding: '3px 8px', minHeight: '24px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="copyCatalog"
			>
				{{ copyLabel() }}
			</button>
		</div>
		<div :class="pika({ display: 'flex', flexDirection: 'column', gap: '8px' })">
			<article
				v-for="widget in viewModel.widgets"
				:key="widget.entry.type"
				:data-testid="`author-catalog-${widget.entry.type}`"
				:class="pika({ padding: '9px', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-surface-alt)' })"
			>
				<h3 :class="pika({ margin: '0 0 3px', fontSize: '13px', fontFamily: 'var(--lab-font-mono)' })">
					{{ widget.entry.type }}
				</h3>
				<p :class="pika({ margin: '0 0 8px', fontSize: '12px' })">
					{{ widget.entry.description }}
				</p>
				<div :class="pika({ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '7px' })">
					<span
						v-for="capability in ['config', 'slots', 'state', 'properties', 'methods', 'events'] as const"
						:key="capability"
						:class="pika({ padding: '2px 5px', borderRadius: '999px', fontSize: '11px', border: '1px solid var(--lab-color-border)' })"
						:style="{ opacity: widget.capabilities[capability] ? '1' : '0.4' }"
					>
						{{ i18n.t(capability === 'config' ? 'Config' : capability === 'slots' ? 'Slots' : capability === 'state' ? 'State' : capability === 'properties' ? 'Properties' : capability === 'methods' ? 'Methods' : 'Events') }}
					</span>
				</div>
				<div
					v-if="widget.entry.descriptions.config !== null"
					:class="pika({ fontSize: '11px', marginBottom: '5px' })"
				>
					<strong>{{ i18n.t('Config description') }}:</strong> {{ widget.entry.descriptions.config }}
				</div>
				<details
					v-if="widget.configSchemaText !== null"
					:data-testid="`author-catalog-schema-${widget.entry.type}`"
					:class="pika({ fontSize: '11px', marginBottom: '5px' })"
				>
					<summary :class="pika({ cursor: 'pointer', minHeight: '24px', display: 'list-item', lineHeight: '24px' })">
						<strong>{{ i18n.t('Config JSON Schema') }}</strong>
					</summary>
					<pre :class="pika({ margin: '4px 0 0', padding: '6px', maxHeight: '240px', overflow: 'auto', fontSize: '11px', fontFamily: 'var(--lab-font-mono)', border: '1px solid var(--lab-color-border)', borderRadius: 'var(--lab-radius)' })">{{ widget.configSchemaText }}</pre>
				</details>
				<div
					v-if="slotDescriptions(widget).length > 0"
					:class="pika({ fontSize: '11px' })"
				>
					<strong>{{ i18n.t('Slot descriptions') }}:</strong>
					<ul :class="pika({ margin: '4px 0 0', paddingLeft: '18px' })">
						<li
							v-for="([name, description]) in slotDescriptions(widget)"
							:key="name"
						>
							<code>{{ name }}</code>: {{ description }}
						</li>
					</ul>
				</div>
				<div
					v-if="widget.capabilities.events"
					:data-testid="`author-catalog-events-${widget.entry.type}`"
					:class="pika({ fontSize: '11px', marginTop: '5px' })"
				>
					<strong>{{ i18n.t('Events') }}:</strong>
					<div :class="pika({ marginTop: '4px' })">
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
