<script setup lang="ts">
/**
 * The persistent Preview surface. `store.previewRuntime` only ever changes through
 * `LabSession`'s replacement-ordering hooks (see `use-lab-store.ts`): this component simply renders
 * whatever it currently holds, or an "unavailable" placeholder when the active Blueprint is invalid.
 * `store.renderer` is the current showcase's `createWidgetVueRenderer` root component — it changes
 * only through `store.switchShowcase()`, which already guarantees the old Preview subtree has
 * unmounted first. `WidgetRenderer` never disposes the Runtime — `LabSession` owns that lifecycle.
 *
 * `data-tutorial-target="preview"` (issue #25 P1) is the Survey tour's step 1 spotlight target — the
 * whole scrollable Preview surface, not just the mounted widget tree, since step 1 is a plain
 * orientation ("this is the Interactive Survey") rather than a specific-control callout.
 *
 * Inspect mode (issue #25 P2 "Preview -> semantic inspector bridge"): an opt-in, off-by-default toggle
 * in this panel's own header area (never `LabHeader.vue` — Preview owns this affordance since it is the
 * only panel it applies to). While active:
 *  - pointer-over resolves the innermost Inspect anchor under the cursor (`resolveInspectAnchor()`,
 *    over elements `useInspectAnchor()` stamped per-renderer) and highlights it with an outline
 *    (`lab-inspect-anchor--highlighted`, `src/styles/global.css` — a plain global class, not `pika()`,
 *    since it is applied imperatively via `classList` to an arbitrary descendant renderer's own DOM
 *    element, never through this component's own template/scope) plus a `type#id` badge — one shared
 *    absolutely-positioned element this panel owns, never allocated per-renderer;
 *  - a capture-phase click listener (`@click.capture`) resolves the same innermost anchor and, when one
 *    is found, `preventDefault()`s/`stopPropagation()`s it — running and winning before the actual
 *    widget's own bubble-phase click listener (e.g. `ButtonRenderer`'s `press()`, a text `<input>`
 *    receiving the click/focus) ever runs, so Inspect clicks perform inspector selection ONLY — then
 *    drives the existing shared Lab focus at widget grain (`{ nodeId }`, no `member` — the same grain a
 *    bare Blueprint/Runtime tree-node click already uses) via `resolveWidgetFocus()` and activates the
 *    Blueprint tab through the existing `activeTab` bridge (`Workbench.vue`) for immediate visible
 *    feedback — Runtime/Graph already follow the same shared focus once opened;
 *  - Escape exits Inspect mode (`useInspectMode()`); toggling off restores normal Preview behavior
 *    immediately — the capture listener is always attached but no-ops whenever `inspect.active` is
 *    `false`.
 *
 * No second semantic model: no "last interaction" registry, no tracing — only anchor -> existing focus.
 * Keyboard-driven inspection is out of P2 scope (see issue #25 P2 return notes); the toggle button
 * itself is a normal, keyboard-operable button.
 */
import { useTemplateRef, watch } from 'vue'
import { useInspectMode } from '../../composables/use-inspect-mode'
import { useLabStore } from '../../composables/use-lab-store'
import { resolveInspectAnchor } from '../../lab/inspect-anchor'
import { resolveWidgetFocus } from '../../lab/inspect-focus'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const inspect = useInspectMode()

const previewSurface = useTemplateRef<HTMLDivElement>('previewSurface')

// The currently outlined DOM element, tracked outside Vue's own reactivity: it belongs to whichever
// showcase renderer component happens to be under the cursor, never to this component's own template,
// so it is toggled imperatively via `classList` rather than through a `:class` binding here.
let highlightedElement: Element | null = null

function clearHighlight(): void {
	highlightedElement?.classList.remove('lab-inspect-anchor--highlighted')
	highlightedElement = null
}

// Escape flips `inspect.active` off (inside `useInspectMode()`) — clear any leftover highlight/badge
// immediately rather than waiting for the next pointer event to notice.
watch(inspect.active, (active) => {
	if (!active) {
		clearHighlight()
		inspect.setHovered(null)
	}
})

