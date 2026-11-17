<script setup lang="ts">
/**
 * A widget's config in the Blueprint inspector (audit U25). The resolved config (what the plugin's `resolve`
 * produced, and what the widget runs with) is shown by default. The authored config is one click away, and only
 * when it differs from the resolved one: when they are structurally equal there is one block and a note, not two
 * copies of the same JSON. Values are Core's inspection data, rendered verbatim.
 */
import { computed, ref } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { compareConfig } from '../../lib/config-compare'

const props = defineProps<{
	rawConfig: unknown
	config: unknown
}>()

const i18n = useLabI18n()
const showAuthored = ref(false)
const comparison = computed(() => compareConfig(props.rawConfig, props.config))
const shown = computed(() => comparison.value.kind === 'different' && showAuthored.value ? props.rawConfig : props.config)
const text = computed(() => JSON.stringify(shown.value, null, 2) ?? i18n.t('(nothing authored)'))
const changedKeys = computed(() => comparison.value.kind === 'different' ? comparison.value.changedKeys : [])
</script>

<template>
	<div
		data-testid="config-view"
		:data-config-state="comparison.kind"
		class="flex flex-col gap-1"
	>
		<div class="flex flex-wrap items-center gap-2 text-[11px] text-muted">
			<span
				v-if="comparison.kind === 'same'"
				data-testid="config-same-note"
			>{{ i18n.t('The resolved config is identical to the authored config.') }}</span>
			<template v-else>
				<div
					role="group"
					:aria-label="i18n.t('Which config to show')"
					class="inline-flex overflow-hidden rounded-(--lab-radius) border border-default"
				>
					<button
						type="button"
						data-testid="config-show-resolved"
						:aria-pressed="!showAuthored"
						class="min-h-6 cursor-pointer border-0 px-2 text-[11px] text-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="showAuthored ? 'bg-transparent hover:bg-elevated' : 'bg-elevated font-semibold'"
						@click="showAuthored = false"
					>
						{{ i18n.t('Resolved') }}
					</button>
					<button
						type="button"
						data-testid="config-show-authored"
						:aria-pressed="showAuthored"
						class="min-h-6 cursor-pointer border-0 border-l border-default px-2 text-[11px] text-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
						:class="showAuthored ? 'bg-elevated font-semibold' : 'bg-transparent hover:bg-elevated'"
						@click="showAuthored = true"
					>
						{{ i18n.t('As authored') }}
					</button>
				</div>
				<span data-testid="config-differs-note">
					{{ i18n.t(showAuthored ? 'Showing what was written in the source.' : 'Showing what the widget runs with after the plugin resolved it.') }}
					<template v-if="changedKeys.length > 0">
						{{ i18n.t('Differs in:') }} <code class="font-mono">{{ changedKeys.join(', ') }}</code>
					</template>
				</span>
			</template>
		</div>
		<pre
			data-testid="config-json"
			class="m-0 whitespace-pre-wrap font-mono text-[11px] wrap-anywhere"
		>{{ text }}</pre>
	</div>
</template>
