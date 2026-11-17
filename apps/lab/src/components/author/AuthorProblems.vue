<script setup lang="ts">
/**
 * The Problems list next to the JSON editor (audit U06): the last Apply's JSON syntax error and Core's
 * Blueprint diagnostics, each a button that jumps the editor to the source range it points at. Code and
 * message are Core's, verbatim (never translated or parsed); only the surrounding chrome is i18n'd. It owns
 * no Document state: `AuthorJsonView.vue` hands it the rows and performs the jump.
 */
import type { LabProblem } from '../../lab/problems'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, useTemplateRef } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'

const props = defineProps<{
	problems: readonly LabProblem[]
	/** The editor holds an unapplied draft: rows still describe the last Apply, and say so. */
	draftIsDirty: boolean
}>()

const emit = defineEmits<{
	jump: [problem: LabProblem]
}>()

const i18n = useLabI18n()
const region = useTemplateRef<HTMLElement>('region')

const summary = computed(() => props.problems.length === 0
	? i18n.t('No problems')
	: i18n.t(props.problems.length === 1 ? '{count} problem' : '{count} problems', { count: props.problems.length }))

/** Moves keyboard focus to the first row (or the region itself when the list is empty). */
function focusList(): void {
	const first = region.value?.querySelector<HTMLElement>('button[data-testid="problem-row"]')
	const target = first ?? region.value
	target?.focus()
	target?.scrollIntoView({ block: 'nearest' })
}

defineExpose({ focusList })
</script>

<template>
	<section
		ref="region"
		data-testid="author-problems"
		:data-problem-count="problems.length"
		tabindex="-1"
		:aria-label="i18n.t('Problems')"
		class="flex max-h-48 min-h-0 flex-none flex-col border-t border-default bg-muted text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
	>
		<header class="flex flex-none items-center gap-2 px-3 py-1.5">
			<h3 class="m-0 text-xs font-semibold">
				{{ i18n.t('Problems') }}
			</h3>
			<span
				data-testid="author-problems-summary"
				role="status"
				:class="problems.length === 0 ? 'text-muted' : 'font-semibold text-error'"
			>{{ summary }}</span>
			<span
				v-if="problems.length > 0"
				class="ml-auto truncate text-muted"
			>
				{{ i18n.t(draftIsDirty ? 'From the last Apply. Locations follow your current text.' : 'From the last Apply') }}
			</span>
		</header>
		<ul
			v-if="problems.length > 0"
			class="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto p-0 px-2 pb-2"
		>
			<li
				v-for="problem in problems"
				:key="problem.key"
			>
				<button
					type="button"
					data-testid="problem-row"
					:data-problem-code="problem.code ?? 'syntax-error'"
					class="flex min-h-6 w-full cursor-pointer items-start gap-2 rounded-(--lab-radius) border border-default bg-default px-2 py-1 text-left text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
					:title="i18n.t('Go to location')"
					@click="emit('jump', problem)"
				>
					<span
						class="mt-0.5 shrink-0 rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted"
					>{{ problem.code ?? i18n.t('JSON syntax') }}</span>
					<span class="min-w-0 flex-1">
						<span class="block wrap-anywhere">{{ problem.kind === 'syntax' ? `SyntaxError: ${problem.message}` : problem.message }}</span>
						<span
							v-if="problem.locationLabel !== null"
							class="block wrap-anywhere font-mono text-[11px] text-muted"
						>{{ problem.locationLabel }}</span>
					</span>
					<UIcon
						name="i-lucide-crosshair"
						class="mt-0.5 size-3.5 shrink-0 text-muted"
						aria-hidden="true"
					/>
				</button>
			</li>
		</ul>
	</section>
</template>
