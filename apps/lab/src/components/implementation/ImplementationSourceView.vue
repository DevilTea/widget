<script setup lang="ts">
/**
 * Readonly syntax-highlighted source. Theme and locale are presentation inputs only: theme re-highlights
 * the already-resolved source with a bundled theme; locale changes viewer-owned status/action chrome.
 * Source text itself is never translated or normalized. #45 owns local overflow and #46 owns four-column
 * literal-tab presentation.
 */
import type { ImplementationLang } from '../../implementation/shiki-highlighter'
import { computed, ref, watch } from 'vue'
import { CODE_TAB_SIZE } from '../../code-view/settings'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabTheme } from '../../composables/use-lab-theme'
import { highlightSource } from '../../implementation/shiki-highlighter'

const props = defineProps<{
	code: string
	lang: ImplementationLang
}>()

const i18n = useLabI18n()
const theme = useLabTheme()
const html = ref<string | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const copyLabel = computed(() => {
	switch (copyState.value) {
		case 'copied': return i18n.t('Copied')
		case 'failed': return i18n.t('Copy failed')
		default: return i18n.t('Copy')
	}
})

watch(
	() => [props.code, props.lang, theme.theme.value] as const,
	([code, lang, currentTheme], _previous, onCleanup) => {
		let cancelled = false
		onCleanup(() => {
			cancelled = true
		})

		status.value = 'loading'
		html.value = null

		highlightSource(code, lang, currentTheme)
			.then(
				(rendered) => {
					if (cancelled)
						return
					html.value = rendered
					status.value = 'ready'
				},
				() => {
					if (cancelled)
						return
					status.value = 'error'
				},
			)
	},
	{ immediate: true },
)

async function copy(): Promise<void> {
	try {
		await navigator.clipboard.writeText(props.code)
		copyState.value = 'copied'
	}
	catch {
		copyState.value = 'failed'
	}
	finally {
		setTimeout(() => {
			copyState.value = 'idle'
		}, 1500)
	}
}
</script>

<template>
	<div class="implementation-source-view">
		<div :class="pika({ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
			<button
				type="button"
				:class="pika({ padding: '2px 8px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="copy"
			>
				{{ copyLabel }}
			</button>
		</div>
		<div class="implementation-source-view__scroll">
			<p
				v-if="status === 'loading'"
				:class="pika({ padding: '10px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('Loading…') }}
			</p>
			<p
				v-else-if="status === 'error'"
				:class="pika({ padding: '10px', color: 'var(--lab-color-danger)' })"
			>
				{{ i18n.t('Failed to render this source.') }}
			</p>
			<!-- eslint-disable-next-line vue/no-v-html -- Shiki is the escaping/token-rendering boundary. -->
			<div
				v-else
				data-testid="implementation-code"
				:class="pika({ padding: '10px' })"
				:style="{ tabSize: String(CODE_TAB_SIZE) }"
				v-html="html"
			/>
		</div>
	</div>
</template>

<style scoped>
.implementation-source-view {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-width: 0;
	min-height: 0;
}

.implementation-source-view__scroll {
	flex: 1 1 auto;
	min-width: 0;
	min-height: 0;
	overflow: auto;
	font-size: 12px;
}

.implementation-source-view__scroll :deep(pre) {
	margin: 0;
	min-width: max-content;
}
</style>
