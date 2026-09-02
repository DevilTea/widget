<script setup lang="ts">
/**
 * The persistent Preview surface. `store.previewRuntime` only ever changes through
 * `LabSession`'s replacement-ordering hooks (see `use-lab-store.ts`): this component simply renders
 * whatever it currently holds, or an "unavailable" placeholder when the active Blueprint is invalid.
 * `store.renderer` is the current showcase's `createWidgetVueRenderer` root component — it changes
 * only through `store.switchShowcase()`, which already guarantees the old Preview subtree has
 * unmounted first. `WidgetRenderer` never disposes the Runtime — `LabSession` owns that lifecycle.
 *
 * `data-tutorial-target="preview"` (diagnostic #25 P1) is the Survey tour's step 1 spotlight target — the
 * whole scrollable Preview surface, not just the mounted widget tree, since step 1 is a plain
 * orientation ("this is the Interactive Survey") rather than a specific-control callout.
 *
 * Inspect mode (diagnostic #25 P2 "Preview -> semantic inspector bridge"): an opt-in, off-by-default toggle
 * in this panel's own header area (never `LabHeader.vue` — Preview owns this affordance since it is the
 * only panel it applies to). While active:
 *  - pointer-over resolves the innermost Inspect anchor under the cursor (`resolveInspectAnchor()`,
 *    over elements `useInspectAnchor()` stamped per-renderer) and highlights it with an outline
 *    (`lab-inspect-anchor--highlighted`, `src/styles/global.css` — a plain global class, not `pika()`,
 *    since it is applied imperatively via `classList` to an arbitrary descendant renderer's own DOM
 *    element, never through this component's own template/scope) plus a `type#id` badge — one shared
 *    absolutely-positioned element this panel owns, never allocated per-renderer;
 *  - the locked contract is "inspector selection ONLY — the underlying control is not also activated",
 *    which a `click`-only suppression cannot deliver: a real pointer activation runs `pointerdown` (and
 *    the browser's default focus-on-mousedown action for a focusable control) strictly *before* `click`,
 *    so a click-capture handler alone is too late to stop a native `<input>`/`<select>` from already
 *    being focused, beginning text selection, or otherwise reacting. This suppresses both boundaries:
 *    `@pointerdown.capture`/`@pointerup.capture` (`suppressPointerActivation()`) resolve the innermost
 *    anchor and `preventDefault()`/`stopPropagation()` the earlier pointer sequence itself (this is what
 *    actually stops native focus/selection/UI reaction), while the existing `@click.capture`
 *    (`onClickCapture()`) remains the semantic-selection *commit* path — canceling `pointerdown` does not
 *    remove the higher-level `click` event, so selection stays click-driven and still
 *    `preventDefault()`s/`stopPropagation()`s to keep the widget's own bubble-phase click listener (e.g.
 *    `ButtonRenderer`'s `press()`) from ever running;
 *  - drives the existing shared Lab focus at widget grain (`{ nodeId }`, no `member` — the same grain a
 *    bare Blueprint/Runtime tree-node click already uses) via `resolveWidgetFocus()` and activates the
 *    Blueprint tab through the existing `activeTab` bridge (`Workbench.vue`) for immediate visible
 *    feedback — Runtime/Graph already follow the same shared focus once opened;
 *  - Escape exits Inspect mode (`useInspectMode()`); toggling off restores normal Preview behavior
 *    immediately — every capture listener below is always attached but no-ops whenever `inspect.active`
 *    is `false`.
 *
 * No second semantic model: no "last interaction" registry, no tracing — only anchor -> existing focus.
 * Keyboard-driven inspection is out of P2 scope (see diagnostic #25 P2 return notes); the toggle button
 * itself is a normal, keyboard-operable button.
 *
 * "View implementation" (diagnostic #25 P3 Scope D, entry point 1): a small button next to the Inspect
 * toggle, enabled whenever the existing shared focus (`store.focus` — however it got there: an
 * Inspect-mode click, a Blueprint/Graph tree selection, or the tutorial) resolves to a widget type this
 * showcase's `sources.ts` curates. It never re-sets focus itself — the Implementation panel reads the
 * same `store.focus` reactively (see `ImplementationPanel.vue`), so there is nothing else to keep in
 * sync here. #43 localizes only these Preview-owned controls/explanatory strings; the hover badge keeps
 * the exact semantic `type#id` identity.
 */
