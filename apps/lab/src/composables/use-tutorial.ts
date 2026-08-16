/**
 * Vue reactivity bridge over `../tutorial/`'s framework-agnostic `TutorialEngine` (issue #25 P1) — the
 * one place that adapts its plain `getSnapshot()`/`subscribe()` shape into a Vue ref, owns the
 * deterministic-Survey-tour-start orchestration (`../tutorial/deterministic-start.ts`'s pure decision
 * plus the actual `LabStore.applyPreset()`/`switchShowcase()` calls the OWNER-locked policy requires),
 * and subscribes the passive Runtime-observation surface (`../tutorial/inspection-reader.ts`) that
 * drives `TutorialEngine.recheck()`. Mirrors `use-lab-store.ts`'s role for `LabSession`.
 */

import type { InjectionKey, Ref } from 'vue'
import type { TutorialActions, TutorialEngineSnapshot, TutorialTabId } from '../tutorial/types'
import type { LabStore } from './use-lab-store'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, inject, onUnmounted, shallowRef, watch } from 'vue'
import { decideDeterministicStart } from '../tutorial/deterministic-start'
import { createTutorialEngine } from '../tutorial/engine'
import { createRuntimeReader, findBlueprintNodeId, subscribeObservationTargets } from '../tutorial/inspection-reader'
import { isTourCompleted, isWelcomeDismissed, markTourCompleted, markWelcomeDismissed } from '../tutorial/session-flags'
import { SURVEY_TOUR_ID, surveyTourScript } from '../tutorial/survey-script'

export interface TutorialStore {
	readonly snapshot: Readonly<Ref<TutorialEngineSnapshot>>
	readonly welcomeVisible: Readonly<Ref<boolean>>
	readonly confirmVisible: Readonly<Ref<boolean>>
	/** Welcome card's "Explore on my own" — dismisses without starting the tour. */
	dismissWelcome: () => void
	/** Welcome card's "Start the tour", and the header's "Tutorial" entry when idle. */
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
 * Loads the known `survey-default` preset through the exact same Apply pipeline every other Source
 * mutation uses (issue #25 OWNER decision) — switching showcase when not already on Survey already
 * applies its `defaultPreset` (which IS `survey-default`; see `showcases/registry.ts`), so only the
 * already-on-Survey case needs an explicit `applyPreset()` (covers a different preset, or a Runtime the
 * visitor mutated through Preview without ever dirtying the draft — see `deterministic-start.ts`'s
 * header on why `isDirty` alone cannot detect that).
 */
async function loadSurveyDefault(store: LabStore): Promise<void> {
	if (store.showcaseId.value === SURVEY_TOUR_ID)
		await store.applyPreset('survey-default')
	else
		await store.switchShowcase(SURVEY_TOUR_ID)
}

export function createTutorialStore(store: LabStore): TutorialStore {
	const engine = createTutorialEngine(surveyTourScript)
	if (isTourCompleted())
		engine.restoreCompleted()

	const engineTick = shallowRef(0)
	const unsubscribeEngine = engine.subscribe(() => {
		engineTick.value++
	})
	const snapshot = computed(() => {
		void engineTick.value
		return engine.getSnapshot()
	})

	const welcomeVisible = shallowRef(!isWelcomeDismissed())
	const confirmVisible = shallowRef(false)
	let pendingConfirmAction: (() => void) | null = null

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
		}
	}

	function recheckNow(): void {
		const runtime = store.active.value.runtime
		if (runtime !== null)
			engine.recheck(createRuntimeReader(runtime))
	}

	function beginTour(isRestart: boolean): void {
		void loadSurveyDefault(store)
			.then(() => {
				if (isRestart)
					engine.restart(actions())
				else
					engine.start(actions())
				recheckNow()
			})
	}

	function requestStartOrRestart(isRestart: boolean): void {
		const decision = decideDeterministicStart({ isDirty: store.isDirty.value })
		if (decision.needsConfirmation) {
			pendingConfirmAction = () => beginTour(isRestart)
			confirmVisible.value = true
			return
		}
		beginTour(isRestart)
	}

	// Passive Runtime observation (issue #25 P1 "predicates observe Runtime PASSIVELY"): subscribes only
	// while the tour is active AND the current showcase is Survey (the script this engine was authored
	// against) — re-subscribing whenever the active Runtime identity changes (Apply/preset/switchShowcase
	// all replace it) or the tour's own status changes.
	let teardownObservation: (() => void) | null = null
	watch(
		() => [store.active.value.runtime, snapshot.value.status, store.showcaseId.value] as const,
		([runtime, status, showcaseId]) => {
			teardownObservation?.()
			teardownObservation = null
			if (runtime === null || status !== 'active' || showcaseId !== SURVEY_TOUR_ID)
				return
			teardownObservation = subscribeObservationTargets(runtime, surveyTourScript.observationTargets, recheckNow)
			recheckNow()
		},
		{ immediate: true },
	)

	onUnmounted(() => {
		teardownObservation?.()
		unsubscribeEngine()
	})

	return {
		snapshot,
		welcomeVisible,
		confirmVisible,
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
			engine.resume(actions())
			// A step with a no-predicate (or already-satisfied) stage must reveal immediately on entry —
			// see `next()`'s comment below; `resume()` re-enters the current step the same way `next()`/
			// `back()` do, and the `watch` above only re-fires on a Runtime/showcase/status *identity*
			// change, none of which a plain pause/resume cycle produces.
			recheckNow()
		},
		confirmStart: () => {
			confirmVisible.value = false
			const action = pendingConfirmAction
			pendingConfirmAction = null
			action?.()
		},
		cancelStart: () => {
			confirmVisible.value = false
			pendingConfirmAction = null
		},
		next: () => {
			engine.next(actions())
			// Entering a new step whose first stage has no predicate (or one already satisfied by
			// Runtime state the visitor produced earlier) must reveal its text immediately, not wait for
			// the next incidental Runtime tick — the `watch` above only re-fires on a Runtime/showcase/
			// status *identity* change, which a same-showcase `next()` never produces.
			recheckNow()
			if (engine.getSnapshot().status === 'completed')
				markTourCompleted()
		},
		back: () => {
			engine.back(actions())
			recheckNow()
		},
		skip: () => engine.skip(),
		pause: () => engine.pause(),
		runLink: linkId => engine.runLink(linkId, actions()),
	}
}

export function useTutorialStore(): TutorialStore {
	const store = inject(TutorialStoreKey)
	if (store === undefined)
		throw new Error('useTutorialStore() was called outside the TutorialStore provider (App.vue).')
	return store
}
