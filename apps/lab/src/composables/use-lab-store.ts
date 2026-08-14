/**
 * Vue reactivity bridge over the framework-agnostic `LabSession` / inspector focus store.
 *
 * `LabSession` and `createInspectorFocusStore` are plain TypeScript (see `src/lab/`), on purpose —
 * they carry the regression-worthy Apply lifecycle logic and stay independently unit-testable without
 * Vue. This module is the one place that adapts their plain-getter + `subscribe()` shape into Vue
 * `computed()` refs, and supplies the `LabSessionHooks` seam (`detachPreview` / `mountPreview`) that
 * guarantees the old Preview subtree actually unmounts (via `nextTick()`) before the old Runtime is
 * disposed.
 */

import type { WidgetSystemRuntime } from '@deviltea/widget-core'
import type { InjectionKey, Ref } from 'vue'
import type { InspectorFocus } from '../lab/focus'
import type { ApplyOutcome } from '../lab/types'
import type { SandboxPlugins } from '../sandbox/plugins'
import { computed, inject, nextTick, shallowRef } from 'vue'
import { createInspectorFocusStore } from '../lab/focus'
import { LabSession } from '../lab/session'
import { defaultSandboxPreset, sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'

export type LabToolTab = 'source' | 'blueprint' | 'runtime' | 'graph'

export interface LabStore {
	readonly session: LabSession<SandboxPlugins>
	/** The Runtime currently mounted in Preview — only ever changes through the Apply replacement seam. */
	readonly previewRuntime: Readonly<Ref<WidgetSystemRuntime<SandboxPlugins> | null>>
	readonly draftSourceText: Readonly<Ref<string>>
	readonly parseError: Readonly<Ref<LabSession['parseError']>>
	readonly active: Readonly<Ref<LabSession<SandboxPlugins>['active']>>
	readonly isApplying: Readonly<Ref<boolean>>
	readonly isDirty: Readonly<Ref<boolean>>
	readonly focus: Readonly<Ref<InspectorFocus | null>>
	readonly presets: typeof sandboxPresets
	readonly activeTab: Ref<LabToolTab>
	setDraftSourceText: (text: string) => void
	apply: () => Promise<ApplyOutcome>
	format: () => void
	revert: () => void
	applyPreset: (presetId: string) => Promise<ApplyOutcome | undefined>
	setFocus: (focus: InspectorFocus | null) => void
	dispose: () => void
}

export const LabStoreKey: InjectionKey<LabStore> = Symbol('widget-lab:store')

export function createLabStore(): LabStore {
	const previewRuntime = shallowRef<WidgetSystemRuntime<SandboxPlugins> | null>(null)

	const session = new LabSession<SandboxPlugins>({
		system: sandboxSystem,
		initialSourceText: defaultSandboxPreset.sourceText,
		hooks: {
			// Replacement ordering seam (issue #13 Phase 4 Apply-lifecycle comment): clearing the Preview
			// runtime unmounts the old `WidgetRenderer` subtree, and `nextTick()` waits for that unmount to
			// actually commit before `LabSession` disposes the old Runtime.
			detachPreview: async () => {
				previewRuntime.value = null
				await nextTick()
			},
			mountPreview: () => {
				previewRuntime.value = session.active.runtime
			},
		},
	})
	// The constructor seeds `active` synchronously without going through the hooks (there is no prior
	// Preview to unmount yet), so the initial Preview mount is seeded here instead.
	previewRuntime.value = session.active.runtime

	const focusStore = createInspectorFocusStore(session)

	const sessionTick = shallowRef(0)
	const unsubscribeSession = session.subscribe(() => {
		sessionTick.value++
	})
	const focusTick = shallowRef(0)
	const unsubscribeFocus = focusStore.subscribe(() => {
		focusTick.value++
	})

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

	return {
		session,
		previewRuntime,
		draftSourceText,
		parseError,
		active,
		isApplying,
		isDirty,
		focus,
		presets: sandboxPresets,
		activeTab,
		setDraftSourceText: text => session.setDraftSourceText(text),
		apply: () => session.apply(),
		format: () => session.format(),
		revert: () => session.revert(),
		applyPreset: async (presetId) => {
			const preset = sandboxPresets.find(candidate => candidate.id === presetId)
			if (preset === undefined)
				return undefined
			return session.applyPreset(preset.sourceText)
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