import { computed, useTemplateRef, watch } from 'vue'
import { useImplementationExplorer } from '../../composables/use-implementation-explorer'
import { useInspectMode } from '../../composables/use-inspect-mode'
import { useLabI18n } from '../../composables/use-lab-i18n'
import { useLabStore } from '../../composables/use-lab-store'
import { resolveFocusedWidget } from '../../implementation/focused-widget'
import { resolveInspectAnchor } from '../../lab/inspect-anchor'
import { resolveWidgetFocus } from '../../lab/inspect-focus'
import { getShowcase } from '../../showcases/registry'
import PanelDescriptionBar from '../PanelDescriptionBar.vue'

const store = useLabStore()
const i18n = useLabI18n()
const inspect = useInspectMode()
const implementationExplorer = useImplementationExplorer()

const curatedEntryAvailable = computed(() => {
	const widget = resolveFocusedWidget(store.active.value.blueprint, store.focus.value)
	if (widget === null)
		return false
	const showcase = getShowcase(store.showcaseId.value)
	return showcase !== undefined && widget.type in showcase.sources
})

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
 * Suppresses the *earlier* pointer-activation boundary (merge-gate review round 1, blocker 1):
 * `pointerdown` — and the browser's default focus-on-mousedown action for a click-focusable control —
 * fires strictly before `click`, so a native `<input>`/`<select>` can already be focused (and can
 * already begin native reactions such as text selection) before a click-only handler ever runs.
 * Attached on both `pointerdown` and `pointerup` (capture phase) so no pointer-specific renderer/native
 * handler on either edge of the down/up sequence sees an un-suppressed event while Inspect is active.
 * This does not perform selection itself and does not remove the subsequent `click` event — that stays
 * `onClickCapture()`'s job below.
 */
function suppressPointerActivation(event: PointerEvent): void {
	if (!inspect.active.value)
		return

	const anchor = resolveInspectAnchor(event.target)
	if (anchor === null)
		return

	event.preventDefault()
	event.stopPropagation()
}

/**
 * Capture-phase per diagnostic #25 P2's approved interaction rule ("Suppress the underlying pointer
 * activation while Inspect is active"): the semantic-selection *commit* path. This must run, and be
 * able to `preventDefault()`/`stopPropagation()`, strictly before the actual widget's own (bubble-phase)
 * click listener — e.g. a CRM `ButtonRenderer`'s `press()` call. `stopPropagation()` called here, during
 * capture, stops the event before it ever reaches that bubble-phase listener at all (not merely before
 * some later capture-phase step). The *earlier* pointerdown/mousedown-driven native reactions (focus,
 * text-selection start, ...) are a separate boundary this handler alone cannot reach — see
 * `suppressPointerActivation()` above.
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
				:aria-label="i18n.t('Inspect')"
				:aria-pressed="inspect.active.value"
				:class="inspect.active.value
					? pika({ padding: '3px 10px', fontSize: '11px', fontWeight: '600', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-accent)', background: 'var(--lab-color-accent)', color: 'var(--lab-color-accent-contrast)', cursor: 'pointer' })
					: pika({ padding: '3px 10px', fontSize: '11px', borderRadius: 'var(--lab-radius)', border: '1px solid var(--lab-color-border)', background: 'var(--lab-color-surface-alt)', color: 'var(--lab-color-text)', cursor: 'pointer' })"
				@click="inspect.toggle()"
			>
				{{ i18n.t('Inspect') }}
			</button>
			<span
				v-if="inspect.active.value"
				:class="pika({ fontSize: '11px', color: 'var(--lab-color-text-muted)' })"
			>
				{{ i18n.t('Click a widget to focus it in Blueprint — Esc to exit') }}
			</span>
			<button
				type="button"
				data-testid="preview-view-implementation"
				:disabled="!curatedEntryAvailable"
				:class="pika({ 'marginLeft': 'auto', 'padding': '3px 10px', 'fontSize': '11px', 'borderRadius': 'var(--lab-radius)', 'border': '1px solid var(--lab-color-border)', 'background': 'var(--lab-color-surface-alt)', 'color': 'var(--lab-color-text)', 'cursor': 'pointer', '$:disabled': { opacity: '0.5', cursor: 'not-allowed' } })"
				@click="implementationExplorer.open()"
			>
				{{ i18n.t('View implementation') }}
			</button>
		</div>
		<div
			ref="previewSurface"
			data-tutorial-target="preview"
			:class="pika({ position: 'relative', flex: '1 1 auto', overflow: 'auto', padding: '16px', background: 'var(--lab-color-bg)', minHeight: '0' })"
			:style="{ cursor: inspect.active.value ? 'crosshair' : undefined }"
			@pointerover="onPointerOver"
			@pointerleave="onPointerLeaveSurface"
			@pointerdown.capture="suppressPointerActivation"
			@pointerup.capture="suppressPointerActivation"
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
				{{ i18n.t('Preview unavailable — the current Blueprint is invalid. See the Blueprint tab for diagnostics.') }}
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
