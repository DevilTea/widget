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
 * then uses the same Apply pipeline").
 *
 * Serialized lifecycle transactions (PR #19 review 4940219714, finding 1): `apply()`, `applyPreset()`
 * and `switchShowcase()` all route through one `enqueue()` promise chain, so at most one of them is
 * ever running against the mutable `session`/`previewRuntime`/`currentShowcase` state at a time —
 * regardless of caller overlap (a switch fired while an Apply is mid-flight, or several switches fired
 * back to back). Without this, `LabSession`'s hooks close over the *mutable outer* `session` variable:
 * an in-flight `session.apply()` awaiting `detachPreview()`/`mountPreview()` could still be running
 * when a concurrent `switchShowcase()` reassigns `session` to a different `LabSession` instance, so the
 * old Apply's own `mountPreview()` hook (invoked after `switchShowcase()` already reassigned `session`)
 * would observe the *new* session instead of the one it actually compiled against — leaking the
 * Runtime it just created (never mounted, never disposed) or corrupting `previewRuntime`. Serializing
 * removes the interleaving by construction: `switchShowcase()`'s own teardown/attach/apply sequence
 * never starts until any prior queued transaction (Apply, preset, or another switch) has fully settled.
 *
 * Authoritative Apply boundary for showcase replacement (PR #19 review 4940219714, finding 2):
 * `new LabSession({ initialSourceText })`'s constructor synchronously seeds an initial Runtime — this
 * is the "initial-boot exception" the Source Apply lifecycle checkpoint carves out for the very first
 * session an app instance ever creates, never a template for *replacing* an already-active showcase.
 * `switchShowcase()` therefore treats that constructor-seeded Runtime as a purely internal, transient
 * bootstrap: it is never assigned to `previewRuntime` and is immediately super­seded by an explicit
 * `session.apply()` call, which is what actually crosses the applied-snapshot boundary, produces a real
 * `ApplyOutcome`, and toggles `isApplying` — the same authoritative pipeline manual editing and preset
 * selection already use. This makes `switchShowcase()`'s "loads the showcase source" step observably
 * indistinguishable, trace-wise, from applying a preset in place.
 *
 * Apply's command-start capture/concurrency stays at command-call time (PR #19 review 4940721401):
 * the paragraph above says `apply()`/`applyPreset()` "route through" `enqueue()`, but they must not be
 * deferred* by it — the locked Apply lifecycle (issue #13 comment 5289958311) requires the draft to be
 * captured, and a concurrent Apply to be rejected, synchronously at the moment `apply()`/`applyPreset()`
 * is called, not whenever the queue happens to reach that transaction. So `LabStore.apply()` and
 * `applyPreset()` call into `session.apply()`/`session.applyPreset()` directly and synchronously — outside
 * `enqueue()`'s `task` callback — and only hand the resulting, already in-flight promise to `enqueue()` to
 * await. `enqueue()` still does its job as the mutual-exclusion barrier (a queued `switchShowcase()` won't
 * start until that promise settles); it just never gets to choose when the Apply itself starts.
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
	/** No-op when `id` is unknown or already the current showcase. Serialized against Apply/itself. */
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
	// without re-wiring `computed()`/returned functions. The serialized `enqueue()` transaction queue
	// below is what makes that reassignment safe — see the file header.
	let session: LabSession
	let focusStore: InspectorFocusStore
	let unsubscribeSession: () => void
	let unsubscribeFocus: () => void

	// Final-disposal guard (PR #19 review 4940219714, finding 1's "final disposal has guard" ask):
	// `dispose()` itself stays synchronous (App.vue's `onUnmounted` calls it without awaiting, and
	// existing tests assert the Runtime is disposed immediately), but a lifecycle transaction that is
	// already mid-flight when `dispose()` runs cannot be synchronously cancelled — it will still resume
	// later and may still create/mount a Runtime. `disposed` lets `mountPreview()` recognize that case
	// (see `createHooks()` below) and dispose that Runtime immediately instead of mounting/leaking it.
	let disposed = false

	/**
	 * Serializes every lifecycle-mutating operation (`apply`, `applyPreset`, `switchShowcase`) into one
	 * chain: each call's `task` only starts once every previously enqueued task has settled, regardless
	 * of how the caller interleaves them. This is the fix for PR #19 review 4940219714 finding 1 — see
	 * the file header for the exact hazard it closes.
	 *
	 * Command-start capture/concurrency (PR #19 review 4940721401): this barrier must never be the thing
	 * that decides *when* an Apply's own draft capture or `isApplying` concurrency guard runs — those are
	 * `LabSession.apply()`'s contract (issue #13 comment 5289958311) and must fire synchronously, at
	 * command-call time. `apply()`/`applyPreset()` below therefore call into `session` directly, outside
	 * `task`, and only hand `enqueue()` the resulting (already in-flight) promise to await — `enqueue()`
	 * is purely the mutual-exclusion barrier that keeps `switchShowcase()` (whose own `task`, unlike
	 * Apply's, legitimately does start later, from inside the queue) from starting until that promise
	 * settles. Passing a *function that starts the real work* (as `switchShowcase` does) is correct when
	 * the work itself must wait its turn; passing one that just re-returns an already-started promise (as
	 * `apply`/`applyPreset` do) is correct when the work must not wait, only its completion.
	 */
	let transactionQueue: Promise<unknown> = Promise.resolve()
	function enqueue<T>(task: () => Promise<T>): Promise<T> {
		const settled = transactionQueue.then(task, task)
		transactionQueue = settled.then(() => undefined, () => undefined)
		return settled
	}

	function createHooks() {
		return {
			// Replacement ordering seam (issue #13 Phase 4 Apply-lifecycle comment): clearing the
			// Preview runtime unmounts the old `WidgetRenderer` subtree, and `nextTick()` waits for
			// that unmount to actually commit before `LabSession` disposes the old Runtime.
			detachPreview: async () => {
				previewRuntime.value = null
				await nextTick()
			},
			mountPreview: () => {
				if (disposed) {
					// The store was torn down while this Apply/switch was still in flight (see the
					// `disposed` comment above) — dispose the Runtime it just produced instead of
					// mounting it into a Preview nobody owns anymore.
					session.active.runtime?.dispose()
					return
				}
				previewRuntime.value = session.active.runtime
			},
		}
	}

	function attachInitial(showcase: ShowcaseEntry): void {
		// The one legitimate use of `LabSession`'s constructor-seeded Runtime as final state: the very
		// first session this Lab instance ever creates, with no prior Preview to detach and nothing to
		// race against (issue #13 "Source Apply lifecycle" checkpoint's "initial-boot exception").
		session = new LabSession({
			system: showcase.system,
			initialSourceText: showcase.defaultPreset.sourceText,
			hooks: createHooks(),
		})
		previewRuntime.value = session.active.runtime

		focusStore = createInspectorFocusStore(session)
		unsubscribeSession = session.subscribe(() => {
			sessionTick.value++
		})
		unsubscribeFocus = focusStore.subscribe(() => {
			focusTick.value++
		})
	}

	attachInitial(defaultShowcase)

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
	 * The body of `switchShowcase()`, run only from inside `enqueue()` — see the file header for both
	 * the serialization rationale (finding 1) and why this crosses `session.apply()`'s boundary instead
	 * of only relying on the replacement session's own constructor seeding (finding 2). Reads
	 * `currentShowcase`/`session` fresh (never captured before enqueueing) so repeated/queued switches
	 * each observe whatever the *previous* queued transaction actually left behind.
	 */
	async function performSwitchShowcase(id: string): Promise<void> {
		if (disposed)
			return
		if (id === currentShowcase.id)
			return
		const target = showcases.find(showcase => showcase.id === id)
		if (target === undefined)
			return

		// 1. Detach/dispose the OLD Runtime — the same ordering `LabSession.apply()` itself uses.
		const oldRuntime = session.active.runtime
		if (oldRuntime !== null) {
			previewRuntime.value = null
			await nextTick()
			if (!oldRuntime.isDisposed)
				oldRuntime.dispose()
		}
		unsubscribeSession()
		unsubscribeFocus()
		focusStore.dispose()

		// 2. Switch showcase context: bind a fresh `LabSession` to the target system. Its constructor
		// seeds a Runtime synchronously, but that Runtime is a purely internal bootstrap — it is never
		// assigned to `previewRuntime` and step 3 immediately supersedes it through the authoritative
		// Apply pipeline (finding 2), so nothing externally observable ever treats constructor seeding
		// as the applied snapshot for a showcase *replacement*.
		currentShowcase = target
		session = new LabSession({
			system: target.system,
			initialSourceText: target.defaultPreset.sourceText,
			hooks: createHooks(),
		})
		focusStore = createInspectorFocusStore(session)
		unsubscribeSession = session.subscribe(() => {
			sessionTick.value++
		})
		unsubscribeFocus = focusStore.subscribe(() => {
			focusTick.value++
		})

		showcaseId.value = target.id
		renderer.value = target.renderer
		presets.value = target.presets
		sessionTick.value++
		focusTick.value++

		if (disposed) {
			// Torn down mid-switch: dispose the bootstrap Runtime immediately rather than crossing the
			// Apply boundary into a store nobody owns anymore.
			session.active.runtime?.dispose()
			return
		}

		// 3. Load the showcase source through the SAME authoritative Apply pipeline manual editing and
		// preset selection already use. This disposes the constructor's own bootstrap Runtime (via
		// `hooks.detachPreview`/the pipeline's own old-Runtime disposal) and creates the Runtime that
		// actually gets mounted via `hooks.mountPreview`, producing a real `ApplyOutcome` and an
		// `isApplying` true→false transition — never a second, bypassing compilation path.
		await session.apply()
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
		// `session.apply()` is invoked here, synchronously, at command-call time — never deferred behind
		// `enqueue()`. See the "Command-start capture/concurrency" note above `enqueue()` for why: an
		// async function's own body runs synchronously up to its first `await`, so calling it inline is
		// what lets `LabSession.apply()`'s own capture-the-draft and `isApplying` concurrency guard fire
		// immediately, in this turn, exactly as the locked Apply lifecycle (issue #13 comment 5289958311)
		// requires. `enqueue()` only wraps the resulting (already in-flight) promise, so it still serves
		// as the mutual-exclusion barrier against a concurrent `switchShowcase()`.
		apply: () => {
			const outcome = session.apply()
			return enqueue(() => outcome)
		},
		format: () => session.format(),
		revert: () => session.revert(),
		applyPreset: (presetId) => {
			const preset = currentShowcase.presets.find(candidate => candidate.id === presetId)
			if (preset === undefined)
				return enqueue(async () => undefined)
			// Same reasoning as `apply()` above: `session.applyPreset()` synchronously sets the draft text
			// and synchronously starts `session.apply()` (capture + concurrency guard) before this line
			// returns. `enqueue()` only barriers a concurrent `switchShowcase()`/`apply()` behind it.
			const outcome = session.applyPreset(preset.sourceText)
			return enqueue(() => outcome)
		},
		switchShowcase: id => enqueue(() => performSwitchShowcase(id)),
		setFocus: next => focusStore.setFocus(next),
		/**
		 * Final application teardown. Widget Lab is the Runtime owner (issue #13 Phase 4 Apply-lifecycle
		 * comment), so this disposes the last active Runtime in addition to tearing down Lab-local
		 * subscriptions/focus listeners. The Preview `WidgetRenderer` subtree must have already unmounted
		 * before this runs — the caller (`App.vue`) invokes this from `onUnmounted`, which Vue guarantees
		 * fires only after every descendant (including Preview) has fully unmounted, never from
		 * `onBeforeUnmount`, which fires before descendants unmount.
		 *
		 * Stays synchronous by design (see the `disposed` comment above): it immediately disposes
		 * whatever is synchronously reachable right now, and sets `disposed` so any lifecycle
		 * transaction already in flight cleans up after itself (via `createHooks()`'s `mountPreview`
		 * guard) instead of mounting/leaking a Runtime after teardown.
		 */
		dispose: () => {
			if (disposed)
				return
			disposed = true
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
