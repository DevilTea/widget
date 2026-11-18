/**
 * Vue reactivity bridge over `../tutorial/`'s framework-agnostic `TutorialEngine` (diagnostic #25 P1) — the
 * one place that adapts its plain `getSnapshot()`/`subscribe()` shape into a Vue ref, owns the
 * deterministic-tour-start orchestration (`../tutorial/deterministic-start.ts`'s pure decision plus the
 * actual `LabStore.applyPreset()`/`switchShowcase()` calls the OWNER-locked policy requires), and
 * subscribes the passive Runtime-observation surface (`../tutorial/inspection-reader.ts`) that drives
 * `TutorialEngine.recheck()`. Mirrors `use-lab-store.ts`'s role for `LabSession`.
 *
 * The Lab ships one tour per showcase that has one (`../tutorial/tours.ts`: Survey, Trip budget), and this
 * module owns one `TutorialEngine` for each. A tour id is the id of the showcase it teaches, which is how
 * `loadTourDefault()` and the Preview frame's semantic observation pair a tour with its showcase.
 *
 * `activeTourId` decides which engine every method below (`next`/`back`/`skip`/`pause`/`requestResume`/
 * `runLink` and the returned `snapshot`) operates on; there is deliberately no "current tour" inside
 * `TutorialEngine` itself. It follows the open showcase while no tour is running (the showcase's own tour,
 * or the default tour for a showcase without one), and a tour that is running or paused is tied to its
 * showcase: leaving that showcase ends it, so the rail never describes a showcase that is not open.
 */

import type { InjectionKey, Ref } from 'vue'
import type { TutorialActions, TutorialEngine, TutorialEngineSnapshot, TutorialTabId } from '../tutorial/types'
import type { ImplementationExplorerStore } from './use-implementation-explorer'
import type { LabStore } from './use-lab-store'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, inject, onUnmounted, shallowRef, watch } from 'vue'
import { decideDeterministicStart } from '../tutorial/deterministic-start'
import { createTutorialEngine } from '../tutorial/engine'
import { findBlueprintNodeId } from '../tutorial/inspection-reader'
import { isTourCompleted, isWelcomeDismissed, markTourCompleted, markWelcomeDismissed } from '../tutorial/session-flags'
import { createStartRequestGuard } from '../tutorial/start-request'
import { DEFAULT_TOUR_ID, getTour, tourForShowcase, tours } from '../tutorial/tours'

export interface TutorialStore {
	readonly snapshot: Readonly<Ref<TutorialEngineSnapshot>>
	readonly welcomeVisible: Readonly<Ref<boolean>>
	readonly confirmVisible: Readonly<Ref<boolean>>
	/**
	 * The English message id the dirty-draft confirmation shows for the tour about to start (each tour names its own
	 * teaching example).
	 */
	readonly confirmMessage: Readonly<Ref<string>>
	/**
	 * `true` only while the deterministic reload + `engine.start()`/`restart()` is actually in flight
	 * (`start-request.ts`'s `'loading'` phase) — deliberately NOT while a dirty-draft confirmation is
	 * merely open (`'confirming'`); see `syncPending()`'s comment in this module for why (in short:
	 * disabling the header button during `'confirming'` would blur its own focus before
	 * `TutorialConfirmDialog.vue` can capture it as "the control to restore focus to" on close —
	 * breaking blocker 1's contract). The header's Tutorial/Restart button binds `:disabled` to this;
	 * the confirm dialog's own "Start tour"/Welcome's "Start the tour" buttons deliberately do not,
	 * since `start-request.ts`'s guard already makes a stray duplicate click on those a safe no-op on
	 * its own (see its `confirm()`/`request()` contracts) — no UI disable is needed there, and both
	 * dialogs already exclude every OTHER control from the tab order via native `showModal()` anyway.
	 */
	readonly startPending: Readonly<Ref<boolean>>
	/** The tour every method below operates on (see this module's header). */
	readonly activeTourId: Readonly<Ref<string>>
	/** Welcome card's "Explore on my own" — dismisses without starting the tour. */
	dismissWelcome: () => void
	/** Welcome card's "Start the tour", and the header's "Tutorial" entry when the engine is idle. */
	requestStart: () => void
	/** The header's "Restart tutorial" entry (only meaningful once `completed`). */
	requestRestart: () => void
	/** The header's "Resume tutorial" entry (only meaningful while `paused`). */
	requestResume: () => void
	/** Confirmation dialog's "Start tour". */
	confirmStart: () => void
	/** Confirmation dialog's "Cancel" — the pending start/restart is dropped; nothing is reloaded. */
	cancelStart: () => void
	next: () => void
	back: () => void
	skip: () => void
	/** The rail's own close control. */
	pause: () => void
	runLink: (linkId: string) => void
}

export const TutorialStoreKey: InjectionKey<TutorialStore> = Symbol('widget-lab:tutorial-store')

