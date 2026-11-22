<script setup lang="ts">
/**
 * The Problems list next to the JSON editor (audit U06): why the JSON text cannot be applied (its syntax error, or Core's
 * refusal of its commit) and Core's
 * Blueprint diagnostics, each a button that jumps the editor to the source range it points at. Code and
 * message are Core's, verbatim (never translated or parsed); only the surrounding chrome is i18n'd. It owns
 * no Document state: `AuthorJsonView.vue` hands it the rows and performs the jump.
 *
 * Audit U16: Core reports an evaluation cycle once per Property in it, each time with the same member list. Those
 * diagnostics are shown as one collapsed entry that names the members; expanding it lists Core's own diagnostics,
 * one row each, unchanged. The summary still counts diagnostics, so it agrees with the header chip and the
 * Blueprint panel's "All diagnostics" view.
 */
import type { LabProblem } from '../../lab/problems'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, reactive, useTemplateRef, watch } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { groupProblems } from '../../lab/problems'

const props = defineProps<{
	problems: readonly LabProblem[]
	/** The JSON text differs from the Document (not committed yet, or it cannot be applied): Core's rows describe the Document, and say so. */
	textDiffers: boolean
}>()

const emit = defineEmits<{
	jump: [problem: LabProblem]
}>()

const i18n = useLabI18n()
const region = useTemplateRef<HTMLElement>('region')
const entries = computed(() => groupProblems(props.problems))
/** Which grouped entries are open (by cycle id). A new list of problems starts collapsed: the ids are positions, so they would otherwise carry over. */
const open = reactive<Record<string, boolean>>({})
watch(() => props.problems, () => {
	for (const key of Object.keys(open))
		delete open[key]
})

const summary = computed(() => props.problems.length === 0
	? i18n.t('No problems')
	: i18n.t(props.problems.length === 1 ? '{count} problem' : '{count} problems', { count: props.problems.length }))

/** Moves keyboard focus to the first row (or the region itself when the list is empty). */
function focusList(): void {
	const first = region.value?.querySelector<HTMLElement>('button[data-testid="problem-row"], button[data-testid="problem-group"]')
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
		class="flex max-h-40 min-h-12 shrink flex-col border-t border-default bg-muted text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
	>
		<div class="flex flex-none items-center gap-2 px-3 py-1.5">
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
				{{ i18n.t(textDiffers ? 'From the last change. Locations follow your current text.' : 'From the last change') }}
			</span>
		</div>
		<ul
			v-if="problems.length > 0"
			class="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto p-0 px-2 pb-2"
		>
			<li
				v-for="entry in entries"
				:key="entry.key"
			>
				<template v-if="entry.kind === 'problem'">
					<button
						type="button"
						data-testid="problem-row"
						:data-problem-code="entry.problem.code ?? 'syntax-error'"
						class="flex min-h-6 w-full cursor-pointer items-start gap-2 rounded-(--lab-radius) border border-default bg-default px-2 py-1 text-left text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
						:title="i18n.t('Go to location')"
						@click="emit('jump', entry.problem)"
					>
						<span
							class="mt-0.5 shrink-0 rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted"
						>{{ entry.problem.code ?? i18n.t('JSON syntax') }}</span>
						<span class="min-w-0 flex-1">
							<span class="block wrap-anywhere">{{ entry.problem.kind === 'syntax' ? `SyntaxError: ${entry.problem.message}` : entry.problem.message }}</span>
							<span
								v-if="entry.problem.locationLabel !== null"
								class="block wrap-anywhere font-mono text-[11px] text-muted"
							>{{ entry.problem.locationLabel }}</span>
						</span>
						<UIcon
							name="i-lucide-crosshair"
							class="mt-0.5 size-3.5 shrink-0 text-muted"
							aria-hidden="true"
						/>
					</button>
				</template>
				<div
					v-else
					data-testid="problem-cycle"
					:data-diagnostic-count="entry.problems.length"
					class="rounded-(--lab-radius) border border-default bg-default"
				>
					<button
						type="button"
						data-testid="problem-group"
						:aria-expanded="open[entry.key] === true"
						:aria-controls="`problem-group-${entry.key}`"
						class="flex min-h-6 w-full cursor-pointer items-start gap-2 rounded-(--lab-radius) px-2 py-1 text-left text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
						@click="open[entry.key] = open[entry.key] !== true"
					>
						<UIcon
							:name="open[entry.key] === true ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
							class="mt-0.5 size-3.5 shrink-0 text-muted"
							aria-hidden="true"
						/>
						<span
							class="mt-0.5 shrink-0 rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted"
						>property-evaluation-cycle</span>
						<span class="min-w-0 flex-1">
							<span class="block wrap-anywhere">{{ i18n.t('{count} members depend on each other in a loop', { count: entry.members.length }) }}</span>
							<span
								data-testid="problem-cycle-members"
								class="block wrap-anywhere font-mono text-[11px] text-muted"
							>{{ entry.members.join(', ') }}</span>
							<span class="block text-[11px] text-muted">{{ i18n.t(open[entry.key] === true ? 'Core reports this loop once per Property; hide those {count} diagnostics' : 'Core reports this loop once per Property; show those {count} diagnostics', { count: entry.problems.length }) }}</span>
						</span>
					</button>
					<ul
						v-show="open[entry.key] === true"
						:id="`problem-group-${entry.key}`"
						class="m-0 flex list-none flex-col gap-1 p-0 px-2 pb-2"
					>
						<li
							v-for="problem in entry.problems"
							:key="problem.key"
						>
							<button
								type="button"
								data-testid="problem-row"
								:data-problem-code="problem.code ?? 'syntax-error'"
								class="flex min-h-6 w-full cursor-pointer items-start gap-2 rounded-(--lab-radius) border border-default bg-muted px-2 py-1 text-left text-default hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
								:title="i18n.t('Go to location')"
								@click="emit('jump', problem)"
							>
								<span class="mt-0.5 shrink-0 rounded-full bg-elevated px-1.5 font-mono text-[11px] text-muted">{{ problem.code }}</span>
								<span class="min-w-0 flex-1">
									<span class="block wrap-anywhere">{{ problem.message }}</span>
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
				</div>
			</li>
		</ul>
	</section>
</template>
