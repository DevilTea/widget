<script setup lang="ts">
/**
 * Graph legend (diagnostic #25 P4 Scope C): a compact, dismissable disclosure explaining what
 * `GraphCanvas.vue`/`projection.ts` actually render — never inventing a visual encoding this panel does
 * not have. Content is verified against those two modules directly (not written from memory of the
 * design intent):
 *
 * - Member kinds use both letter badges (S/P/M) and restrained accents: State = ok, Property = warning,
 *   Method = accent. Invalid cycles add an explicit danger indicator, so no semantic distinction relies on
 *   color alone.
 * - The small "W" badge on a Method node is `transitivelyWrites` (the compiler-authoritative fact,
 *   `node.methods[].transitivelyWrites` — never recomputed by this app).
 * - The small "E" badge beside it is `transitivelyEmits` (`node.methods[].transitivelyEmits`): a Method that
 *   emits an Event, itself or through the Methods it invokes, is not read-only, so a Property may not depend
 *   on it. A Method with neither badge neither writes nor emits.
 * - Widget clusters are cards: collapsed cards lead with type, then `#id` and S/P/M inventory; expanded
 *   cards are compound inspector shells containing member nodes.
 * - Edges (`vue-flow.ts`'s `toVueFlow()`) distinguish `reads`/`writes`/`invokes` primarily through
 *   stroke treatment (thin solid / stronger solid / dashed). Cluster-level aggregate edges show only a
 *   compact dependency count; exact semantic operations stay available in edge details.
 * - Every edge ends in an arrowhead on its target: `A → B` means "A depends on B" (the Relations view lists B under "Depends on"
 *   for A and A under "Used by" for B). While a widget or member is focused, its edges turn to the accent colour and are tagged
 *   with those two Relations words and the other end ("Depends on #x" leaves it, "Used by #x" arrives at it); the other edges fade.
 * - Stub nodes (`projectSemanticGraph()`'s `absent`/`invalid` dependency statuses, never a fabricated
 *   resolved edge) render as dashed pills: gray for `absent` (hidden unless "Show absent references" is
 *   on), red for `invalid` (always shown, per the panel's own filter contract).
 *
 * #43 translates only this legend's explanatory presentation copy. State / Property / Method names,
 * edge-operation tokens (`reads` / `writes` / `invokes`), and `id : type` remain verbatim semantic
 * vocabulary. Disclosure mechanics and accessibility remain exactly as accepted in #25 P4.
 */
import { ref, useId } from 'vue'
import { useLabI18n } from '../../composables/use-lab-i18n'

const i18n = useLabI18n()
const open = ref(false)
const panelId = useId()

function toggle(): void {
	open.value = !open.value
}
</script>

