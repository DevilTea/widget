<script setup lang="ts">
/**
 * Readonly, syntax-highlighted rendering of one already-resolved source string (issue #25 P3 Scope C).
 * #43 localizes only viewer-owned status/action chrome; the highlighted source text is never translated.
 */
import type { ImplementationLang } from '../../implementation/shiki-highlighter'
import { ref, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { highlightSource } from '../../implementation/shiki-highlighter'

const props = defineProps<{
	code: string
	lang: ImplementationLang
}>()

const i18n = useLabI18n()
const html = ref<string | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
const copyLabel = computedCopyLabel()

function computedCopyLabel() {
	return {
		get value(): string {
			switch (copyState.value) {
				case 'copied': return i18n.t('Copied')
				case 'failed': return i18n.t('Copy failed')
				default: return i18n.t('Copy')
			}
		},
	}
}

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
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<div :class="pika({ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
			<button
				type="button"
				:class="pika({ padding: '2px 8px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="copy"
			>
				{{ copyLabel.value }}
			</button>
		</div>
		<div :class="pika({ flex: '1 1 auto', minHeight: '0', overflow: 'auto', fontSize: '12px' })">
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
				v-html="html"
			/>
		</div>
	</div>
</template>
