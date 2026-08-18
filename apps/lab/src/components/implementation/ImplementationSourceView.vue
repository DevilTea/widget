<script setup lang="ts">
/**
 * Readonly syntax-highlighted source. #44 treats Lab theme as another latest-selection-wins input: a
 * theme change re-highlights the already-resolved source with the bundled matching Shiki theme, but
 * never reloads raw source or changes/copies different text.
 */
import type { ImplementationLang } from '../../implementation/shiki-highlighter'
import { ref, watch } from 'vue'
import { useLabTheme } from '../../composables/use-lab-theme'
import { highlightSource } from '../../implementation/shiki-highlighter'

const props = defineProps<{
	code: string
	lang: ImplementationLang
}>()

const theme = useLabTheme()
const html = ref<string | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const copyLabel = ref('Copy')

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
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<div :class="pika({ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
			<button
				type="button"
				:class="pika({ padding: '2px 8px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="copy"
			>
				{{ copyLabel }}
			</button>
		</div>
		<div :class="pika({ flex: '1 1 auto', minHeight: '0', overflow: 'auto', fontSize: '12px' })">
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
				v-html="html"
			/>
		</div>
	</div>
</template>
