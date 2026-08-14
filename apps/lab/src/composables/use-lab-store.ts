/**
 * Vue reactivity bridge over the framework-agnostic `LabSession` / inspector focus store.
 *
 * `LabSession` and `createInspectorFocusStore` are plain TypeScript (see `src/lab/`), on purpose —
 * they carry the regression-worthy Apply lifecycle logic and stay independently unit-testable without
 * Vue. This module is the one place that adapts their plain-getter + `subscribe()` shape into Vue
 * `computed()` refs, and supplies the `LabSessionHooks` seam (`detachPreview` / `mountPreview`) that
 * guarantees the old Preview subtree actually unmounts (via `nextTick()`) before the old Runtime is
 * disposed.
 *
 * `switchShowcase()` is the analogous, larger-grained replacement for the showcase registry itself
 * (issue #13 "Source Apply lifecycle" checkpoint, "Presets / showcase changes": "Switching showcases
 * ... detaches/disposes the old Runtime, switches showcase context, loads the showcase source, and
 * then uses the same Apply pipeline"): it tears down the current `LabSession`/focus store the same way
 * `dispose()` tears down the final one, then constructs a fresh `LabSession` bound to the target
 * showcase's `WidgetSystem` and default preset — the same `JSON.parse` -> `createBlueprint` ->
 * `createRuntime`-if-valid pipeline `LabSession`'s constructor already uses to seed its initial
 * snapshot.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { Component, InjectionKey, Ref } from 'vue'
import type { InspectorFocus, InspectorFocusStore } from '../lab/focus'
import type { ApplyOutcome } from '../lab/types'
import type { ShowcaseEntry, ShowcasePreset } from '../showcases/registry'
import { computed, inject, nextTick, shallowRef } from 'vue'
import { createInspectorFocusStore } from '../lab/focus'
import { LabSession } from '../lab/session'
import { defaultShowcase, showcases } from '../showcases/registry'

export type LabToolTab = 'source' | 'blueprint' | 'runtime' | 'graph'

export interface LabStore {
	readonly session: LabSession
	/** The Runtime currently mounted in Preview — only ever changes through the Apply replacement seam. */
	readonly previewRuntime: Readonly<Ref<WidgetSystemRuntime | null>>
	readonly draftSourceText: Readonly<Ref<string>>
	readonly parseError: Readonly<Ref<LabSession['parseError']>>
	readonly active: Readonly<Ref<LabSession['active']>>
	readonly isApplying: Readonly<Ref<boolean>>
	readonly isDirty: Readonly<Ref<boolean>>
	readonly focus: Readonly<Ref<InspectorFocus | null>>
	readonly showcases: readonly ShowcaseEntry[]
	readonly showcaseId: Readonly<Ref<string>>
	/** The current showcase's `createWidgetVueRenderer` root component — what Preview mounts. */
	readonly renderer: Readonly<Ref<Component>>
	readonly presets: Readonly<Ref<readonly ShowcasePreset[]>>
	readonly activeTab: Ref<LabToolTab>
	/**
	 * Dependency Graph presentation preferences (issue #13 Phase 5 "inspector panel interaction
	 * contract"): panel-local, and — unlike snapshot-bound focus/selections — deliberately not reset by
	 * `session.subscribe()`/Apply, since these plain refs live on the `LabStore` object itself rather than
	 * being derived from `session`.
	 */
	readonly graphShowAbsent: Ref<boolean>
	readonly graphShowIsolatedMembers: Ref<boolean>
	setDraftSourceText: (text: string) => void
	apply: () => Promise<ApplyOutcome>
	format: () => void
	revert: () => void
	applyPreset: (presetId: string) => Promise<ApplyOutcome | undefined>
	/** No-op when `id` is unknown or already the current showcase. */
	switchShowcase: (id: string) => Promise<void>
	setFocus: (focus: InspectorFocus | null) => void
	dispose: () => void
}

export const LabStoreKey: InjectionKey<LabStore> = Symbol('widget-lab:store')

