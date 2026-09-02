<script setup lang="ts">
import { computed } from 'vue'
import { createAuthorCatalogViewModel } from '../../author/catalog'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'

const store = useLabStore()
const i18n = useLabI18n()
const viewModel = computed(() => {
	void store.showcaseId.value
	return createAuthorCatalogViewModel(store.session.system)
})

function slotDescriptions(widget: ReturnType<typeof createAuthorCatalogViewModel>['widgets'][number]): readonly [string, string][] {
	return widget.entry.descriptions.slots === null ? [] : [...widget.entry.descriptions.slots.entries()]
}
</script>

<template>
	<div :class="pika({ height: '100%', overflow: 'auto', padding: '10px' })">
		<div :class="pika({ marginBottom: '10px', color: 'var(--lab-color-text-muted)', fontSize: '12px' })">
			{{ i18n.t('Widget types and authoring metadata from the current WidgetSystem catalog.') }}
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
						v-for="capability in ['config', 'slots', 'state', 'properties', 'methods'] as const"
						:key="capability"
						:class="pika({ padding: '2px 5px', borderRadius: '999px', fontSize: '10px', border: '1px solid var(--lab-color-border)' })"
						:style="{ opacity: widget.capabilities[capability] ? '1' : '0.4' }"
					>
						{{ i18n.t(capability === 'config' ? 'Config' : capability === 'slots' ? 'Slots' : capability === 'state' ? 'State' : capability === 'properties' ? 'Properties' : 'Methods') }}
					</span>
				</div>
				<div
					v-if="widget.entry.descriptions.config !== null"
					:class="pika({ fontSize: '11px', marginBottom: '5px' })"
				>
					<strong>{{ i18n.t('Config description') }}:</strong> {{ widget.entry.descriptions.config }}
				</div>
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
			</article>
		</div>
	</div>
</template>
