/**
 * Widget Lab guided tutorial — framework-agnostic step-machine contract (issue #25 P1).
 *
 * Normative source: GitHub issue #25 ("guided onboarding, tutorial flow, and widget/component source
 * explorer") plus its Review Gate comments — "[GPT] gate review", "[Claude] Proposal v2", and the
 * "[GPT] OWNER decision" that locks the deterministic Survey tour start. This module (and every other
 * file directly under `src/tutorial/`) never imports Vue, mirroring `src/lab/`'s framework-agnostic
 * core — `src/composables/use-tutorial.ts` is the one place that bridges this engine into Vue refs.
 *
 * The pedagogical invariant the whole engine is built around (gate review point 2, "do -> observe ->
 * name, not do -> auto-jump"): an action-gated step reveals its observation/naming text *inside the
 * same step*, the instant its stage predicate turns true, and enables Next — it never auto-advances the
 * step index and never moves the spotlight on its own. Advancing to a different step (and therefore a
 * different spotlight target) only ever happens through an explicit `next()`/`back()`/`restart()` call.
 */

/**
 * A `RuntimePropertyInspectionSnapshot`-shaped result, kept structurally compatible without importing
 * the exact type here (this file stays decoupled from `@deviltea/widget-core`; `inspection-reader.ts`
 * is the one module in this directory that actually touches `@deviltea/widget-core/inspection`).
 */
export type TutorialPropertySnapshot
	= | { readonly status: 'never-evaluated' }
		| { readonly status: 'completed', readonly result: { readonly success: boolean, readonly value: unknown } }

/**
 * The passive, readonly Runtime-observation surface a step's `isComplete` predicate is given. Backed by
 * `@deviltea/widget-core/inspection`'s `RuntimeStateInspection`/`RuntimePropertyInspection`
 * `getSnapshot()` (see `inspection-reader.ts`) — a predicate must never call `state.set()`, invoke a
 * Method, or otherwise force Property evaluation; it only ever reads whatever the real Preview consumer
 * already caused to be evaluated.
 */
export interface TutorialRuntimeReader {
	/** `undefined` when the widget/state member cannot be resolved in the current Runtime. */
	readState: (widgetId: string, key: string) => unknown
	/** `undefined` when the widget/property member cannot be resolved in the current Runtime. */
	readProperty: (widgetId: string, key: string) => TutorialPropertySnapshot | undefined
}

/**
 * One State or Property/Method member reference, mirroring `InspectorFocusMember` (`src/lab/focus.ts`)
 * without importing it — this directory stays decoupled from `@deviltea/widget-core` node identity.
 */
export interface TutorialFocusMember {
	readonly type: 'state' | 'property' | 'method'
	readonly name: string
}

/**
 * The five canonical Dockview panels plus Preview — the same tab space `LabStore.activeTab`
 * (`LabToolTab`, widened to include `'preview'`) already models. Kept as its own literal union here so
 * this directory never imports `use-lab-store.ts`'s Vue-touching types.
 */
export type TutorialTabId = 'source' | 'blueprint' | 'runtime' | 'graph' | 'preview'

/**
 * The abstract navigation surface a step's `onEnter`/link `run()` may call. `use-tutorial.ts` is the
 * concrete Vue implementation: `setFocus` resolves `widgetId` against the current Blueprint and calls
 * the shared `InspectorFocusStore.setFocus()`; `activateTab` assigns `LabStore.activeTab`, which
 * `Workbench.vue`'s bridge watch turns into a real `DockviewApi` panel activation.
 */
export interface TutorialActions {
	setFocus: (widgetId: string, member?: TutorialFocusMember) => void
	activateTab: (tab: TutorialTabId) => void
	/**
	 * Opens (or activates) the Implementation panel for the currently-focused widget (issue #25 P3
	 * Scope D, tutorial entry point 3). Deliberately narrower than `activateTab`: the Implementation
	 * panel is not one of the five canonical `TutorialTabId` surfaces (it is closable, and only ever
	 * added lazily) — see `use-implementation-explorer.ts`'s file header for why this is a parallel
	 * mechanism rather than a widened `TutorialTabId` union.
	 */
	openImplementation: () => void
}

/**
 * One do -> observe -> name unit within a step. A stage with no `isComplete` is treated as satisfied
 * the instant it is checked (no action needed — e.g. a step that only narrates what a *previous* step's
 * action already changed) — this is what lets a step render its `reveal` text immediately rather than
 * waiting on a predicate that will never naturally become true.
 */
export interface TutorialStepStage {
	/** Shown while this stage has not yet completed — the pending "do" instruction. */
	readonly prompt: string
	/**
	 * Checked passively on every `TutorialEngine.recheck()` call; once `true`, never re-checked again
	 * (monotonic completion — see the file header's do -> observe -> name invariant).
	 */
	readonly isComplete?: (reader: TutorialRuntimeReader) => boolean
	/** Shown once this stage completes — the observation + naming text. */
	readonly reveal: string
}