function onPointerOver(event: PointerEvent): void {
	if (!inspect.active.value)
		return

	const anchor = resolveInspectAnchor(event.target)
	if (anchor === null) {
		clearHighlight()
		inspect.setHovered(null)
		return
	}

	if (anchor.element !== highlightedElement) {
		clearHighlight()
		anchor.element.classList.add('lab-inspect-anchor--highlighted')
		highlightedElement = anchor.element
	}
	inspect.setHovered({
		widgetId: anchor.widgetId,
		widgetType: anchor.widgetType,
		rect: anchor.element.getBoundingClientRect(),
	})
}

/** Fires once, only when the pointer actually leaves the whole scrollable Preview surface. */
function onPointerLeaveSurface(): void {
	clearHighlight()
	inspect.setHovered(null)
}

/**
 * Capture-phase per issue #25 P2's approved interaction rule ("Suppress the underlying pointer
 * activation while Inspect is active"): this must run, and be able to `preventDefault()`/
 * `stopPropagation()`, strictly before the actual widget's own (bubble-phase) click listener — e.g. a
 * CRM `ButtonRenderer`'s `press()` call, or a Survey `<input>`/`<select>` receiving the click.
 * `stopPropagation()` called here, during capture, stops the event before it ever reaches that
 * bubble-phase listener at all (not merely before some later capture-phase step).
 */
function onClickCapture(event: MouseEvent): void {
	if (!inspect.active.value)
		return

	const anchor = resolveInspectAnchor(event.target)
	if (anchor === null)
		return

	event.preventDefault()
	event.stopPropagation()

	const focus = resolveWidgetFocus(store.active.value.blueprint, anchor.widgetId)
	if (focus !== null) {
		store.setFocus(focus)
		store.activeTab.value = 'blueprint'
	}
}
</script>

<template>
	<div :class="pika({ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' })">
		<PanelDescriptionBar
			storageKey="widget-lab:panel-desc:preview"
			text="The Vue presentation of the running widgets — interact here"
		/>
		<div :class="pika({ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderBottom: '1px solid var(--lab-color-border)', flex: '0 0 auto' })">
			<button
				type="button"
				aria-label="Inspect"
				:aria-pressed="inspect.active.value"
				:class="inspect.active.value
					? pika({ padding: '3px 10px', fontSize: '11px', fontWeight: '600', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-accent)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })
					: pika({ padding: '3px 10px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="inspect.toggle()"
			>
				Inspect
			</button>
			<span
				v-if="inspect.active.value"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				Click a widget to focus it in Blueprint — Esc to exit
			</span>
		</div>
		<div
			ref="previewSurface"
			data-tutorial-target="preview"
			:class="pika({ position: 'relative', flex: '1 1 auto', overflow: 'auto', padding: '16px', background: 'var(--lab-color-bg)', minHeight: '0' })"
			:style="{ cursor: inspect.active.value ? 'crosshair' : undefined }"
			@pointerover="onPointerOver"
			@pointerleave="onPointerLeaveSurface"
			@click.capture="onClickCapture"
		>
			<component
				:is="store.renderer.value"
				v-if="store.previewRuntime.value !== null"
				:runtime="store.previewRuntime.value"
			/>
			<p
				v-else
				:class="pika({ color: 'var(--lab-color-text-muted)', fontSize: '13px' })"
			>
				Preview unavailable — the current Blueprint is invalid. See the Blueprint tab for diagnostics.
			</p>
			<div
				v-if="inspect.hovered.value !== null && previewSurface !== null"
				aria-hidden="true"
				:class="pika({ position: 'absolute', zIndex: '10', padding: '2px 6px', fontSize: '10px', fontWeight: '600', borderRadius: 'var(--lab-radius)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', pointerEvents: 'none', whiteSpace: 'nowrap' })"
				:style="{
					top: `${inspect.hovered.value.rect.top - previewSurface.getBoundingClientRect().top + previewSurface.scrollTop}px`,
					left: `${inspect.hovered.value.rect.left - previewSurface.getBoundingClientRect().left + previewSurface.scrollLeft}px`,
					transform: 'translateY(-100%)',
				}"
			>
				{{ inspect.hovered.value.widgetType }}#{{ inspect.hovered.value.widgetId }}
			</div>
		</div>
	</div>
</template>