<template>
	<div class="relative">
		<button
			type="button"
			:aria-expanded="open"
			:aria-controls="panelId"
			class="p-[3px_8px] min-h-[24px] text-[11px] rounded-lab border border-lab-border bg-lab-surface-alt text-lab-text cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
			@click="toggle"
		>
			{{ i18n.t('Legend') }}
		</button>

		<div
			v-if="open"
			:id="panelId"
			role="group"
			:aria-label="i18n.t('Graph legend')"
			class="absolute top-[calc(100%_+_4px)] left-0 z-[10] w-[300px] p-[10px_12px] rounded-lab border border-lab-border bg-lab-surface [box-shadow:0_8px_24px_color-mix(in_srgb,black_40%,transparent)] flex flex-col gap-[10px] text-[11px]"
		>
			<section>
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					{{ i18n.t('Widgets and members') }}
				</h5>
				<ul class="m-0 p-0 list-none flex flex-col gap-[4px]">
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[2px]"
							:style="{ border: '1px solid var(--lab-color-border)', boxShadow: '0 1px 3px color-mix(in srgb, var(--lab-color-text) 8%, transparent)' }"
						/>
						{{ i18n.t('Widget cluster — labeled') }} <code>type · #id</code>
					</li>
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[2px]"
							:style="{ border: '1.5px solid var(--lab-color-ok)' }"
						/>
						State
					</li>
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[2px]"
							:style="{ border: '1.5px solid var(--lab-color-warning)' }"
						/>
						Property
					</li>
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[2px]"
							:style="{ border: '1.5px solid var(--lab-color-accent)' }"
						/>
						{{ i18n.t('Method — a "W" badge means it transitively writes State') }}
					</li>
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[2px]"
							:style="{ border: '1.5px solid var(--lab-color-accent)' }"
						/>
						{{ i18n.t('Method — an "E" badge means it transitively emits an Event') }}
					</li>
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[2px]"
							:style="{ border: '1.5px solid var(--lab-color-danger)' }"
						/>
						{{ i18n.t('Any member in an invalid evaluation cycle (overrides its own kind color)') }}
					</li>
				</ul>
			</section>

			<section>
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					{{ i18n.t('Edges (owner → what it depends on)') }}
				</h5>
				<ul class="m-0 p-0 list-none flex flex-col gap-[4px]">
					<li class="flex items-center gap-[6px]">
						<span class="graph-legend-edge graph-legend-edge--reads" /><code>reads</code> — {{ i18n.t('a State or Property read') }}
					</li>
					<li class="flex items-center gap-[6px]">
						<span class="graph-legend-edge graph-legend-edge--writes" /><code>writes</code> — {{ i18n.t('a State write (Method-only)') }}
					</li>
					<li class="flex items-center gap-[6px]">
						<span class="graph-legend-edge graph-legend-edge--invokes" /><code>invokes</code> — {{ i18n.t('a Method invocation') }}
					</li>
				</ul>
				<p
					data-testid="graph-legend-direction"
					class="m-[4px_0_0]"
				>
					{{ i18n.t('The arrowhead is on the target: A → B means A depends on B. In Relations, B is listed under "Depends on" for A, and A under "Used by" for B.') }}
				</p>
				<p class="m-[4px_0_0]">
					{{ i18n.t('While a widget or member is selected, its edges turn blue and are tagged "Depends on #x" (they leave it) or "Used by #x" (they arrive at it); every other edge fades. A tag is left out where there is no room for it: the Relations view has the full list.') }}
				</p>
				<p class="m-[4px_0_0] text-lab-text-muted italic">
					{{ i18n.t('Line style distinguishes edge kinds; aggregate labels show dependency counts, while details preserve exact operations.') }}
				</p>
			</section>

			<section>
				<h5 class="m-[0_0_4px] text-[11px] uppercase text-lab-text-muted">
					{{ i18n.t('Stubs (a dependency with no resolved target)') }}
				</h5>
				<ul class="m-0 p-0 list-none flex flex-col gap-[4px]">
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[999px]"
							:style="{ border: '1px dashed var(--lab-color-text-muted)' }"
						/>
						{{ i18n.t('Absent — hidden unless "Show absent references" is on') }}
					</li>
					<li class="flex items-center gap-[6px]">
						<span
							class="inline-block w-[14px] h-[10px] rounded-[999px]"
							:style="{ border: '1px dashed var(--lab-color-danger)' }"
						/>
						{{ i18n.t('Invalid — always shown') }}
					</li>
				</ul>
			</section>
		</div>
	</div>
</template>

<style scoped>
.graph-legend-edge {
	width: 22px;
	height: 0;
	flex: 0 0 22px;
	border-top: 1.2px solid var(--lab-color-text-muted);
}

.graph-legend-edge--writes {
	border-top-width: 2px;
	border-top-color: color-mix(in srgb, var(--lab-color-warning) 76%, var(--lab-color-text-muted));
}

.graph-legend-edge--invokes {
	border-top-width: 1.5px;
	border-top-style: dashed;
	border-top-color: color-mix(in srgb, var(--lab-color-accent) 74%, var(--lab-color-text-muted));
}
</style>