export interface TutorialStepLink {
	readonly id: string
	readonly label: string
	/**
	 * A disabled link with no `run` — e.g. step 8's "Implementation (coming next)" entry, which names a
	 * real future affordance without pretending it is already wired up.
	 */
	readonly disabled?: boolean
	/** Shown next to a disabled link's label, e.g. "coming next". */
	readonly note?: string
	readonly run?: (actions: TutorialActions) => void
}

export interface TutorialStepDefinition {
	readonly id: string
	readonly title: string
	/**
	 * A `data-tutorial-target` attribute value, or `null` for a step with no single spotlight target
	 * (e.g. the view-map step, whose content itself is a set of navigation links).
	 */
	readonly target: string | null
	/**
	 * At least one stage; `TutorialEngine.recheck()` walks this step's stages in order (see the file
	 * header) — this step's Next only enables once every stage has completed.
	 */
	readonly stages: readonly [TutorialStepStage, ...TutorialStepStage[]]
	/**
	 * Called once whenever this step *becomes* current (`start`/`restart`/`next`/`back`/`resume`) — e.g.
	 * to set the shared cross-inspector focus onto this step's widget. Never called merely because a
	 * stage completed within the step (only step *entry* triggers navigation).
	 */
	readonly onEnter?: (actions: TutorialActions) => void
	readonly links?: readonly TutorialStepLink[]
	/** Overrides the last step's "Next" label (e.g. "Finish"). Ignored on every earlier step. */
	readonly finishLabel?: string
}

export interface TutorialObservationTarget {
	readonly widgetId: string
	readonly member: { readonly type: 'state', readonly key: string } | { readonly type: 'property', readonly key: string }
}

export interface TutorialScript {
	readonly id: string
	readonly steps: readonly TutorialStepDefinition[]
	/**
	 * The fixed set of State/Property primitives `use-tutorial.ts` subscribes to (via
	 * `inspection-reader.ts`'s passive `subscribe()` surface) so `TutorialEngine.recheck()` re-runs
	 * whenever any of them changes. Authored against the known `survey-default` starting topology (the
	 * OWNER-locked deterministic-start policy) rather than discovered dynamically from the current step.
	 */
	readonly observationTargets: readonly TutorialObservationTarget[]
}

export type TutorialStatus = 'idle' | 'active' | 'paused' | 'completed'

export interface TutorialEngineSnapshot {
	readonly status: TutorialStatus
	readonly stepIndex: number
	readonly stepCount: number
	readonly step: TutorialStepDefinition | null
	/** Reveal texts for every stage completed so far in the current step, in stage order. */
	readonly revealed: readonly string[]
	/** The still-pending stage's prompt, or `null` once every stage in the current step has completed. */
	readonly pendingPrompt: string | null
	readonly canAdvance: boolean
	readonly isFirstStep: boolean
	readonly isLastStep: boolean
}

export interface TutorialEngine {
	getSnapshot: () => TutorialEngineSnapshot
	subscribe: (listener: () => void) => () => void
	/** idle/completed/paused -> active at step 0, discarding any prior progress. */
	start: (actions: TutorialActions) => void
	/**
	 * Equivalent to `start()` — kept as a separate, explicitly-named entry point since the deterministic
	 * Survey tour reloads `survey-default` before calling this (see `use-tutorial.ts`), and "restart"
	 * reads more intentionally than "start" at that call site.
	 */
	restart: (actions: TutorialActions) => void
	/** No-op unless `canAdvance`. Advances to the next step, or to `'completed'` from the last step. */
	next: (actions: TutorialActions) => void
	/** No-op on the first step. */
	back: (actions: TutorialActions) => void
	/** -> `'idle'`. Distinct from `pause()`: a later `start()` begins a fresh run, not a resume. */
	skip: () => void
	/** `'active'` -> `'paused'`. No-op otherwise. */
	pause: () => void
	/**
	 * `'paused'` -> `'active'`, re-running the current step's `onEnter` (e.g. to restore its spotlight
	 * target/focus after the rail was closed). No-op otherwise.
	 */
	resume: (actions: TutorialActions) => void
	/**
	 * Re-evaluates the current step's pending stage's `isComplete` (and any further stages that also
	 * newly complete) against `reader`. Never moves `stepIndex` — see the file header.
	 */
	recheck: (reader: TutorialRuntimeReader) => void
	runLink: (linkId: string, actions: TutorialActions) => void
	/**
	 * Bootstraps `'completed'` status directly (no step traversal) — the one exception to "only
	 * start/restart/next/back/resume change status", used solely to restore the session-persisted
	 * "tour completed" flag on a fresh page load (see `session-flags.ts`).
	 */
	restoreCompleted: () => void
}
