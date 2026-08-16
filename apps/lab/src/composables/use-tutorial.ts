/**
 * Vue reactivity bridge over `../tutorial/`'s framework-agnostic `TutorialEngine` (issue #25 P1) — the
 * one place that adapts its plain `getSnapshot()`/`subscribe()` shape into a Vue ref, owns the
 * deterministic-tour-start orchestration (`../tutorial/deterministic-start.ts`'s pure decision plus the
 * actual `LabStore.applyPreset()`/`switchShowcase()` calls the OWNER-locked policy requires), and
 * subscribes the passive Runtime-observation surface (`../tutorial/inspection-reader.ts`) that drives
 * `TutorialEngine.recheck()`. Mirrors `use-lab-store.ts`'s role for `LabSession`.
 *
 * issue #25 P4: now owns TWO tours (Survey + CRM), one `TutorialEngine` instance each, keyed by
 * `TutorialTourId`. `activeTourId` decides which engine every method below (`next`/`back`/`skip`/
 * `pause`/`requestResume`/`runLink`/the returned `snapshot`) operates on — there is deliberately no
 * "current tour" concept inside `TutorialEngine` itself (each engine only ever knows its own script);
 * this module is the one place that picks which engine is "the" tutorial at any moment, mirroring how it
 * is already the one place that adapts multiple framework-agnostic pieces into one Vue-facing surface.
 * The locked "Survey is the first-run path" rule (issue #25 gate review point 1 / v2 amendment) shows up
 * here as `crmTourUnlocked`: the header's tour-picker (`LabHeader.vue`) only ever offers CRM once Survey
 * has been completed at least once this session, and the Welcome card's "Start the tour" always lands on
 * Survey because `activeTourId` starts as `'survey'` and nothing can change it before Welcome is ever
 * interactable.
 */

import type { InjectionKey, Ref } from 'vue'
import type { TutorialActions, TutorialEngine, TutorialEngineSnapshot, TutorialScript, TutorialTabId } from '../tutorial/types'
import type { ImplementationExplorerStore } from './use-implementation-explorer'
import type { LabStore } from './use-lab-store'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, inject, onUnmounted, shallowRef, watch } from 'vue'
import { CRM_TOUR_ID, crmTourScript } from '../tutorial/crm-script'
import { decideDeterministicStart } from '../tutorial/deterministic-start'
import { createTutorialEngine } from '../tutorial/engine'
import { createRuntimeReader, findBlueprintNodeId, subscribeObservationTargets } from '../tutorial/inspection-reader'
import { isTourCompleted, isWelcomeDismissed, markTourCompleted, markWelcomeDismissed } from '../tutorial/session-flags'
import { createStartRequestGuard } from '../tutorial/start-request'
import { SURVEY_TOUR_ID, surveyTourScript } from '../tutorial/survey-script'

/**
 * The two tour scripts this app ships (issue #25 P4). Derived from each script module's own exported
 * id constant rather than hardcoded string literals here, so there is exactly one place (each script's
 * own `_TOUR_ID` export) that spells out its id.
 */
export type TutorialTourId = typeof SURVEY_TOUR_ID | typeof CRM_TOUR_ID

