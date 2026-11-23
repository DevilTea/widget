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
 * an in-flight `session.commitJson()` awaiting `detachPreview()`/`mountPreview()` could still be running
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
 * `applyPreset()` call into `session.commitJson()`/`session.applyPreset()` directly and synchronously — outside
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
 *
 * Lab UX phase 3 (one commit model) removed the Apply button: "Apply" above is now the JSON commit (`flushJson()`, run by the
 * auto-commit timer, on blur and before other commands), and every command — JSON commit, Structure command, Undo, preset —
 * goes through `runCommand()`. It keeps the rules above (synchronous start at call time when nothing runs, refusal while a
 * switch is outstanding) with one change: a command that arrives while another runs waits for it instead of being refused,
 * because a blur commit routinely runs when the click that caused the blur arrives.
 */

import type { WidgetDocumentSnapshot } from '@deviltea/widget-core'
import type { InjectionKey, Ref } from 'vue'
import type { ExampleState } from '../lab/example'
import type { DocumentScopedInspectorFocus, InspectorFocus, InspectorFocusScope, InspectorFocusStore, PreviewInspectorFocus, PreviewScopedInspectorFocus } from '../lab/focus'
import type { LabProblem } from '../lab/problems'
import type { LabStatus } from '../lab/status'
import type { ToolId } from '../lab/tools'
import type { ApplyOutcome, AuthorCommand, AuthorOutcome, LabAppliedSourcePatch, LabDocumentTraceEvent, RevisionConflictDemoResult, UndoOutcome } from '../lab/types'
import type { PreviewHostCoordinator } from '../preview-host/coordinator'
import type { ShowcaseEntry, ShowcasePreset } from '../showcases/registry'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { computed, inject, shallowRef, watch } from 'vue'
import { hasCommittedEdits } from '../lab/draft-guard'
import { deriveExampleState } from '../lab/example'
import { createInspectorFocusStore } from '../lab/focus'
import { collectProblems } from '../lab/problems'
import { getLabRevisionStatus } from '../lab/revisions'
import { LabSession } from '../lab/session'
import { deriveLabStatus } from '../lab/status'
import { createPreviewHostCoordinator } from '../preview-host/coordinator'
import { defaultShowcase, listedShowcases, showcases } from '../showcases/registry'

/**
 * The canonical (never closed) panels: the tool group's Edit, Explain and Tools tabs (Lab UX phase 3B) and the Preview.
 * `'preview'` is included (diagnostic #25 P1) even though Preview lives in its own always-visible Dockview group: it lets
 * `Workbench.vue`'s tab-activation bridge (`activeTab` -> `DockviewApi.getPanel(id)?.api.setActive()`) treat all canonical
 * panels uniformly. The expert views are not tabs of this kind: they open on request in the Tools group (`openTool()`).
 */
export type LabToolTab = 'edit' | 'explain' | 'tools' | 'preview'

/** One request to open (or focus) an expert view in the Tools group; `tick` makes a repeated request a new one. */
export interface ToolOpenRequest {
	readonly tool: ToolId
	readonly tick: number
}