/**
 * Loads a tour's known default preset through the exact same Apply pipeline every other Source mutation
 * uses (diagnostic #25 OWNER decision) — switching showcase when not already on the target one already
 * applies its `defaultPreset` (which IS the tour's own default; see `showcases/registry.ts`), so only the
 * already-on-that-showcase case needs an explicit `applyPreset()` (covers a different preset, or a Runtime
 * the visitor mutated through Preview without ever dirtying the draft — see `deterministic-start.ts`'s header
 * on why `isDirty` alone cannot detect that).
 */
async function loadTourDefault(store: LabStore, tourId: string): Promise<void> {
	const tour = getTour(tourId)
	if (tour === undefined)
		return
	if (store.showcaseId.value === tourId)
		await store.applyPreset(tour.defaultPresetId)
	else
		await store.switchShowcase(tourId)
}

export function createTutorialStore(store: LabStore, implementationExplorer: ImplementationExplorerStore): TutorialStore {
	const engines = new Map<string, TutorialEngine>(tours.map(tour => [tour.id, createTutorialEngine(tour.script)]))
	for (const tour of tours) {
		if (isTourCompleted(tour.id))
			engines.get(tour.id)!.restoreCompleted()
	}

	const activeTourId = shallowRef<string>(tourForShowcase(store.showcaseId.value).id)
	function engineOf(tourId: string): TutorialEngine {
		return engines.get(tourId)!
	}
	function activeEngine(): TutorialEngine {
		return engineOf(activeTourId.value)
	}

	const engineTick = shallowRef(0)
	const unsubscribeEngines = [...engines.values()].map(engine => engine.subscribe(() => {
		engineTick.value++
	}))
	const snapshot = computed(() => {
		void engineTick.value
		return activeEngine()
			.getSnapshot()
	})
	const confirmMessage = computed(() => getTour(activeTourId.value)?.startConfirmMessage ?? tourForShowcase(DEFAULT_TOUR_ID).startConfirmMessage)

	const welcomeVisible = shallowRef(!isWelcomeDismissed())
	const confirmVisible = shallowRef(false)
	let pendingConfirmAction: (() => void) | null = null

	// Blocker 3 guard (see `start-request.ts`'s header for the full hazard). The GUARD's own
	// idempotency (`request()`/`confirm()` returning `false` while not `'idle'`/`'confirming'`
	// respectively) is what actually makes a re-entrant click safe, in every phase — `startPending`
	// below is only the UI-facing subset of that used to visually disable the header button, and is
	// deliberately narrower than "any phase is not idle": it tracks `'loading'` only, not
	// `'confirming'`. Disabling the header button the instant a dirty-draft confirmation opens would
	// blur its own focus (a disabled element cannot stay focused) before `useModalDialog` on
	// `TutorialConfirmDialog.vue` gets a chance to capture "the control focus should return to" —
	// silently breaking blocker 1's "closing restores focus to the initiating control" contract. Staying
	// enabled (but functionally inert, via the guard) during `'confirming'` is safe and correct: a
	// stray second click on the header while the confirmation is already open just calls
	// `requestStartOrRestart()` again, which `startRequestGuard.request()` immediately no-ops.
	const startRequestGuard = createStartRequestGuard()
	const startPending = shallowRef(false)
	function syncPending(): void {
		startPending.value = startRequestGuard.getPhase() === 'loading'
	}

	/**
	 * Keeps `activeTourId` on the open showcase's tour. A tour that is running or paused belongs to its showcase:
	 * when another showcase opens (not during a start request, which switches showcase on purpose) it ends, so
	 * the rail never describes a showcase that is not open.
	 */
	function followShowcase(showcaseId: string): void {
		const target = tourForShowcase(showcaseId).id
		const current = activeTourId.value
		if (target === current)
			return
		const status = engineOf(current)
			.getSnapshot().status
		if (status === 'active' || status === 'paused') {
			if (startRequestGuard.getPhase() !== 'idle')
				return
			engineOf(current)
				.skip()
		}
		activeTourId.value = target
	}

	function actions(): TutorialActions {
		return {
			setFocus: (widgetId, member) => {
				const nodeId = findBlueprintNodeId(inspectBlueprint(store.documentState.value.blueprint), widgetId)
				if (nodeId !== null)
					store.setFocus('document', { nodeId, member })
			},
			activateTab: (tab: TutorialTabId) => {
				store.activeTab.value = tab
			},
			openImplementation: () => {
				implementationExplorer.open()
			},
		}
	}

	let recheckSequence = 0
	function recheckNow(): void {
		const engine = activeEngine()
		const tourId = activeTourId.value
		const before = engine.getSnapshot()
		if (before.status !== 'active' || before.step === null || store.showcaseId.value !== tourId)
			return
		const connection = store.previewHost.connection.value
		if (connection === null)
			return
		const sequence = ++recheckSequence
		void store.previewHost.evaluateTutorial(tourId, before.stepIndex, before.revealed.length)
			.then((progress) => {
				if (sequence !== recheckSequence || activeTourId.value !== tourId)
					return
				const current = engine.getSnapshot()
				if (current.status !== 'active' || current.stepIndex !== before.stepIndex)
					return
				engine.acceptProgress(progress)
			})
			.catch(() => {
				// A frame replacement/disconnect is retried by the connection watch below.
			})
	}

	function beginTour(tourId: string, isRestart: boolean): void {
		void loadTourDefault(store, tourId)
			.then(() => {
				activeTourId.value = tourId
				const engine = engineOf(tourId)
				if (isRestart)
					engine.restart(actions())
				else
					engine.start(actions())
				recheckNow()
			})
			.finally(() => {
				// Settles the guard only once the deterministic reload AND the engine transition it gates
				// have both landed — never merely once `loadTourDefault()` resolves — so a coalesced
				// request during this entire window can never race a later engine.start()/restart() call.
				startRequestGuard.settle()
				syncPending()
			})
	}

	/**
	 * The single entry point every start/restart-triggering affordance calls. Requests the guard FIRST,
	 * synchronously, before touching `decideDeterministicStart()`/`confirmVisible`/`beginTour()` at all —
	 * a request rejected as already-pending (blocker 3) must be a complete no-op, never a second
	 * confirmation dialog or a second `loadTourDefault()` round trip.
	 */
	function requestStartOrRestart(isRestart: boolean): void {
		const decision = decideDeterministicStart({ isDirty: store.isDirty.value })
		const accepted = startRequestGuard.request(decision.needsConfirmation)
		syncPending()
		if (!accepted)
			return

		const tourId = activeTourId.value
		if (decision.needsConfirmation) {
			pendingConfirmAction = () => beginTour(tourId, isRestart)
			confirmVisible.value = true
			return
		}
		beginTour(tourId, isRestart)
	}

	// Runtime predicate evaluation now lives with the iframe-owned Runtime. The parent subscribes only to
	// a semantic "an observed member changed" signal, then asks the host to evaluate the current step
	// and return the monotonic completed-stage count. No Runtime value crosses the frame boundary.
	const stopRemoteObservation = store.previewHost.onTutorialObservation((tourId) => {
		if (tourId === activeTourId.value)
			recheckNow()
	})

	watch(
		() => [store.previewHost.connection.value?.runtimeId ?? null, snapshot.value.status, store.showcaseId.value, activeTourId.value] as const,
		([runtimeId, status, showcaseId, tourId]) => {
			if (runtimeId !== null && status === 'active' && showcaseId === tourId)
				recheckNow()
		},
		{ immediate: true },
	)

	watch(() => store.showcaseId.value, showcaseId => followShowcase(showcaseId))

	onUnmounted(() => {
		stopRemoteObservation()
		for (const unsubscribe of unsubscribeEngines) unsubscribe()
	})

	return {
		snapshot,
		welcomeVisible,
		confirmVisible,
		confirmMessage,
		startPending,
		activeTourId,
		dismissWelcome: () => {
			markWelcomeDismissed()
			welcomeVisible.value = false
		},
		requestStart: () => {
			markWelcomeDismissed()
			welcomeVisible.value = false
			requestStartOrRestart(false)
		},
		requestRestart: () => requestStartOrRestart(true),
		requestResume: () => {
			activeEngine()
				.resume(actions())
			// A step with a no-predicate (or already-satisfied) stage must reveal immediately on entry —
			// see `next()`'s comment below; `resume()` re-enters the current step the same way `next()`/
			// `back()` do, and the `watch` above only re-fires on a Runtime/showcase/status *identity*
			// change, none of which a plain pause/resume cycle produces.
			recheckNow()
		},
		confirmStart: () => {
			confirmVisible.value = false
			const proceeded = startRequestGuard.confirm()
			syncPending()
			if (!proceeded)
				return
			const action = pendingConfirmAction
			pendingConfirmAction = null
			action?.()
		},
		// The dirty-draft confirmation's "Cancel" AND its Escape path (blocker 1's locked policy) both
		// route through this one method — nothing is reloaded, the guard is released so a fresh request
		// is accepted afterward, and the draft is left completely untouched.
		cancelStart: () => {
			confirmVisible.value = false
			pendingConfirmAction = null
			startRequestGuard.cancel()
			syncPending()
		},
		next: () => {
			activeEngine()
				.next(actions())
			// Entering a new step whose first stage has no predicate (or one already satisfied by
			// Runtime state the visitor produced earlier) must reveal its text immediately, not wait for
			// the next incidental Runtime tick — the `watch` above only re-fires on a Runtime/showcase/
			// status *identity* change, which a same-showcase `next()` never produces.
			recheckNow()
			if (activeEngine()
				.getSnapshot().status === 'completed') {
				markTourCompleted(activeTourId.value)
			}
		},
		back: () => {
			activeEngine()
				.back(actions())
			recheckNow()
		},
		skip: () => activeEngine()
			.skip(),
		pause: () => activeEngine()
			.pause(),
		runLink: linkId => activeEngine()
			.runLink(linkId, actions()),
	}
}

export function useTutorialStore(): TutorialStore {
	const store = inject(TutorialStoreKey)
	if (store === undefined)
		throw new Error('useTutorialStore() was called outside the TutorialStore provider (App.vue).')
	return store
}
