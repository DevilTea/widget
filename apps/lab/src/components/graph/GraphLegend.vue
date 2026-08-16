<script setup lang="ts">
/**
 * Graph legend (issue #25 P4 Scope C): a compact, dismissable disclosure explaining what
 * `GraphCanvas.vue`/`projection.ts` actually render — never inventing a visual encoding this panel does
 * not have. Content is verified against those two modules directly (not written from memory of the
 * design intent):
 *
 * - Member-kind border colors are `GraphCanvas.vue`'s own `memberBorderColor()`: State = success (green),
 *   Method = accent (blue), Property = the `else` branch (warning/amber) — and any member inside an
 *   `invalidCycle` (`projection.ts`'s `computeInvalidCycleVertexSets()`, projected verbatim from core's
 *   `BlueprintInspection.invalidCycles`) overrides its own kind color to danger (red), checked first.
 * - The small "W" badge on a Method node is `transitivelyWrites` (the compiler-authoritative fact,
 *   `node.methods[].transitivelyWrites` — never recomputed by this app).
 * - A widget cluster is the dashed box each member node's `parentNode` sits inside, labeled
 *   `id : type` (`projection.ts`'s `clusterIdOf`/`label` construction).
 * - Edges (`vue-flow.ts`'s `toVueFlow()`) are labeled with their operation — `reads` (state-get/
 *   property-get), `writes` (state-set, Method-only), `invokes` (method-invoke) — direction is the
 *   owning member -> the member it depends on. Verified: none of `graph-edge`/`graph-edge--reads`/
 *   `graph-edge--writes`/`graph-edge--invokes`/`graph-edge--invalid-cycle` (the CSS classes `vue-flow.ts`
 *   assigns) has any matching rule anywhere in this app's stylesheets today, so the operation LABEL is
 *   currently the only thing distinguishing edge kinds visually — this legend says exactly that, rather
 *   than implying a color-coding that does not exist.
 * - Stub nodes (`projectSemanticGraph()`'s `absent`/`invalid` dependency statuses, never a fabricated
 *   resolved edge) render as dashed pills: gray for `absent` (hidden unless "Show absent references" is
 *   on), red for `invalid` (always shown, per the panel's own filter contract).
 *
 * Disclosure pattern: a toggle button with `aria-expanded` plus a conditionally-rendered panel (not
 * native `<details>`/`<summary>`, to stay within this app's existing PikaCSS-styled-button vocabulary
 * rather than fighting `<summary>`'s browser-default marker/styling) — keyboard-operable via the button's
 * own native Enter/Space activation, and dismissable by pressing it again.
 */
import { ref } from 'vue'

const open = ref(false)

function toggle(): void {
	open.value = !open.value
}
</script>

<template>
	<div :class="pika({ position: 'relative' })">
		<button
			type="button"
			aria-haspopup="true"
			:aria-expanded="open"
			:class="pika({ 'padding': '3px 8px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
			@click="toggle"
		>
			Legend
		</button>

		<div
			v-if="open"
			role="group"
			aria-label="Graph legend"
			:class="pika({ position: 'absolute', top: 'calc(100% + 4px)', left: '0', zIndex: '10', width: '300px', padding: '10px 12px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface)', boxShadow: '0 8px 24px color-mix(in srgb, black 40%, transparent)', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '11px' })"
		>
			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '10px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					Widgets and members
				</h5>
				<ul :class="pika({ margin: '0', padding: '0', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' })">
					<li :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
						<span
							:class="pika({ display: 'inline-block', width: '14px', height: '10px', borderRadius: '2px' })"
							:style="{ border: '1px dashed var(--lab-color-border)' }"
						/>
						Widget cluster — labeled <code>id : type</code>
					</li>
					<li :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
						<span
							:class="pika({ display: 'inline-block', width: '14px', height: '10px', borderRadius: '2px' })"
							:style="{ border: '1.5px solid var(--lab-color-success)' }"
						/>
						State
					</li>
					<li :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
						<span
							:class="pika({ display: 'inline-block', width: '14px', height: '10px', borderRadius: '2px' })"
							:style="{ border: '1.5px solid var(--lab-color-warning)' }"
						/>
						Property
					</li>
					<li :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
						<span
							:class="pika({ display: 'inline-block', width: '14px', height: '10px', borderRadius: '2px' })"
							:style="{ border: '1.5px solid var(--lab-color-accent)' }"
						/>
						Method — a "W" badge means it transitively writes State
					</li>
					<li :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
						<span
							:class="pika({ display: 'inline-block', width: '14px', height: '10px', borderRadius: '2px' })"
							:style="{ border: '1.5px solid var(--lab-color-danger)' }"
						/>
						Any member in an invalid evaluation cycle (overrides its own kind color)
					</li>
				</ul>
			</section>

			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '10px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					Edges (owner → what it depends on)
				</h5>
				<ul :class="pika({ margin: '0', padding: '0', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' })">
					<li><code>reads</code> — a State or Property read</li>
					<li><code>writes</code> — a State write (Method-only)</li>
					<li><code>invokes</code> — a Method invocation</li>
				</ul>
				<p :class="pika({ margin: '4px 0 0', color: 'var(--lab-color-text-muted)', fontStyle: 'italic' })">
					The label is the only thing distinguishing edge kinds today — edge color is not yet
					meaningful.
				</p>
			</section>

			<section>
				<h5 :class="pika({ margin: '0 0 4px', fontSize: '10px', textTransform: 'uppercase', color: 'var(--lab-color-text-muted)' })">
					Stubs (a dependency with no resolved target)
				</h5>
				<ul :class="pika({ margin: '0', padding: '0', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' })">
					<li :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
						<span
							:class="pika({ display: 'inline-block', width: '14px', height: '10px', borderRadius: '999px' })"
							:style="{ border: '1px dashed var(--lab-color-text-muted)' }"
						/>
						Absent — hidden unless "Show absent references" is on
					</li>
					<li :class="pika({ display: 'flex', alignItems: 'center', gap: '6px' })">
						<span
							:class="pika({ display: 'inline-block', width: '14px', height: '10px', borderRadius: '999px' })"
							:style="{ border: '1px dashed var(--lab-color-danger)' }"
						/>
						Invalid — always shown
					</li>
				</ul>
			</section>
		</div>
	</div>
</template>
