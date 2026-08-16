<script setup lang="ts">
/**
 * Readonly, syntax-highlighted rendering of one already-resolved source string (issue #25 P3 Scope C).
 * Used both for a curated file's raw text (via `ImplementationFile.vue`, once its `load()` thunk has
 * resolved) and for the Applied-instance JSON fragment (`ImplementationPanel.vue`, already available
 * synchronously from the active snapshot — no `load()` involved). Highlighting itself is still async
 * (Shiki's `codeToHtml`), which is why this component owns its own loading/error state despite `code`
 * being a plain, already-resolved prop.
 *
 * `src/implementation/shiki-highlighter.ts` is imported here — the innermost point of the
 * Implementation panel's own lazy chunk (see that module's file header for the full lazy-boundary
 * chain) — never anywhere the eager shell could reach.
 *
 * Latest-selection-wins (same race class as `ImplementationFile.vue`'s blocker 1 fix, applied here
 * too): this component is reused as `code`/`lang` change (a new curated file, or a fresh Applied
 * instance JSON string), and Shiki's own `codeToHtml` is itself async — a slower earlier highlight call
 * could otherwise settle after a faster later one and overwrite it. `watch()`'s `onCleanup` flips
 * `cancelled` the instant this watcher is about to re-run (or is stopped), and both the success and
 * failure branches check it before writing `html`/`status`.
 */
import type { ImplementationLang } from '../../implementation/shiki-highlighter'
import { ref, watch } from 'vue'
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
			<!--
				eslint-disable-next-line vue/no-v-html -- `html` is Shiki's OWN generated markup, never a
				string this component passes through untouched. `code` itself is NOT always Lab-curated,
				build-time-only text — the Applied-instance JSON fragment (`ImplementationPanel.vue`) is
				derived from the user-editable applied Source, so the real trust boundary here is Shiki's
				`codeToHtml`, which HTML-escapes every token it renders (it is a tokenizer/renderer, not a
				pass-through) — not any assumption about `code`'s provenance. Safety rests on Shiki always
				escaping arbitrary input text into markup, the same way any other "render code as HTML"
				library would have to.
			-->
			<div
				v-else
				data-testid="implementation-code"
				:class="pika({ padding: '10px' })"
				v-html="html"
			/>
		</div>
	</div>
</template>