export interface LabStore {
	readonly session: LabSession
	/** Remote iframe Preview coordinator. Parent code never owns a Core Runtime. */
	readonly previewHost: PreviewHostCoordinator
	readonly draftSourceText: Readonly<Ref<string>>
	readonly parseError: Readonly<Ref<LabSession['parseError']>>
	/** Why the JSON view's text cannot be applied (a syntax error, or a commit Core refused for this text), or `null`. */
	readonly jsonBlock: Readonly<Ref<LabSession['jsonBlock']>>
	/** Direct reactive view of Core's committed authored-state snapshot. */
	readonly documentSnapshot: Readonly<Ref<WidgetDocumentSnapshot>>
	/** Current applied authored representation + Document revision/Blueprint. */
	readonly documentState: Readonly<Ref<LabSession['documentState']>>
	/** Last valid Preview Runtime snapshot, which may intentionally lag the Document revision. */
	readonly preview: Readonly<Ref<LabSession['preview']>>
	/** Explicit focus attached to the current Document Blueprint revision. */
	readonly documentFocus: Readonly<Ref<DocumentScopedInspectorFocus | null>>
	/** Whether `documentFocus` is a widget someone chose, not the root the focus starts at or falls back to (`InspectorFocusStore.isDocumentFocusChosen`). */
	readonly documentFocusChosen: Readonly<Ref<boolean>>
	/** Explicit focus attached to the Preview Blueprint/Runtime revision, when one exists. */
	readonly previewFocus: Readonly<Ref<PreviewScopedInspectorFocus | null>>
	/** Whether Document and Preview are linked, diverged, or have no valid Preview. */
	readonly revisionStatus: Readonly<Ref<ReturnType<typeof getLabRevisionStatus>>>
	/** Latest accepted SourcePatch as transient developer telemetry, never a source/history authority. */
	readonly lastAppliedSourcePatch: Readonly<Ref<LabAppliedSourcePatch | null>>
	/** Bounded session-only Document observations, never replayable history. */
	readonly documentTrace: Readonly<Ref<readonly LabDocumentTraceEvent[]>>
	readonly isApplying: Readonly<Ref<boolean>>
	/** The JSON view's text differs from the committed Document: a commit is pending (it parses) or it does not parse. */
	readonly isDirty: Readonly<Ref<boolean>>
	/**
	 * The JSON view's text does not parse (Lab UX phase 3: the only "draft" left). Nothing is committed from it; Structure is
	 * inert and Undo unavailable until it parses again or is discarded (`discardJsonChanges()`).
	 */
	readonly jsonBlocked: Readonly<Ref<boolean>>
	/**
	 * "Undo last change" is available: something can be undone (a committed source, or JSON text that parses and is committed
	 * first) and the JSON text parses (Undo never discards typing). A running command does not make it unavailable: Undo
	 * waits for it.
	 */
	readonly canUndo: Readonly<Ref<boolean>>
	/** How many committed sources "Undo last change" can step back through (bounded by `LAB_UNDO_LIMIT`). */
	readonly undoDepth: Readonly<Ref<number>>
	/**
	 * A commit replaced the Preview Runtime a moment ago (`PREVIEW_RESTARTED_MS`): the status chip says "Preview restarted".
	 * Not set by the first mount or a showcase switch.
	 */
	readonly previewRestarted: Readonly<Ref<boolean>>
	/** Plain-language header status and the one status chip: Document validity, the Preview, and whether the JSON text parses. */
	readonly status: Readonly<Ref<LabStatus>>
	/** The Problems list: the JSON text's syntax error (while it does not parse) and the Document's Core diagnostics. */
	readonly problems: Readonly<Ref<readonly LabProblem[]>>
	/** The preset the document was last started from (the showcase default on entry, then the last loaded preset). */
	readonly loadedPresetId: Readonly<Ref<string | null>>
	/** What the Examples menu names: the loaded preset, or "edited" once the source no longer matches it. */
	readonly example: Readonly<Ref<ExampleState<ShowcasePreset>>>
	/**
	 * The document differs from what was loaded: its source text equals no preset of the open showcase (`lab/draft-guard.ts`'s
	 * `hasCommittedEdits()`). The source is the committed one, or the JSON text when it parses but its commit is still pending
	 * (it is committed before any replacement runs); text that does not parse is `jsonBlocked`. A showcase switch asks
	 * before it drops such a document; a preset load (an ordinary commit) offers Undo afterwards through `replacedNotice`.
	 */
	readonly hasCommittedEdits: Readonly<Ref<boolean>>
	/**
	 * Set when a preset load (from the Examples menu or a tutorial start) replaced committed edits: the preset's label (an
	 * English message id) and the Document revision the load produced. The notice applies only while the Document is still at
	 * that revision (`replacedNoticeVisible`); Undo, any later commit or a showcase switch ends it.
	 */
	readonly replacedNotice: Readonly<Ref<{ readonly subject: string, readonly revision: number } | null>>
	readonly replacedNoticeVisible: Readonly<Ref<boolean>>
	dismissReplacedNotice: () => void
	/**
	 * Which view of the Edit tab is open: Structure on first load (Lab UX phase 1; it was JSON), then whatever the user chose.
	 * Not saved across reloads. Lives here (not in `AuthorPanel`) so other surfaces can open the JSON view. The Catalog is no
	 * longer a view (Lab UX phase 3B): it is the "Browse widget types" slide-over of the Edit tab.
	 */
	readonly authorView: Ref<'structure' | 'json'>
	/**
	 * Set by `showProblems()`: the open Author view consumes it (when it is already mounted, or as soon as it mounts) and
	 * clears the flag. `AuthorJsonView` moves focus to its Problems list; `AuthorStructureView` selects the first problem's
	 * widget and focuses its field, its header's problems or the Structure Problems list.
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
	 * The canonical panel shown in the tool group (the group that holds Edit), kept by `Workbench.vue` from Dockview; `null`
	 * before the workbench is up or while something else is shown there (an expert view the user dragged into it). `activeTab` is
	 * shared by every Dockview group and is often `preview`; the tutorial records this one to give the user their tab back.
	 */
	readonly toolGroupTab: Ref<LabToolTab | null>
	/**
	 * The latest request to open an expert view (`openTool()`); `Workbench.vue` adds its tab to the Tools group beside the
	 * Preview, or focuses the tab that is already open. Implementation and Document Tools keep their own request stores
	 * (`use-implementation-explorer.ts`, `use-document-tools.ts`); `useOpenTool()` routes to the right one.
	 */
	readonly toolOpenRequest: Readonly<Ref<ToolOpenRequest | null>>
	/** Opens (or focuses) an expert view in the Tools group. Implementation and Document Tools go through `useOpenTool()`. */
	openTool: (tool: Exclude<ToolId, 'implementation' | 'document-tools'>) => void
	/** The expert views open right now, kept by `Workbench.vue` (the Tools menu marks them). */
	readonly openTools: Ref<ReadonlySet<ToolId>>
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
	/**
	 * The JSON view's text changed (typing). Text that parses is committed after `JSON_COMMIT_DELAY_MS` without further edits;
	 * text that does not parse is never committed (`jsonBlocked`).
	 */
	editJson: (text: string) => void
	/** The JSON editor got focus: a new burst of JSON commits starts, which shares one Undo entry. */
	beginJsonEdit: () => void
	/** The JSON editor has keyboard focus: an editing session (one Undo burst) is open. */
	readonly jsonEditorFocused: Readonly<Ref<boolean>>
	/** The JSON editor lost focus: commits pending text at once and ends the burst. */
	endJsonEdit: () => Promise<ApplyOutcome | null>
	/**
	 * Commits pending JSON text at once (Cmd/Ctrl+Enter in the editor, blur, and before every other command), within the
	 * current burst. `null` when there is nothing to commit (no pending text, or text that does not parse).
	 */
	flushJson: () => Promise<ApplyOutcome | null>
	/** Discards the JSON text (the committed Document is untouched): the header's "Discard JSON changes". */
	discardJsonChanges: () => void
	/**
	 * Runs a Structure command. Pass a builder to have the command built when it starts (it may wait behind a running command, so
	 * it must read the revision and the node then); `null` from the builder means its widget is gone (`stale-selection`).
	 */
	author: (command: AuthorCommand | (() => AuthorCommand | null)) => Promise<AuthorOutcome>
	/** Formats the JSON text and commits it (a structural no-op when nothing else changed). Nothing happens while it does not parse. */
	format: () => Promise<ApplyOutcome | null>
	/**
	 * Restores the previously committed source as a new Document revision (`LabSession.undo()`), after committing pending JSON
	 * text (so one Undo takes back the burst it belongs to). Waits for a running command; `draft-dirty` while the JSON text
	 * does not parse.
	 */
	undo: () => Promise<UndoOutcome>
	/** Mounts the Preview again after it failed to load or to take a change; see `LabSession.retryPreview()`. */
	retryPreview: () => Promise<void>
	/** Activates Edit and shows the problems in its open view (Structure or JSON); see `problemsFocusPending`. */
	showProblems: () => void
	applyPreset: (presetId: string) => Promise<ApplyOutcome | undefined>
	demonstrateRevisionConflict: () => RevisionConflictDemoResult | null
	/** No-op when `id` is unknown or already the current showcase. Serialized against commits/itself. Drops pending JSON text. */
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

/** How long the JSON text must stay unedited before it is committed (Lab UX phase 3); blur commits at once. */
export const JSON_COMMIT_DELAY_MS = 750
/** How long the status chip says "Preview restarted" after a commit replaced the Runtime. */
export const PREVIEW_RESTARTED_MS = 2500

export function createLabStore(initialShowcase: ShowcaseEntry = defaultShowcase): LabStore {
	const previewHost = createPreviewHostCoordinator()
	const showcaseId = shallowRef(initialShowcase.id)
	const presets = shallowRef<readonly ShowcasePreset[]>(initialShowcase.presets)
	const loadedPresetId = shallowRef<string | null>(initialShowcase.defaultPreset.id)
	const authorView = shallowRef<'structure' | 'json'>('structure')
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

	/**
	 * Runs a session command (a commit, Undo, a Structure command, a preset). Lab UX phase 3: a command that arrives while
	 * another one runs WAITS for it instead of being refused. With immediate commits that is the common case: leaving the JSON
	 * editor for a Structure control or the Undo button commits the JSON text on blur, and the click lands while that commit is
	 * still promoting the Preview. When nothing runs, the command starts synchronously, as before (its capture happens at call
	 * time); while one runs it starts inside the queue, right after it. A switch that occupies the lifecycle boundary still
	 * refuses (see the file header): the session it would run against is about to be replaced.
	 */
	function runCommand<T>(start: () => Promise<T>, skipped: T): Promise<T> {
		if (switchTransactionCount > 0 || disposed)
			return Promise.resolve(skipped)
		if (session.isApplying)
			return enqueue(start)
		const outcome = start()
		return enqueue(() => outcome)
	}

	// ---------------------------------------------------------------------------------------------------------
	// JSON auto-commit (Lab UX phase 3). The JSON view's text is committed through the same root SourcePatch path as every
	// other edit when it parses: `JSON_COMMIT_DELAY_MS` after the last edit, and at once on blur (and before any other
	// command). Each focus session of the editor is one burst: its commits share one Undo entry (`LabSession` coalesce key).

	let jsonCommitTimer: ReturnType<typeof setTimeout> | null = null
	let jsonEditCount = 0
	/** The coalesce key of the current focus session of the JSON editor; `null` outside one (seam edits, Format, a preset). */
	let jsonEditKey: number | null = null
	/** The JSON editor has keyboard focus (an editing session is open); the status announcement waits while it does. */
	const jsonEditorFocused = shallowRef(false)
	/** The Undo that was asked for and has not finished yet; further requests until it does are the same Undo. */
	let undoInFlight: Promise<UndoOutcome> | null = null

	function cancelJsonCommit(): void {
		if (jsonCommitTimer !== null) {
			clearTimeout(jsonCommitTimer)
			jsonCommitTimer = null
		}
	}

	/** JSON text that differs from the Document and can still be tried: not blocked (`LabSession.jsonBlock`). */
	function hasPendingJson(): boolean {
		return session.isDirty && session.jsonBlock === null
	}

	/** Commits the JSON text if it parses and differs from the Document; within the burst `key`. Call only inside a command. */
	async function commitPendingJsonIn(key: number | null): Promise<ApplyOutcome | null> {
		if (!hasPendingJson())
			return null
		return session.commitJson({ coalesceKey: key })
	}

	function flushJsonIn(key: number | null): Promise<ApplyOutcome | null> {
		cancelJsonCommit()
		if (!hasPendingJson())
			return Promise.resolve(null)
		return runCommand(() => commitPendingJsonIn(key), { status: 'skipped-concurrent' })
	}

	function flushJson(): Promise<ApplyOutcome | null> {
		return flushJsonIn(jsonEditKey)
	}

	function scheduleJsonCommit(): void {
		cancelJsonCommit()
		if (!hasPendingJson())
			return
		jsonCommitTimer = setTimeout(() => {
			jsonCommitTimer = null
			void flushJson()
		}, JSON_COMMIT_DELAY_MS)
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
	const jsonBlock = computed(() => {
		void sessionTick.value
		return session.jsonBlock
	})
	const jsonBlocked = computed(() => jsonBlock.value !== null)
	const undoDepth = computed(() => {
		void sessionTick.value
		return session.undoDepth
	})
	const canUndo = computed(() => !jsonBlocked.value && (undoDepth.value > 0 || isDirty.value))
	const previewRestarted = shallowRef(false)
	let previewRestartedTimer: ReturnType<typeof setTimeout> | null = null
	function clearPreviewRestarted(): void {
		if (previewRestartedTimer !== null)
			clearTimeout(previewRestartedTimer)
		previewRestartedTimer = null
		previewRestarted.value = false
	}
	// What the watcher below saw last: a new Preview snapshot of the SAME session is a commit (or a retry) that replaced the
	// Runtime; the first snapshot of a new session (a showcase switch) is not.
	let previewSeen: { readonly session: LabSession, readonly preview: LabSession['preview'] } | null = null
	const stopPreviewRestarted = watch(preview, (next) => {
		const seen = previewSeen
		previewSeen = { session, preview: next }
		if (seen === null || seen.session !== session || next === null || seen.preview === next)
			return
		previewRestarted.value = true
		if (previewRestartedTimer !== null)
			clearTimeout(previewRestartedTimer)
		previewRestartedTimer = setTimeout(() => {
			previewRestartedTimer = null
			previewRestarted.value = false
		}, PREVIEW_RESTARTED_MS)
	}, { flush: 'sync', immediate: true })
	const focus = computed(() => {
		void focusTick.value
		return focusStore.getFocus()
	})
	const documentFocus = computed(() => {
		void focusTick.value
		return focusStore.getScopedFocus('document')
	})
	const documentFocusChosen = computed(() => {
		void focusTick.value
		return focusStore.isDocumentFocusChosen()
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
			jsonBlock: session.jsonBlock,
			revisions: getLabRevisionStatus(session.documentState.revision, session.preview?.revision ?? null),
			previewFailed: previewHost.error.value !== null && !previewHost.runtimeSurvives.value,
			isApplying: session.isApplying,
			previewRestarted: previewRestarted.value,
		})
	})
	// Depends on the committed Blueprint and the Lab-only parse error, both reference-stable computeds, rather than
	// on `sessionTick` (which every keystroke bumps): typing text that parses re-runs neither the Blueprint inspection nor the
	// diagnostic collection. While the text does not parse, each edit has a new syntax error (its position moves), so only the
	// collection runs again; the inspection is its own computed and follows commits only.
	const committedBlueprint = computed(() => documentState.value.blueprint)
	const committedInspection = computed(() => inspectBlueprint(committedBlueprint.value))
	const problems = computed(() => collectProblems(committedBlueprint.value, committedInspection.value, jsonBlock.value))
	const example = computed(() => {
		void sessionTick.value
		return deriveExampleState({
			loadedPresetId: loadedPresetId.value,
			presets: presets.value,
			appliedSourceText: session.documentState.sourceText,
			isDirty: session.isDirty,
		})
	})
	/** The source a replacement would drop: the JSON text when it parses (it is committed first), else the committed one. */
	function effectiveSourceText(): string {
		return hasPendingJson() ? session.draftSourceText : session.documentState.sourceText
	}
	const hasCommittedEditsRef = computed(() => {
		void sessionTick.value
		return hasCommittedEdits(effectiveSourceText(), presets.value)
	})
	const replacedNotice = shallowRef<{ readonly subject: string, readonly revision: number } | null>(null)
	const replacedNoticeVisible = computed(() => replacedNotice.value !== null && replacedNotice.value.revision === documentState.value.revision)
	const lastAppliedSourcePatch = computed(() => {
		void sessionTick.value
		return session.lastAppliedSourcePatch
	})
	const documentTrace = computed(() => {
		void sessionTick.value
		return session.documentTrace
	})

