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
 * `switchShowcase()` is the analogous, larger-grained replacement for the entire showcase context.
 * #60 supersedes the old same-source Apply bootstrap: the target `LabSession` already owns the target
 * System's authoritative revision-0 Document/Runtime, so the switch mounts that snapshot directly.
 *
 * Serialized lifecycle transactions (PR #19 review 4940219714, finding 1): `apply()`, `applyPreset()`
 * and `switchShowcase()` all route through one `enqueue()` promise chain, so at most one of them is
 * ever running against the mutable `session`/remote Preview promotion/`currentShowcase` state at a time —
 * regardless of caller overlap (a switch fired while an Apply is mid-flight, or several switches fired
 * back to back). Without this, `LabSession`'s hooks close over the *mutable outer* `session` variable:
 * an in-flight `session.apply()` awaiting `detachPreview()`/`mountPreview()` could still be running
 * when a concurrent `switchShowcase()` reassigns `session` to a different `LabSession` instance, so the
 * old Apply's own `mountPreview()` hook (invoked after `switchShowcase()` already reassigned `session`)
 * would observe the *new* session instead of the one it actually compiled against — leaking the
 * Runtime it just created (never mounted, never disposed) or corrupting remote Preview promotion. Serializing
 * removes the interleaving by construction: `switchShowcase()`'s own teardown/attach sequence
 * never starts until any prior queued transaction (Apply, preset, or another switch) has fully settled.
 *
 * Authoritative Document boundary for showcase replacement (#60 decision 1): a fresh `LabSession`
 * creates a fresh `WidgetDocument` at revision 0 from the target showcase's default source and creates
 * the Runtime for that already-committed Blueprint. Re-applying the identical default source would now
 * correctly be a Document `changed:false` no-op, so showcase switching adopts that revision-0 Runtime
 * directly after the old showcase has been detached/disposed. Manual edits and presets still go through
 * the normal Document mutation path; showcase replacement is a whole-system/context replacement rather
 * than a synthetic source edit.
 *
 * Apply's command-start capture/concurrency stays at command-call time (PR #19 review 4940721401):
 * the paragraph above says `apply()`/`applyPreset()` "route through" `enqueue()`, but they must not be
 * deferred* by it — the locked Apply lifecycle (diagnostic #13 comment 5289958311) requires the draft to be
 * captured, and a concurrent Apply to be rejected, synchronously at the moment `apply()`/`applyPreset()`
 * is called, not whenever the queue happens to reach that transaction. So `LabStore.apply()` and
 * `applyPreset()` call into `session.apply()`/`session.applyPreset()` directly and synchronously — outside
 * `enqueue()`'s `task` callback — and only hand the resulting, already in-flight promise to `enqueue()` to
 * await. `enqueue()` still does its job as the mutual-exclusion barrier (a queued `switchShowcase()` won't
 * start until that promise settles); it just never gets to choose when the Apply itself starts.
 *
 * That fix alone made the mutual exclusion one-directional (PR #19 review 4940839975): an in-flight
 * `apply()` correctly blocks a *later-queued* `switchShowcase()` (its task, unlike Apply's, legitimately
 * starts later, from inside the queue — see above), but nothing stopped `apply()`/`applyPreset()`'s own
 * synchronous, immediate `session.*` call from firing while a `switchShowcase()` was already mid-flight
 * (queued, or actually running `performSwitchShowcase()`'s detach/dispose/reassign sequence). That would
 * start a real second Apply against the *pre-switch* `session`/remote Preview host while the switch is
 * concurrently tearing down and reassigning those very same mutable bindings — reproducing the original
 * finding-1 hazard (orphaned/never-mounted Runtime, or `mountPreview()` resolving against whichever
 * session `switchShowcase()` has since reassigned to the outer variable) from the other direction.
 *
 * `switchTransactionCount` (below) closes that gap: it is incremented synchronously the instant
 * `switchShowcase()` is *called* — before `enqueue()` even runs — and only decremented once that call's
 * whole queued transaction has fully settled, so it stays truthy across the entire span a switch
 * occupies the lifecycle boundary, including the queued-but-not-yet-started gap. `apply()`/`applyPreset()`
 * check it synchronously, first, before touching `session` at all: while any switch is outstanding they
 * reject immediately with the same `{ status: 'skipped-concurrent' }` shape Apply already uses for "an
 * Apply is already running" (diagnostic #13 comment 5289958311's "Apply is disabled while one is running",
 * read to cover the lifecycle boundary in general, not only a same-session Apply) — never queuing a
 * second real mutation behind the switch. `switchShowcase()` itself keeps its existing behavior toward a
 * concurrent Apply unchanged: it still *waits* (via `enqueue()`) rather than rejecting, because an
 * in-flight Apply's own promise is already the thing occupying the queue by the time `switchShowcase()`
 * enqueues behind it — there is no case where `switchShowcase()` needs to jump an in-flight Apply.
 */

import type { WidgetDocumentSnapshot } from '@deviltea/widget-core'
import type { InjectionKey, Ref } from 'vue'
import type { ExampleState } from '../lab/example'
import type { DocumentScopedInspectorFocus, InspectorFocus, InspectorFocusScope, InspectorFocusStore, PreviewInspectorFocus, PreviewScopedInspectorFocus } from '../lab/focus'
import type { LabProblem } from '../lab/problems'
import type { LabStatus } from '../lab/status'
import type { ApplyOutcome, AuthorCommand, AuthorOutcome, LabAppliedSourcePatch, LabDocumentTraceEvent, RevisionConflictDemoResult, UndoOutcome } from '../lab/types'
import type { PreviewHostCoordinator } from '../preview-host/coordinator'
import type { ShowcaseEntry, ShowcasePreset } from '../showcases/registry'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, inject, shallowRef, watch } from 'vue'
import { deriveExampleState } from '../lab/example'
import { createInspectorFocusStore } from '../lab/focus'
import { collectProblems } from '../lab/problems'
import { getLabRevisionStatus } from '../lab/revisions'
import { LabSession } from '../lab/session'
import { deriveLabStatus } from '../lab/status'
import { createPreviewHostCoordinator } from '../preview-host/coordinator'
import { defaultShowcase, listedShowcases, showcases } from '../showcases/registry'

/**
 * `'preview'` is included (diagnostic #25 P1) even though Preview lives in its own always-visible Dockview
 * group, never the same tab group as the other six: it lets `Workbench.vue`'s tab-activation bridge
 * (`activeTab` -> `DockviewApi.getPanel(id)?.api.setActive()`) treat all seven canonical panels
 * uniformly — activating Preview's own single-panel group is a harmless no-op, never a layout change.
 */
export type LabToolTab = 'author' | 'widget' | 'blueprint' | 'runtime' | 'events' | 'dependencies' | 'preview'

export interface LabStore {
	readonly session: LabSession
	/** Remote iframe Preview coordinator. Parent code never owns a Core Runtime. */
	readonly previewHost: PreviewHostCoordinator
	readonly draftSourceText: Readonly<Ref<string>>
	readonly parseError: Readonly<Ref<LabSession['parseError']>>
	/** Direct reactive view of Core's committed authored-state snapshot. */
	readonly documentSnapshot: Readonly<Ref<WidgetDocumentSnapshot>>
	/** Current applied authored representation + Document revision/Blueprint. */
	readonly documentState: Readonly<Ref<LabSession['documentState']>>
	/** Last valid Preview Runtime snapshot, which may intentionally lag the Document revision. */
	readonly preview: Readonly<Ref<LabSession['preview']>>
	/** Explicit focus attached to the current Document Blueprint revision. */
	readonly documentFocus: Readonly<Ref<DocumentScopedInspectorFocus | null>>
	/** Explicit focus attached to the Preview Blueprint/Runtime revision, when one exists. */
	readonly previewFocus: Readonly<Ref<PreviewScopedInspectorFocus | null>>
	/** Whether Document and Preview are linked, diverged, or have no valid Preview. */
	readonly revisionStatus: Readonly<Ref<ReturnType<typeof getLabRevisionStatus>>>
	/** Latest accepted SourcePatch as transient developer telemetry, never a source/history authority. */
	readonly lastAppliedSourcePatch: Readonly<Ref<LabAppliedSourcePatch | null>>
	/** Bounded session-only Document observations, never replayable history. */
	readonly documentTrace: Readonly<Ref<readonly LabDocumentTraceEvent[]>>
	readonly isApplying: Readonly<Ref<boolean>>
	readonly isDirty: Readonly<Ref<boolean>>
	/** Apply is available: an unapplied draft exists and no lifecycle command is running. */
	readonly canApply: Readonly<Ref<boolean>>
	/**
	 * "Undo last apply" is available: a previously applied source exists, there is no unapplied draft (Undo
	 * never discards typing; Revert or Apply it first) and no lifecycle command is running.
	 */
	readonly canUndo: Readonly<Ref<boolean>>
	/** How many applied sources "Undo last apply" can step back through (bounded by `LAB_UNDO_LIMIT`). */
	readonly undoDepth: Readonly<Ref<number>>
	/** Plain-language header status: Document validity and whether Preview shows it. */
	readonly status: Readonly<Ref<LabStatus>>
	/** The Problems list: the last Apply's JSON syntax error and the Document's Core diagnostics. */
	readonly problems: Readonly<Ref<readonly LabProblem[]>>
	/** The preset the document was last started from (the showcase default on entry, then the last loaded preset). */
	readonly loadedPresetId: Readonly<Ref<string | null>>
	/** What the Examples menu names: the loaded preset, or "edited" once the source no longer matches it. */
	readonly example: Readonly<Ref<ExampleState<ShowcasePreset>>>
	/** Which Author view is open. Lives here (not in `AuthorPanel`) so other surfaces can open the JSON view. */
	readonly authorView: Ref<'catalog' | 'structure' | 'json'>
	/**
	 * Set by `showProblems()`: `AuthorJsonView` moves focus to its Problems list (when it is already mounted, or
	 * as soon as it mounts) and clears the flag.
	 */
	readonly problemsFocusPending: Ref<boolean>
	/** @deprecated Use `documentFocus` or `previewFocus` according to the surface's scope. */
	readonly focus: Readonly<Ref<InspectorFocus | null>>
	/** The showcases the header lists (hidden test-only fixtures excluded; `switchShowcase()` still accepts them). */
	readonly showcases: readonly ShowcaseEntry[]
	readonly showcaseId: Readonly<Ref<string>>
	readonly presets: Readonly<Ref<readonly ShowcasePreset[]>>
	readonly activeTab: Ref<LabToolTab>
	/**
	 * Dependency Graph presentation preferences (diagnostic #13 Phase 5 "inspector panel interaction
	 * contract"): panel-local, and — unlike snapshot-bound focus/selections — deliberately not reset by
	 * `session.subscribe()`/Apply, since these plain refs live on the `LabStore` object itself rather than
	 * being derived from `session`.
	 */
	readonly graphShowAbsent: Ref<boolean>
	readonly graphShowIsolatedMembers: Ref<boolean>
	/**
	 * The expanded widget clusters of the Graph: at most one (issue #254). The fully expanded Graph was measured unreadable
	 * (issue #230), so expanding a widget collapses the one expanded before, and there is no "expand all".
	 */
	readonly graphExpandedClusterIds: Readonly<Ref<ReadonlySet<string>>>
	/** Expands `clusterId` and collapses the widget expanded before it, if any. */
	expandGraphCluster: (clusterId: string) => void
	collapseGraphCluster: (clusterId: string) => void
	toggleGraphCluster: (clusterId: string) => void
	collapseAllGraphClusters: () => void
	setDraftSourceText: (text: string) => void
	apply: () => Promise<ApplyOutcome>
	author: (command: AuthorCommand) => Promise<AuthorOutcome>
	format: () => void
	/** Discards the unapplied draft only (the applied Document is untouched). See `undoLastApply` for going back. */
	revert: () => void
	/** Restores the previously applied source as a new Document revision; see `LabSession.undoLastApply()`. */
	undoLastApply: () => Promise<UndoOutcome>
	/** Mounts the Preview again after it failed to load or to take a change; see `LabSession.retryPreview()`. */
	retryPreview: () => Promise<void>
	/** Opens Author > JSON and moves focus to the Problems list. */
	showProblems: () => void
	applyPreset: (presetId: string) => Promise<ApplyOutcome | undefined>
	demonstrateRevisionConflict: () => RevisionConflictDemoResult | null
	/** No-op when `id` is unknown or already the current showcase. Serialized against Apply/itself. */
	switchShowcase: (id: string) => Promise<void>
	setFocus: {
		(scope: 'document', focus: InspectorFocus | null): void
		(scope: 'preview', focus: PreviewInspectorFocus | null): void
		/** @deprecated Document scope compatibility for tutorial and existing callers. */
		(focus: InspectorFocus | null): void
	}
	dispose: () => void
}

export const LabStoreKey: InjectionKey<LabStore> = Symbol('widget-lab:store')

export function createLabStore(initialShowcase: ShowcaseEntry = defaultShowcase): LabStore {
	const previewHost = createPreviewHostCoordinator()
	const showcaseId = shallowRef(initialShowcase.id)
	const presets = shallowRef<readonly ShowcasePreset[]>(initialShowcase.presets)
	const loadedPresetId = shallowRef<string | null>(initialShowcase.defaultPreset.id)
	const authorView = shallowRef<'catalog' | 'structure' | 'json'>('json')
	const problemsFocusPending = shallowRef(false)

	const sessionTick = shallowRef(0)
	const documentTick = shallowRef(0)
	const focusTick = shallowRef(0)

	let currentShowcase: ShowcaseEntry = initialShowcase
	// Mutable by design: `switchShowcase` reassigns both on a showcase change. Every closure below reads
	// these at call time (never destructures them up front), so a reassignment is visible everywhere
	// without re-wiring `computed()`/returned functions. The serialized `enqueue()` transaction queue
	// below is what makes that reassignment safe — see the file header.
	let session: LabSession
	let focusStore: InspectorFocusStore
	let unsubscribeSession: () => void
	let unsubscribeDocument: () => void
	let unsubscribeFocus: () => void

	// Final-disposal guard (PR #19 review 4940219714, finding 1's "final disposal has guard" ask):
	// `dispose()` itself stays synchronous (App.vue's `onUnmounted` calls it without awaiting, and
	// a lifecycle transaction already mid-flight cannot be synchronously cancelled. `disposed` prevents
	// a late promotion intent from being handed to a Preview host the application no longer owns.
	let disposed = false

	// Symmetric mutual-exclusion counterpart to `LabSession.isApplying` (PR #19 review 4940839975): counts
	// `switchShowcase()` calls whose queued transaction has not yet fully settled, so `apply()`/
	// `applyPreset()` can detect "a switch currently occupies the lifecycle boundary" *before* they touch
	// `session` at all — even during the gap between a switch being called and its queued task actually
	// starting, which a boolean toggled only from inside `performSwitchShowcase()` would miss. A counter
	// rather than a boolean because `switchShowcase()` calls can themselves overlap (see the "serializes
	// repeated switchShowcase() calls" test): it must stay truthy until every outstanding call's own
	// transaction has settled, not just the first one to resolve.
	let switchTransactionCount = 0

	/**
	 * Serializes every lifecycle-mutating operation (`apply`, `applyPreset`, `switchShowcase`) into one
	 * chain: each call's `task` only starts once every previously enqueued task has settled, regardless
	 * of how the caller interleaves them. This is the fix for PR #19 review 4940219714 finding 1 — see
	 * the file header for the exact hazard it closes.
	 *
	 * Command-start capture/concurrency (PR #19 review 4940721401): this barrier must never be the thing
	 * that decides *when* an Apply's own draft capture or `isApplying` concurrency guard runs — those are
	 * `LabSession.apply()`'s contract (diagnostic #13 comment 5289958311) and must fire synchronously, at
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
			replacePreview: async (nextPreview: NonNullable<LabSession['preview']>) => {
				if (disposed)
					return
				await previewHost.replace({
					showcaseId: currentShowcase.id,
					revision: nextPreview.revision,
					sourceText: nextPreview.sourceText,
				})
			},
		}
	}

	function attachInitial(showcase: ShowcaseEntry): void {
		// Construction is synchronous and Runtime-free. The initial last-valid snapshot is promoted to
		// the iframe once PreviewPanel attaches a browser driver to `previewHost`.
		session = new LabSession({
			system: showcase.system,
			initialSourceText: showcase.defaultPreset.sourceText,
			hooks: createHooks(),
		})
		const initialPreview = session.preview
		if (initialPreview !== null) {
			void previewHost.replace({
				showcaseId: showcase.id,
				revision: initialPreview.revision,
				sourceText: initialPreview.sourceText,
			})
				.catch(() => {})
		}

		focusStore = createInspectorFocusStore(session)
		unsubscribeSession = session.subscribe(() => {
			sessionTick.value++
		})
		unsubscribeDocument = session.subscribeDocument(() => {
			documentTick.value++
		})
		unsubscribeFocus = focusStore.subscribe(() => {
			focusTick.value++
		})
	}

	attachInitial(initialShowcase)

	const stopPreviewConnection = watch(
		previewHost.connection,
		(connection) => {
			if (connection === null) {
				focusStore.setPreviewSnapshot(0, null)
				return
			}
			focusStore.setPreviewSnapshot(connection.revision, connection.blueprint)
		},
		{ immediate: true },
	)

	const draftSourceText = computed(() => {
		void sessionTick.value
		return session.draftSourceText
	})
	const parseError = computed(() => {
		void sessionTick.value
		return session.parseError
	})
	const documentSnapshot = computed(() => {
		void documentTick.value
		return session.documentSnapshot
	})
	const documentState = computed(() => {
		void sessionTick.value
		return session.documentState
	})
	const preview = computed(() => {
		void sessionTick.value
		return session.preview
	})
	const isApplying = computed(() => {
		void sessionTick.value
		return session.isApplying
	})
	const isDirty = computed(() => {
		void sessionTick.value
		return session.isDirty
	})
	const canApply = computed(() => isDirty.value && !isApplying.value)
	const undoDepth = computed(() => {
		void sessionTick.value
		return session.undoDepth
	})
	const canUndo = computed(() => undoDepth.value > 0 && !isDirty.value && !isApplying.value)
	const focus = computed(() => {
		void focusTick.value
		return focusStore.getFocus()
	})
	const documentFocus = computed(() => {
		void focusTick.value
		return focusStore.getScopedFocus('document')
	})
	const previewFocus = computed(() => {
		void focusTick.value
		return focusStore.getScopedFocus('preview')
	})
	const revisionStatus = computed(() => {
		void sessionTick.value
		return getLabRevisionStatus(session.documentState.revision, session.preview?.revision ?? null)
	})
	const status = computed(() => {
		void sessionTick.value
		const { blueprint } = session.documentState
		return deriveLabStatus({
			blueprintStatus: blueprint.status,
			diagnosticCount: blueprint.diagnostics.length,
			hasParseError: session.parseError !== null,
			revisions: getLabRevisionStatus(session.documentState.revision, session.preview?.revision ?? null),
			previewFailed: previewHost.error.value !== null && !previewHost.runtimeSurvives.value,
		})
	})
	// Depends on the committed Blueprint and the Lab-only parse error, both reference-stable computeds, rather than
	// on `sessionTick` (which every keystroke bumps): typing re-runs neither the Blueprint inspection nor the
	// diagnostic collection; only a commit, an Apply that fails to parse, or the first edit after such a failure does.
	const committedBlueprint = computed(() => documentState.value.blueprint)
	const problems = computed(() => collectProblems(committedBlueprint.value, inspectBlueprint(committedBlueprint.value), parseError.value))
	const example = computed(() => {
		void sessionTick.value
		return deriveExampleState({
			loadedPresetId: loadedPresetId.value,
			presets: presets.value,
			appliedSourceText: session.documentState.sourceText,
			isDirty: session.isDirty,
		})
	})
	const lastAppliedSourcePatch = computed(() => {
		void sessionTick.value
		return session.lastAppliedSourcePatch
	})
	const documentTrace = computed(() => {
		void sessionTick.value
		return session.documentTrace
	})

	const activeTab = shallowRef<LabToolTab>('author')
	const graphShowAbsent = shallowRef(false)
	const graphShowIsolatedMembers = shallowRef(false)
	const graphExpandedClusterIds = shallowRef<ReadonlySet<string>>(new Set())

	// At most one expanded widget (issue #254): expanding one replaces the set, so the one expanded before collapses.
	function expandGraphCluster(clusterId: string): void {
		if (!graphExpandedClusterIds.value.has(clusterId))
			graphExpandedClusterIds.value = new Set([clusterId])
	}

	function collapseGraphCluster(clusterId: string): void {
		if (graphExpandedClusterIds.value.has(clusterId))
			graphExpandedClusterIds.value = new Set()
	}

	function toggleGraphCluster(clusterId: string): void {
		if (graphExpandedClusterIds.value.has(clusterId))
			collapseGraphCluster(clusterId)
		else
			expandGraphCluster(clusterId)
	}

	function collapseAllGraphClusters(): void {
		graphExpandedClusterIds.value = new Set()
	}

	/**
	 * The body of `switchShowcase()`, run only from inside `enqueue()`. Reads
	 * `currentShowcase`/`session` fresh (never captured before enqueueing) so repeated/queued switches
	 * each observe whatever the *previous* queued transaction actually left behind. A showcase switch
	 * replaces the whole System/Document context; it does not synthesize a same-source Apply.
	 */
	async function performSwitchShowcase(id: string): Promise<void> {
		if (disposed)
			return
		if (id === currentShowcase.id)
			return
		const target = showcases.find(showcase => showcase.id === id)
		if (target === undefined)
			return

		// 1. Tear down only parent-side subscriptions. The iframe driver owns the old renderer/Runtime
		// and will replace them atomically when the new descriptor is promoted below.
		unsubscribeSession()
		unsubscribeDocument()
		unsubscribeFocus()
		focusStore.dispose()

		// 2. Switch authored showcase context to a fresh revision-0 Document. No parent Runtime is created.
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
		unsubscribeDocument = session.subscribeDocument(() => {
			documentTick.value++
		})
		unsubscribeFocus = focusStore.subscribe(() => {
			focusTick.value++
		})

		showcaseId.value = target.id
		presets.value = target.presets
		loadedPresetId.value = target.defaultPreset.id
		graphExpandedClusterIds.value = new Set()
		sessionTick.value++
		documentTick.value++
		focusTick.value++

		if (disposed)
			return

		// 3. Promote the fresh target snapshot into the one authoritative iframe Runtime host.
		const nextPreview = session.preview
		if (nextPreview !== null) {
			await previewHost.replace({
				showcaseId: target.id,
				revision: nextPreview.revision,
				sourceText: nextPreview.sourceText,
			})
		}
	}

	return {
		get session() {
			return session
		},
		previewHost,
		draftSourceText,
		parseError,
		documentSnapshot,
		documentState,
		preview,
		documentFocus,
		previewFocus,
		revisionStatus,
		lastAppliedSourcePatch,
		documentTrace,
		isApplying,
		isDirty,
		canApply,
		canUndo,
		undoDepth,
		status,
		problems,
		loadedPresetId,
		example,
		authorView,
		problemsFocusPending,
		focus,
		showcases: listedShowcases,
		showcaseId,
		presets,
		activeTab,
		graphShowAbsent,
		graphShowIsolatedMembers,
		graphExpandedClusterIds,
		expandGraphCluster,
		collapseGraphCluster,
		toggleGraphCluster,
		collapseAllGraphClusters,
		setDraftSourceText: text => session.setDraftSourceText(text),
		// `session.apply()` is invoked here, synchronously, at command-call time — never deferred behind
		// `enqueue()`. See the "Command-start capture/concurrency" note above `enqueue()` for why: an
		// async function's own body runs synchronously up to its first `await`, so calling it inline is
		// what lets `LabSession.apply()`'s own capture-the-draft and `isApplying` concurrency guard fire
		// immediately, in this turn, exactly as the locked Apply lifecycle (diagnostic #13 comment 5289958311)
		// requires. `enqueue()` only wraps the resulting (already in-flight) promise, so it still serves
		// as the mutual-exclusion barrier against a concurrent `switchShowcase()`.
		apply: () => {
			// Symmetric half of the mutual exclusion (PR #19 review 4940839975): a switch that already
			// occupies the lifecycle boundary — queued or actually mid-flight — must block a *new* Apply
			// from starting, exactly as an already-running Apply blocks a new switch. Checked before
			// `session` is touched at all, so a rejected call never mutates anything.
			if (switchTransactionCount > 0 || session.isApplying)
				return Promise.resolve({ status: 'skipped-concurrent' })
			const outcome = session.apply()
			return enqueue(() => outcome)
		},
		author: (command) => {
			if (switchTransactionCount > 0)
				return Promise.resolve({ status: 'skipped-concurrent' })
			const outcome = session.author(command)
			return enqueue(() => outcome)
		},
		format: () => session.format(),
		revert: () => session.revert(),
		retryPreview: () => enqueue(() => session.retryPreview()),
		undoLastApply: () => {
			if (switchTransactionCount > 0)
				return Promise.resolve({ status: 'skipped-concurrent' })
			const outcome = session.undoLastApply()
			return enqueue(() => outcome)
		},
		showProblems: () => {
			activeTab.value = 'author'
			authorView.value = 'json'
			problemsFocusPending.value = true
		},
		applyPreset: (presetId) => {
			// Same symmetric guard as `apply()` above, checked first so a concurrent switch also short-
			// circuits the (otherwise pure) preset lookup rather than resolving it against a showcase that
			// might be mid-replacement.
			if (switchTransactionCount > 0)
				return Promise.resolve({ status: 'skipped-concurrent' })
			const preset = currentShowcase.presets.find(candidate => candidate.id === presetId)
			if (preset === undefined)
				return enqueue(async () => undefined)
			// Same reasoning as `apply()` above: `session.applyPreset()` synchronously sets the draft text
			// and synchronously starts `session.apply()` (capture + concurrency guard) before this line
			// returns. `enqueue()` only barriers a concurrent `switchShowcase()`/`apply()` behind it.
			const targetSession = session
			const outcome = session.applyPreset(preset.sourceText)
			return enqueue(async () => {
				const result = await outcome
				// A switch queued behind this preset replaces the session only after it settled, so the check
				// is a guard rather than an expected case: never name a preset in a showcase it does not belong to.
				if (result.status === 'applied' && session === targetSession)
					loadedPresetId.value = presetId
				return result
			})
		},
		demonstrateRevisionConflict: () => {
			if (switchTransactionCount > 0)
				return null
			return session.demonstrateRevisionConflict()
		},
		switchShowcase: (id) => {
			// Incremented synchronously, at call time — before `enqueue()` even runs — so `apply()`/
			// `applyPreset()`'s guard above sees this switch as outstanding for its *entire* span,
			// including the gap between this call and its queued task actually starting. Decremented once
			// this call's own transaction has fully settled, whatever the outcome (a real switch, or one
			// of `performSwitchShowcase()`'s own no-op returns).
			switchTransactionCount++
			const outcome = enqueue(() => performSwitchShowcase(id))
			outcome.then(
				() => { switchTransactionCount-- },
				() => { switchTransactionCount-- },
			)
			return outcome
		},
		setFocus: ((scopeOrFocus: InspectorFocusScope | InspectorFocus | null, next?: InspectorFocus | PreviewInspectorFocus | null) => {
			if (typeof scopeOrFocus !== 'string') {
				focusStore.setFocus(scopeOrFocus)
				return
			}
			if (scopeOrFocus === 'document')
				focusStore.setFocus('document', next as InspectorFocus | null)
			else
				focusStore.setFocus('preview', next as PreviewInspectorFocus | null)
		}) as LabStore['setFocus'],
		/** Final application teardown. Remote renderer/Runtime ownership is released by the coordinator. */
		dispose: () => {
			if (disposed)
				return
			disposed = true
			unsubscribeSession()
			unsubscribeDocument()
			unsubscribeFocus()
			focusStore.dispose()
			stopPreviewConnection()
			previewHost.dispose()
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
