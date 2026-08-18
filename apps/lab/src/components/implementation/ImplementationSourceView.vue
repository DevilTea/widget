<script setup lang="ts">
/**
 * Readonly, syntax-highlighted rendering of one already-resolved source string (issue #25 P3 Scope C).
 * #45 makes this component the local overflow owner for long highlighted lines: every flex boundary can
 * shrink (`min-width: 0`) while the source viewport scrolls horizontally instead of widening Dockview or
 * the document. Shiki's generated `<pre>` remains content-sized inside that scroll viewport.
 */
import type { ImplementationLang } from '../../implementation/shiki-highlighter'
import { ref, watch } from 'vue'
import { CODE_TAB_SIZE } from '../../code-view/settings'
import { highlightSource } from '../../implementation/shiki-highlighter'

const props = defineProps<{
	code: string
	lang: ImplementationLang
}>()

const html = ref<string | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const copyLabel = ref('Copy')

watch(
	() => [props.code, props.lang] as const,
	([code, lang], _previous, onCleanup) => {
		let cancelled = false
		onCleanup(() => {
			cancelled = true
		})

		status.value = 'loading'
		html.value = null

		highlightSource(code, lang)
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
		copyLabel.value = 'Copied'
	}
	catch {
		copyLabel.value = 'Copy failed'
	}
	finally {
		setTimeout(() => {
			copyLabel.value = 'Copy'
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
				Loading…
			</p>
			<p
				v-else-if="status === 'error'"
				:class="pika({ padding: '10px', color: 'var(--lab-color-danger)' })"
			>
				Failed to render this source.
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