	const activeTab = shallowRef<LabToolTab>('edit')
	const toolGroupTab = shallowRef<LabToolTab | null>(null)
	const toolOpenRequest = shallowRef<ToolOpenRequest | null>(null)
	const openTools = shallowRef<ReadonlySet<ToolId>>(new Set())
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
		// Pending JSON text belongs to the old session (the switch asked first if it was an edit); no burst carries over, and
		// "Preview restarted" of the old session does not carry over either.
		cancelJsonCommit()
		jsonEditKey = null
		clearPreviewRestarted()

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
		replacedNotice.value = null
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
		jsonBlock,
		documentSnapshot,
		documentState,
		preview,
		documentFocus,
		documentFocusChosen,
		previewFocus,
		revisionStatus,
		lastAppliedSourcePatch,
		documentTrace,
		isApplying,
		isDirty,
		jsonBlocked,
		canUndo,
		undoDepth,
		previewRestarted,
		status,
		problems,
		loadedPresetId,
		example,
		hasCommittedEdits: hasCommittedEditsRef,
		replacedNotice,
		replacedNoticeVisible,
		dismissReplacedNotice: () => {
			replacedNotice.value = null
		},
		authorView,
		problemsFocusPending,
		focus,
		showcases: listedShowcases,
		showcaseId,
		presets,
		activeTab,
		toolGroupTab,
		toolOpenRequest,
		openTool: (tool) => {
			toolOpenRequest.value = { tool, tick: (toolOpenRequest.value?.tick ?? 0) + 1 }
		},
		openTools,
		graphShowAbsent,
		graphShowIsolatedMembers,
		graphExpandedClusterIds,
		expandGraphCluster,
		collapseGraphCluster,
		toggleGraphCluster,
		collapseAllGraphClusters,
		editJson: (text) => {
			session.setDraftSourceText(text)
			scheduleJsonCommit()
		},
		// A focus that comes back to an editing session that never ended (the editor stayed focused while the window or tab was
		// away: `use-monaco-editor.ts` ignores that blur) continues the session, so alt-tab keeps one Undo entry.
		beginJsonEdit: () => {
			jsonEditKey ??= ++jsonEditCount
			jsonEditorFocused.value = true
		},
		endJsonEdit: () => {
			// `flushJson()` reads the burst's key synchronously, so the blur commit still belongs to the burst it ends.
			const outcome = flushJson()
			jsonEditKey = null
			jsonEditorFocused.value = false
			return outcome
		},
		jsonEditorFocused,
		flushJson,
		discardJsonChanges: () => {
			cancelJsonCommit()
			session.revert()
		},
		// Every command goes through `runCommand()`: it starts synchronously at call time when nothing runs (so its capture and
		// the session's own concurrency guard fire in this turn, as the Apply lifecycle of diagnostic #13 comment 5289958311
		// requires), waits for a running command otherwise, and is refused while a showcase switch occupies the lifecycle
		// boundary (PR #19 review 4940839975). `enqueue()` stays the mutual-exclusion barrier against a concurrent switch.
		// A command builder runs when the command starts, so a command that waited (behind a blur commit, an Undo) is built against
		// the revision current then, not the one it was asked against (that would be `stale-selection`).
		author: command => runCommand(async () => {
			const built = typeof command === 'function' ? command() : command
			return built === null ? { status: 'unsupported', reason: 'stale-selection' } : session.author(built)
		}, { status: 'skipped-concurrent' }),
		format: () => {
			cancelJsonCommit()
			session.format()
			// A formatted text is its own change, never part of a typing burst (the button took focus out of the editor).
			return flushJsonIn(null)
		},
		retryPreview: () => enqueue(() => session.retryPreview()),
		undo: () => {
			// A request while an Undo is already on its way (a double-click, or Undo pressed again before the Preview caught up) is
			// that same Undo: one step. Once it has finished, the next request undoes the next step.
			if (undoInFlight !== null)
				return undoInFlight
			cancelJsonCommit()
			// Undo would replace the text, and text that cannot be applied was never committed: nothing could bring it back.
			if (session.jsonBlock !== null)
				return Promise.resolve({ status: 'draft-dirty' })
			const key = jsonEditKey
			const outcome = runCommand(async () => {
				// Pending text is committed first, within its burst, so this Undo takes the whole burst back.
				if (hasPendingJson())
					await session.commitJson({ coalesceKey: key })
				return session.undo()
			}, { status: 'skipped-concurrent' })
			const settled = outcome.finally(() => {
				if (undoInFlight === settled)
					undoInFlight = null
			})
			undoInFlight = settled
			return settled
		},
		// Stays in the open Edit view (Lab UX phase 2): Structure shows the problems at their fields and JSON in its list. The view
		// that is mounted consumes `problemsFocusPending`.
		showProblems: () => {
			activeTab.value = 'edit'
			problemsFocusPending.value = true
		},
		applyPreset: (presetId) => {
			// Same symmetric guard as the other commands, checked first so a concurrent switch also short-circuits the
			// (otherwise pure) preset lookup rather than resolving it against a showcase that might be mid-replacement.
			if (switchTransactionCount > 0)
				return Promise.resolve({ status: 'skipped-concurrent' })
			const preset = currentShowcase.presets.find(candidate => candidate.id === presetId)
			if (preset === undefined)
				return enqueue(async () => undefined)
			cancelJsonCommit()
			const targetSession = session
			// Read before the load: whether this preset replaces edits (pending JSON text included) that only Undo can bring back now.
			const replacesEdits = hasCommittedEdits(effectiveSourceText(), currentShowcase.presets)
			const key = jsonEditKey
			return runCommand(async () => {
				// Pending text that parses is committed first, so Undo after the load brings it back.
				if (hasPendingJson())
					await session.commitJson({ coalesceKey: key })
				const revisionBefore = session.documentState.revision
				// `session.applyPreset()` synchronously sets the text and starts the commit (capture + concurrency guard).
				const result = await session.applyPreset(preset.sourceText)
				// A switch queued behind this preset replaces the session only after it settled, so the check
				// is a guard rather than an expected case: never name a preset in a showcase it does not belong to.
				if (result.status === 'applied' && session === targetSession) {
					loadedPresetId.value = presetId
					const revision = session.documentState.revision
					if (replacesEdits && revision !== revisionBefore)
						replacedNotice.value = { subject: preset.label, revision }
				}
				return result
			}, { status: 'skipped-concurrent' })
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
			cancelJsonCommit()
			if (previewRestartedTimer !== null)
				clearTimeout(previewRestartedTimer)
			stopPreviewRestarted()
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