export interface TutorialStore {
	readonly snapshot: Readonly<Ref<TutorialEngineSnapshot>>
	readonly welcomeVisible: Readonly<Ref<boolean>>
	readonly confirmVisible: Readonly<Ref<boolean>>
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
	/**
	 * Which tour every method below (`next`/`back`/`skip`/`pause`/`requestResume`/`runLink`/`snapshot`)
	 * currently operates on (issue #25 P4). Starts `'survey'` and only ever changes via `selectTour()` or
	 * the Survey hand-back step's "Take the CRM tour" link.
	 */
	readonly activeTourId: Readonly<Ref<TutorialTourId>>
	/**
	 * `true` once the Survey tour has been completed at least once this session (issue #25 P4 Scope B,
	 * "Survey is the first-run path"): the header's tour-picker only offers CRM once this is `true`.
	 */
	readonly crmTourUnlocked: Readonly<Ref<boolean>>
	/**
	 * `true` whenever switching the selected tour would orphan an engine (merge-gate review round 2,
	 * blocker 2): the CURRENT tour's own engine is `'active'`/`'paused'`, or a start/restart request is
	 * pending (`'confirming'` or `'loading'` — the whole span `startRequestGuard` occupies, not only its
	 * `'loading'` phase, since a `selectTour()` mid-`'confirming'` would abandon THAT engine's already-
	 * requested start just as much as mid-`'loading'` would). `LabHeader.vue` binds the picker's
	 * `:disabled` to this so the invariant is visible, not just enforced; `selectTour()` itself checks the
	 * same underlying conditions independently (see its own comment) so correctness never depends on the
	 * template actually disabling the control.
	 */
	readonly tourPickerDisabled: Readonly<Ref<boolean>>
	/**
	 * The header's tour-picker `<select>`. A no-op if asked to select `'crm'` before `crmTourUnlocked`,
	 * or whenever `tourPickerDisabled` would be `true` (defensive — checked independently of the template
	 * actually disabling the control; see that flag's own comment for the exact invariant this enforces:
	 * at most one tour may be the "current" one at a time, and only from idle/completed).
	 */
	selectTour: (tourId: TutorialTourId) => void
	/** Welcome card's "Explore on my own" — dismisses without starting the tour. */
	dismissWelcome: () => void
	/**
	 * Welcome card's "Start the tour" (always Survey — see this module's own header), and the header's
	 * "Tutorial" entry when `activeTourId`'s own engine is idle.
	 */
	requestStart: () => void
	/** The header's "Restart tutorial" entry for `activeTourId` (only meaningful once `completed`). */
	requestRestart: () => void
	/** The header's "Resume tutorial" entry for `activeTourId` (only meaningful while `paused`). */
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
 * uses (issue #25 OWNER decision, extended to CRM by issue #25 P4) — switching showcase when not already
 * on the target one already applies its `defaultPreset` (which IS each tour's own default — `survey-
 * default` for Survey, `crm-default` for CRM; see `showcases/registry.ts`), so only the already-on-that-
 * showcase case needs an explicit `applyPreset()` (covers a different preset, or a Runtime the visitor
 * mutated through Preview without ever dirtying the draft — see `deterministic-start.ts`'s header on why
 * `isDirty` alone cannot detect that).
 */
async function loadTourDefault(store: LabStore, tourId: TutorialTourId): Promise<void> {
	const defaultPresetId = tourId === SURVEY_TOUR_ID ? 'survey-default' : 'crm-default'
	if (store.showcaseId.value === tourId)
		await store.applyPreset(defaultPresetId)
	else
		await store.switchShowcase(tourId)
}

export function createTutorialStore(store: LabStore, implementationExplorer: ImplementationExplorerStore): TutorialStore {
	const engines: Record<TutorialTourId, TutorialEngine> = {
		[SURVEY_TOUR_ID]: createTutorialEngine(surveyTourScript),
		[CRM_TOUR_ID]: createTutorialEngine(crmTourScript),
	}
	const scripts: Record<TutorialTourId, TutorialScript> = {
		[SURVEY_TOUR_ID]: surveyTourScript,
		[CRM_TOUR_ID]: crmTourScript,
	}

	for (const tourId of [SURVEY_TOUR_ID, CRM_TOUR_ID] as const) {
		if (isTourCompleted(tourId))
			engines[tourId].restoreCompleted()
	}

	const activeTourId = shallowRef<TutorialTourId>(SURVEY_TOUR_ID)
	function activeEngine(): TutorialEngine {
		return engines[activeTourId.value]
	}

	const engineTick = shallowRef(0)
	const unsubscribeEngines = Object.values(engines)
		.map(engine => engine.subscribe(() => {
			engineTick.value++
		}))
	const snapshot = computed(() => {
		void engineTick.value
		return activeEngine()
			.getSnapshot()
	})

	// issue #25 P4 Scope B: unlocked once Survey has been completed this session — either just now (the
	// live engine already reports `'completed'`) or on an earlier visit this session (the persisted
	// flag). Depends on `engineTick` so a completion that happens THIS session is reflected immediately,
	// not only after a reload.
	const crmTourUnlocked = computed(() => {
		void engineTick.value
		return isTourCompleted(SURVEY_TOUR_ID) || engines[SURVEY_TOUR_ID].getSnapshot().status === 'completed'
	})

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

	// Blocker 2 (merge-gate review round 2): "at most one current tour" — reactive counterpart of
	// `selectTour()`'s own defensive checks (see that method's comment), for `LabHeader.vue`'s
	// `:disabled` binding. `startPending` alone only covers the guard's `'loading'` phase; `confirmVisible`
	// covers `'confirming'` — together they mirror `startRequestGuard.getPhase() !== 'idle'` reactively
	// without needing a second, parallel ref that could drift out of sync with the guard itself.
	const tourPickerDisabled = computed(() => {
		void engineTick.value
		const status = activeEngine()
			.getSnapshot().status
		return status === 'active' || status === 'paused' || startPending.value || confirmVisible.value
	})

	function actions(): TutorialActions {
		return {
			setFocus: (widgetId, member) => {
				const nodeId = findBlueprintNodeId(inspectBlueprint(store.active.value.blueprint), widgetId)
				if (nodeId !== null)
					store.setFocus({ nodeId, member })
			},
			activateTab: (tab: TutorialTabId) => {
				store.activeTab.value = tab
			},
			openImplementation: () => {
				implementationExplorer.open()
			},
			startTour: (tourId) => {
				if (tourId !== SURVEY_TOUR_ID && tourId !== CRM_TOUR_ID)
					return
				// "Take the CRM tour" from Survey's hand-back step reads as completing Survey, not
				// abandoning it mid-teaching (issue #25 P4 Scope B) — the hand-back step has no gating
				// predicate, so if it is the current step this `next()` always succeeds and flips status
				// to `'completed'` (recorded below), exactly as if Finish had been clicked first. A no-op
				// from any other step/status (`next()` is already a no-op unless `canAdvance`).
				const fromEngine = activeEngine()
				if (fromEngine.getSnapshot().status === 'active') {
					fromEngine.next(actions())
					if (fromEngine.getSnapshot().status === 'completed')
						markTourCompleted(activeTourId.value)
				}
				activeTourId.value = tourId
				requestStartOrRestart(tourId, false)
			},
		}
	}

	function recheckNow(): void {
		const runtime = store.active.value.runtime
		if (runtime !== null) {
			activeEngine()
				.recheck(createRuntimeReader(runtime))
		}
	}

	function beginTour(tourId: TutorialTourId, isRestart: boolean): void {
		void loadTourDefault(store, tourId)
			.then(() => {
				const engine = engines[tourId]
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
	function requestStartOrRestart(tourId: TutorialTourId, isRestart: boolean): void {
		const decision = decideDeterministicStart({ isDirty: store.isDirty.value })
		const accepted = startRequestGuard.request(decision.needsConfirmation)
		syncPending()
		if (!accepted)
			return

		if (decision.needsConfirmation) {
			pendingConfirmAction = () => beginTour(tourId, isRestart)
			confirmVisible.value = true
			return
		}
		beginTour(tourId, isRestart)
	}

	// Passive Runtime observation (issue #25 P1 "predicates observe Runtime PASSIVELY"): subscribes only
	// while the ACTIVE tour is active AND the current showcase matches that tour's own showcase id —
	// re-subscribing whenever the active Runtime identity changes (Apply/preset/switchShowcase all
	// replace it), the tour's own status changes, or `activeTourId` itself changes (issue #25 P4).
	let teardownObservation: (() => void) | null = null
	watch(
		() => [store.active.value.runtime, snapshot.value.status, store.showcaseId.value, activeTourId.value] as const,
		([runtime, status, showcaseId, tourId]) => {
			teardownObservation?.()
			teardownObservation = null
			if (runtime === null || status !== 'active' || showcaseId !== tourId)
				return
			teardownObservation = subscribeObservationTargets(runtime, scripts[tourId].observationTargets, recheckNow)
			recheckNow()
		},
		{ immediate: true },
	)

	onUnmounted(() => {
		teardownObservation?.()
		for (const unsubscribe of unsubscribeEngines) unsubscribe()
	})

	return {
		snapshot,
		welcomeVisible,
		confirmVisible,
		startPending,
		activeTourId,
		crmTourUnlocked,
		tourPickerDisabled,
		// Blocker 2 (merge-gate review round 2): checked independently of `tourPickerDisabled`/the
		// template actually disabling the `<select>` — reads `activeEngine()`'s live status and the
		// guard's live phase directly, synchronously, rather than trusting the reactive computed above,
		// so correctness here never depends on Vue's reactivity having already flushed a `:disabled`
		// binding by the time a caller (or a stray programmatic `.selectTour()` call) reaches this.
		selectTour: (tourId) => {
			if (tourId === CRM_TOUR_ID && !crmTourUnlocked.value)
				return
			const currentStatus = activeEngine()
				.getSnapshot().status
			if (currentStatus === 'active' || currentStatus === 'paused')
				return
			if (startRequestGuard.getPhase() !== 'idle')
				return
			activeTourId.value = tourId
		},
		dismissWelcome: () => {
			markWelcomeDismissed()
			welcomeVisible.value = false
		},
		requestStart: () => {
			markWelcomeDismissed()
			welcomeVisible.value = false
			// `activeTourId` is still `'survey'` the very first time this can possibly fire (Welcome only
			// shows before any tour has ever run), so this also serves as the Welcome card's own "always
			// Survey" entry point without a second, dedicated method (issue #25 P4 Scope B).
			requestStartOrRestart(activeTourId.value, false)
		},
		requestRestart: () => requestStartOrRestart(activeTourId.value, true),
		requestResume: () => {
			activeEngine()
				.resume(actions())
			// A step with a no-predicate (or already-satisfied) stage must reveal immediately on entry —
			// see `next()`'s comment below; `resume()` re-enters the current step the same way `next()`/
			// `back()` do, and the `watch` above only re-fires on a Runtime/showcase/status/tour *identity*
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
			// status/tour *identity* change, which a same-showcase `next()` never produces.
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