export function createLabStore(): LabStore {
	const previewRuntime = shallowRef<WidgetSystemRuntime | null>(null)
	const showcaseId = shallowRef(defaultShowcase.id)
	const renderer = shallowRef<Component>(defaultShowcase.renderer)
	const presets = shallowRef<readonly ShowcasePreset[]>(defaultShowcase.presets)

	const sessionTick = shallowRef(0)
	const focusTick = shallowRef(0)

	let currentShowcase: ShowcaseEntry = defaultShowcase
	// Mutable by design: `switchShowcase` reassigns both on a showcase change. Every closure below reads
	// these at call time (never destructures them up front), so a reassignment is visible everywhere
	// without re-wiring `computed()`/returned functions.
	let session: LabSession
	let focusStore: InspectorFocusStore
	let unsubscribeSession: () => void
	let unsubscribeFocus: () => void

	function attach(showcase: ShowcaseEntry): void {
		session = new LabSession({
			system: showcase.system,
			initialSourceText: showcase.defaultPreset.sourceText,
			hooks: {
				// Replacement ordering seam (issue #13 Phase 4 Apply-lifecycle comment): clearing the
				// Preview runtime unmounts the old `WidgetRenderer` subtree, and `nextTick()` waits for
				// that unmount to actually commit before `LabSession` disposes the old Runtime.
				detachPreview: async () => {
					previewRuntime.value = null
					await nextTick()
				},
				mountPreview: () => {
					previewRuntime.value = session.active.runtime
				},
			},
		})
		// The constructor seeds `active` synchronously without going through the hooks (there is no
		// prior Preview to unmount yet), so the initial Preview mount is seeded here instead.
		previewRuntime.value = session.active.runtime

		focusStore = createInspectorFocusStore(session)

		unsubscribeSession = session.subscribe(() => {
			sessionTick.value++
		})
		unsubscribeFocus = focusStore.subscribe(() => {
			focusTick.value++
		})
	}

	attach(defaultShowcase)

	const draftSourceText = computed(() => {
		void sessionTick.value
		return session.draftSourceText
	})
	const parseError = computed(() => {
		void sessionTick.value
		return session.parseError
	})
	const active = computed(() => {
		void sessionTick.value
		return session.active
	})
	const isApplying = computed(() => {
		void sessionTick.value
		return session.isApplying
	})
	const isDirty = computed(() => {
		void sessionTick.value
		return session.isDirty
	})
	const focus = computed(() => {
		void focusTick.value
		return focusStore.getFocus()
	})

	const activeTab = shallowRef<LabToolTab>('source')
	const graphShowAbsent = shallowRef(false)
	const graphShowIsolatedMembers = shallowRef(false)

	/**
	 * Disposes the current session's Runtime/subscriptions only — never anything showcase-registry-wide.
	 * Shared by `switchShowcase` (which then re-`attach()`s a new session) and the final `dispose()`
	 * (which does not).
	 */
	async function teardownCurrentSession(): Promise<void> {
		const runtime = session.active.runtime
		if (runtime !== null) {
			previewRuntime.value = null
			await nextTick()
			if (!runtime.isDisposed)
				runtime.dispose()
		}
		unsubscribeSession()
		unsubscribeFocus()
		focusStore.dispose()
	}

	return {
		get session() {
			return session
		},
		previewRuntime,
		draftSourceText,
		parseError,
		active,
		isApplying,
		isDirty,
		focus,
		showcases,
		showcaseId,
		renderer,
		presets,
		activeTab,
		graphShowAbsent,
		graphShowIsolatedMembers,
		setDraftSourceText: text => session.setDraftSourceText(text),
		apply: () => session.apply(),
		format: () => session.format(),
		revert: () => session.revert(),
		applyPreset: async (presetId) => {
			const preset = currentShowcase.presets.find(candidate => candidate.id === presetId)
			if (preset === undefined)
				return undefined
			return session.applyPreset(preset.sourceText)
		},
		switchShowcase: async (id) => {
			if (id === currentShowcase.id)
				return
			const target = showcases.find(showcase => showcase.id === id)
			if (target === undefined)
				return

			await teardownCurrentSession()

			currentShowcase = target
			attach(target)
			showcaseId.value = target.id
			renderer.value = target.renderer
			presets.value = target.presets
			sessionTick.value++
			focusTick.value++
		},
		setFocus: next => focusStore.setFocus(next),
		/**
		 * Final application teardown. Widget Lab is the Runtime owner (issue #13 Phase 4 Apply-lifecycle
		 * comment), so this disposes the last active Runtime in addition to tearing down Lab-local
		 * subscriptions/focus listeners. The Preview `WidgetRenderer` subtree must have already unmounted
		 * before this runs — the caller (`App.vue`) invokes this from `onUnmounted`, which Vue guarantees
		 * fires only after every descendant (including Preview) has fully unmounted, never from
		 * `onBeforeUnmount`, which fires before descendants unmount.
		 */
		dispose: () => {
			unsubscribeSession()
			unsubscribeFocus()
			focusStore.dispose()
			const runtime = session.active.runtime
			if (runtime !== null && !runtime.isDisposed)
				runtime.dispose()
		},
	}
}

/**
 * `inject(LabStoreKey)` plus the required-provider assertion, in one place. Returning the asserted
 * `LabStore` type here (rather than narrowing an `undefined`-inclusive local via an early `throw`)
 * means every call site gets a plain, unconditionally-typed `LabStore` — including inside nested
 * `function` declarations, which do not retain a caller's own control-flow narrowing.
 */
export function useLabStore(): LabStore {
	const store = inject(LabStoreKey)
	if (store === undefined)
		throw new Error('useLabStore() was called outside the LabStore provider (App.vue).')
	return store
}
