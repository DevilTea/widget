/**
 * RuntimeProperty primitive.
 *
 * Lazy/cached `alien-signals` computed whose reactive value is the fresh completed
 * `ExecutionResult` snapshot (not the raw value alone), so every actual recompute has fresh identity
 * and notifies subscribers exactly once even when the raw value compares equal. Diagnostics live on a
 * separate signal written as a side effect of evaluation; `subscribeDiagnostics`/`getDiagnostics` only ever
 * touch that signal, never the computed, so they never activate evaluation. That in-evaluator write is
 * committed through `writeDeferringFlush`, so watching the diagnostics channel can never perturb value
 * propagation (see the `alien-signals@3.2.1` mechanism documented on that helper).
 *
 * A `compute` that throws never throws out of the alien computed: the exception is cached as the
 * computed's outcome (see {@link ComputeException}) and rethrown by every tracked/direct read. An
 * exception escaping a computed would otherwise escape alien-signals' flush from whichever effect's
 * dirty check re-evaluated it, through an unrelated writer, and drop the rest of that flush's queue. An
 * engine stack overflow is the one outcome a later read does not reuse: it reflects the stack depth of the
 * read that produced it, not the compute's inputs.
 *
 * Reading a Property is not bounded by the engine stack, cold or warm. Evaluations nest one per link of a
 * dependency chain: on a first read every `compute` reads its dependency, whose `compute` reads the next; on a
 * re-read after a write, alien-signals' dirty check stops at the first changed dependency of each link, so when
 * every link of a chain reads something changed before its next link (its own State, say), each re-evaluation
 * reads the next stale link and nests as well. Core therefore bounds the nesting of every evaluation with an
 * internal limit: an evaluation that would nest deeper abandons the evaluations in progress, and the boundary
 * read that started them completes them, deepest first, in a loop (see {@link driveAbandonedRead}). An
 * abandoned evaluation caches nothing that is kept, commits no diagnostics and publishes no inspection
 * completion, so the outcome is that of an evaluation that had enough stack. Accepted in DevilTea/widget
 * Discussion #12 (https://github.com/DevilTea/widget/discussions/12#discussioncomment-19593596).
 *
 * An abandoned computed stays dirty and keeps every dependency link it had, also those its abandoned run did
 * not read again (see `keepAbandoned`): nothing below it is torn down, and every later read of it, also
 * alien-signals' own dirty check, evaluates it again. Its abandoned outcome is a fresh object each time, so
 * alien-signals treats every abandoned evaluation as a change and goes on updating its readers, which are
 * abandoned in turn, instead of concluding that a reader is unchanged and keeping a stale value. Nothing is
 * written to make an abandoned computed evaluate again, so no subscriber is notified because of it. Every
 * abandoned computed of a read is evaluated again before the read returns (each one's reader reads it again),
 * so completing a read leaves nothing to evaluate again or to notify without a State write.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 consolidated handoff §14, amendment "Implementation verification —
 * alien-signals@3.2.1 conformance" (#4).
 */

import type { RelativeValueDiagnosticInput, RuntimePropertyDiagnostic } from '../diagnostic'
import type { ExecutionResult } from '../execution-result'
import type { CompiledDependencyTree, CompiledWidgetNode, RuntimeProperty } from '../internal/contract'
import type { ErasedWidgetPropertyDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { ActiveDiagnosticSink, CallbackOwner, RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'
import { computed, getActiveSub, setActiveSub, signal } from 'alien-signals'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { createTrackedSubscription, invokeListenerIsolated, isEngineStackOverflow, runRuntimeOperation, writeDeferringFlush } from './adapter'
import { createOperationCollector } from './collector'
import { callbackScope } from './context'
import { materializeDependencyTree } from './deps'
import { buildPropertyResultDiagnostic, toDiagnosticSnapshot } from './diagnostics'
import { assertSyncValue } from './sync'

/**
 * Readonly-inspection `RuntimePropertyInspectionSnapshot`-shaped envelope, kept structural here (no
 * import from the `inspection` subpath — this internal module must stay usable independent of it).
 */
export type PropertyInspectionSnapshot
	= | { readonly status: 'never-evaluated' }
		| { readonly status: 'completed', readonly result: ExecutionResult<unknown, RuntimePropertyDiagnostic> }

/** The frozen singleton every Property inspection channel starts at and returns to before first evaluation. */
const NEVER_EVALUATED_SNAPSHOT: PropertyInspectionSnapshot = Object.freeze({ status: 'never-evaluated' })

const computeExceptionKey: unique symbol = Symbol('@deviltea/widget-core:compute-exception')

/**
 * The cached outcome of an evaluation whose `compute` (or its sync-boundary check) threw. Like a completed
 * result it stays cached until a dependency changes, so every read in between rethrows the same exception
 * instead of re-running `compute` — except an engine stack overflow, which the next read evaluates again
 * (see `getResultWithInspectionPublish`). A plain symbol-keyed record, never confused with an
 * `ExecutionResult`.
 */
interface ComputeException {
	readonly [computeExceptionKey]: unknown
}

type PropertyOutcome = ExecutionResult<unknown, RuntimePropertyDiagnostic> | ComputeException

/** The alien-signals subscriber active when a boundary read starts, if any. */
type ActiveSubscriber = ReturnType<typeof getActiveSub>

/*
 * ALIEN-SIGNALS COUPLING. Beyond the public API (`computed`, `signal`, `getActiveSub`, `setActiveSub`), this
 * module relies on these alien-signals@3.2.1 internals, each pinned by `alien-signals-coupling.unit.test.ts`:
 *
 * 1. A computed's getter is called as a method of the computed's node (`c.getter(oldValue)`): `this` in
 *    `evaluate` is the node (see `currentNode`).
 * 2. The node's dependency list: `deps` (first link), `depsTail` and each link's `nextDep`. An evaluation starts
 *    with `depsTail` reset, each read moves it to the link read, and when the getter returns alien-signals
 *    unlinks every link after `depsTail` (`purgeDeps`). Setting `depsTail` to the last link from inside the
 *    getter keeps every link (`keepAbandoned`); setting it back to `undefined` drops them all (a replaced
 *    computed, see `evaluate`).
 * 3. `flags`, with `Dirty` = 16: a computed whose getter leaves `Dirty` set stays dirty when the getter returns
 *    (alien-signals then only clears its running flag), so its next read, also from alien-signals' dirty
 *    check, evaluates it again (`keepAbandoned`, `abandonedWithoutReevaluation`).
 * 4. Tearing a computed down (its last subscriber unlinked) empties its `deps` (`hasCompletedLinks`), and an
 *    engine stack overflow when alien-signals calls the getter leaves it marked clean with its previous outcome
 *    (`isUnreachable`, `abandonedWithoutReevaluation`).
 * 5. Reading a computed with no active subscriber links nothing, and a computed's reader is linked only when the
 *    read returns (`readFromProperty`, `readAtBoundary`).
 */

/** One link of an alien-signals@3.2.1 node's dependency list (see ALIEN-SIGNALS COUPLING). */
interface AlienLink {
	readonly nextDep: AlienLink | undefined
}

/** The fields of an alien-signals@3.2.1 computed node this module reads or writes (see ALIEN-SIGNALS COUPLING). */
interface AlienComputedNode {
	readonly deps: AlienLink | undefined
	depsTail: AlienLink | undefined
	flags: number
}

/** alien-signals@3.2.1 `ReactiveFlags.Dirty`. */
const ALIEN_DIRTY = 16

/**
 * Makes the evaluation running for `node`, which is abandoned, leave the computed dirty, so that its next read
 * evaluates it again, and keep every dependency link it had, also those it has not read again (alien-signals
 * would drop them when the getter returns), so that nothing it depends on is torn down. See ALIEN-SIGNALS
 * COUPLING 2 and 3.
 */
function keepAbandoned(node: AlienComputedNode): void {
	node.flags |= ALIEN_DIRTY
	let last = node.depsTail ?? node.deps
	if (last === undefined)
		return
	while (last.nextDep !== undefined)
		last = last.nextDep
	node.depsTail = last
}

/**
 * How many Property evaluations may nest on one stack segment (see {@link segment}) before the evaluation
 * that would nest deeper is abandoned and completed later from a shallower stack. Internal: not API, not
 * configurable, and it may change.
 *
 * The figure that bounds it is the smallest stack Core has to run on. Older QuickJS builds default to a
 * smaller stack than quickjs-ng's 1 MiB, so it is 256 KB: there quickjs-ng 0.18.0 reads the head of a chain
 * of trivial `compute`s cold, without this limit, only up to 31 nested evaluations (63 at 512 KB, 128 at
 * 1 MiB: about 8 KB of stack per evaluation). Core's read path nests a little more stack per evaluation than
 * that measurement's: in V8 without its JIT (an interpreter like QuickJS) a chain read cold without the limit
 * reached 942 evaluations against 1 072, so about 27 at 256 KB. 12 leaves more than twice that margin, for
 * real `compute` bodies (refinements, diagnostics, helper calls), the host's own stack below the read,
 * listener and flush frames, and further segments a read can open on top of this one (a Method a `compute`
 * depends on reads its own Properties on a new segment), even if QuickJS's frames turn out an eighth larger
 * than that estimate.
 *
 * A smaller limit only adds driver rounds, hardly `compute` calls: a chain whose every link is evaluated
 * (read cold, or re-read with every link stale) costs about two `compute` calls per Property whatever the
 * limit, since each link nested beyond it runs `compute` once until it is abandoned and once to completion.
 * Measured on the differential test's graphs that the unmodified Core can read (cold reads, and State writes
 * under subscriptions) against the unmodified Core's 446 and 447 calls: 8 cost 606 and 461, 12 cost 542 and
 * 447, 15 and 16 cost 491 to 494 and 447, 32 cost 446 and 447; on a Property reading 250 or 1 000 chains of
 * 40 links, a cold read costs 2.0x (8), 1.9x (12), 1.75x (15) and 1.8x (16 and 32) the unmodified Core's
 * calls, writes the same at every limit. A 300-link chain whose every link reads its own State, or one shared
 * State, first, re-read with every link stale, costs 1.96x the unmodified Core's calls at 12; a write that
 * leaves one link stale at a time (re-evaluated without nesting) costs the same.
 */
const EVALUATION_NESTING_LIMIT = 12

/**
 * Thrown by a Property's dependency read through `compute` to abandon the evaluation in progress (see
 * {@link evaluate}). Internal: plugin code must not rely on it. A `compute` that catches it has its return
 * value discarded anyway; one that keeps it and throws it in a later evaluation throws an ordinary compute
 * exception, cached and rethrown by `get()` like any other. An `Error` only so that code which logs what it
 * caught says what it is.
 */
const ABANDONMENT: Error = Object.freeze(new Error('widget-core: internal — this Property evaluation was abandoned to be completed from a shallower stack; do not catch it.'))

/** Marks an abandoned outcome (see {@link abandonedOutcome}). */
const abandonedKey: unique symbol = Symbol('@deviltea/widget-core:abandoned')

/**
 * The cached outcome of an abandoned evaluation: like an engine stack overflow it is an outcome that is not
 * kept. The computed that caches it stays dirty (see `keepAbandoned`), so its next read evaluates it again.
 */
interface AbandonedOutcome extends ComputeException {
	readonly [abandonedKey]: true
}

/**
 * A fresh abandoned outcome. Never the same object twice: alien-signals sees every abandoned evaluation as a
 * change, so its dirty check goes on updating the readers of an abandoned Property (each is abandoned in turn)
 * instead of concluding they are unchanged and keeping a stale value (see {@link evaluate}).
 */
function abandonedOutcome(): AbandonedOutcome {
	return { [computeExceptionKey]: ABANDONMENT, [abandonedKey]: true }
}

/** Whether `outcome` is an abandoned outcome (an ABANDONMENT thrown by plugin code later is an ordinary exception). */
function isAbandoned(outcome: PropertyOutcome | undefined): outcome is AbandonedOutcome {
	return outcome !== undefined && abandonedKey in outcome
}

/**
 * The per-Property surface the driver loop ({@link driveAbandonedRead}) works with. One object per Property,
 * created with the primitive.
 */
interface EvaluationNode {
	/**
	 * Reads the result computed once, tracked by the active subscriber, evaluating again a cached outcome
	 * that is not kept (an abandonment or an engine stack overflow this call did not produce). Never throws a
	 * compute exception: it is returned as the outcome.
	 */
	readonly attempt: () => PropertyOutcome
	readonly context: RuntimeContext
	/** The drive (see {@link drives}) that last completed this Property as an abandonment target. */
	completedBy: number
	/** The drive whose pending stack holds this Property, or `0`. */
	pendingIn: number
}

/**
 * Evaluation-nesting bookkeeping of the current stack segment. A segment is the stretch of the stack between
 * one boundary read and the next: every read of a Property other than a Property's own dependency read (the
 * public `get()`, a subscription effect, a Method's dependency read, ...) is a boundary, which saves these
 * three fields, starts the segment from zero and restores them when it returns. The abandonment therefore
 * only ever travels through Property `compute` frames: it never reaches a Method's failure handling,
 * listener isolation, the isolated-exception reporting or the host.
 *
 * A mutable holder updated with plain assignments, like `callbackScope`, so the bookkeeping survives an
 * exhausted stack, and realm-wide, since segments follow the stack, not a Runtime. Its fields are read on
 * every warm read, which costs less than reading module `let` bindings from inside closures.
 */
const segment: {
	/** How many Property evaluations are in progress on the segment. */
	nesting: number
	/**
	 * While the segment unwinds abandoned evaluations: the Property whose evaluation would have exceeded the
	 * limit, i.e. the one to complete first. Every evaluation that finishes while it is set is abandoned, and
	 * the outermost evaluation of the segment clears it when it finishes.
	 */
	abandonedAt: EvaluationNode | null
	/**
	 * Where the outermost evaluation of the segment hands `abandonedAt` over when it finishes, for the
	 * segment's driver loop; `null` until an abandonment reaches the root of the segment. An abandonment
	 * alien-signals produced during a flush with no driver above it (an effect's dirty check) leaves its
	 * target here until the next boundary read entered with no evaluation in progress, which resets it rather
	 * than restoring it, so a Property is never retained past it.
	 */
	recordedTarget: EvaluationNode | null
} = { nesting: 0, abandonedAt: null, recordedTarget: null }

/** Numbers the driver loops, for their no-progress guard. */
let drives = 0

/**
 * How many times one drive may find a Property it already completed abandoned again. Without a write
 * during the drive this never happens (completed outcomes stay cached and the dependency graph is acyclic);
 * a listener that keeps invalidating what the drive completes would otherwise make it spin.
 */
const MAX_DRIVE_STALLS = 256

/**
 * Completes a boundary read whose attempt was abandoned: a loop over an explicit stack of Properties, which
 * evaluates the recorded target first (itself possibly abandoned further down, which pushes the next
 * target) and then attempts the waiting Property again, until the read's own Property completes. Runs
 * inside the boundary's Runtime operation, so the diagnostic propagations deferred by every attempt are
 * released once, after the read's own result has been committed, as for any other outermost read.
 *
 * Every attempt runs with no active subscriber (the boundary read cleared it, see
 * `getResultWithInspectionPublish`). A completed target publishes no inspection completion here: its reader,
 * attempted again, reads it as any reader does, and publishes it then, exactly when a read without the limit
 * would have. A target whose evaluation ends in an engine stack overflow (the host called from an already
 * deep stack) ends the read with that overflow, as an overflowing read always did: the overflow is not
 * cached for good (see `getResultWithInspectionPublish`), and the waiting Properties stay abandoned, so a
 * later read evaluates them again. Disposal during the loop ends it with the post-dispose error: a `compute`
 * that catches what its dependency reads throw after the disposal could otherwise complete the read with
 * values computed from a disposed Runtime.
 */
function driveAbandonedRead(root: EvaluationNode): PropertyOutcome {
	const drive = ++drives
	const pending: EvaluationNode[] = []
	let current = root
	let outcome: PropertyOutcome = abandonedOutcome()
	let stalls = 0
	for (;;) {
		if (isAbandoned(outcome)) {
			const target = segment.recordedTarget
			// An attempt starts at nesting zero, so its abandonment always started below it and reached it.
			if (target === null || target === current || target.pendingIn === drive)
				throw new Error('widget-core: internal error — an abandoned Property evaluation did not record a deeper evaluation to complete first.')
			if (target.completedBy === drive && ++stalls > MAX_DRIVE_STALLS)
				throw new Error('widget-core: internal error — completing an abandoned Property evaluation made no progress.')
			current.pendingIn = drive
			pending.push(current)
			current = target
		}
		else {
			// An engine stack overflow ends the read: the host called from a stack too deep for even a bounded
			// segment, and attempting the waiting Properties again would only overflow again.
			if (current === root || (computeExceptionKey in outcome && isEngineStackOverflow(outcome[computeExceptionKey])))
				return outcome
			current.completedBy = drive
			current = pending.pop()!
			current.pendingIn = 0
		}
		root.context.assertActive()
		segment.nesting = 0
		segment.abandonedAt = null
		segment.recordedTarget = null
		outcome = current.attempt()
	}
}

/**
 * One retained-fact channel for the readonly `@deviltea/widget-core/inspection` subpath. Published only
 * after `resultComputed()` has returned — see `getResultWithInspectionPublish` below for why publishing
 * from inside the computed getter body is wrong — and never by wrapping `getResult()` in a second
 * alien-signals effect.
 */
export interface PropertyInspectionChannel {
	getSnapshot: () => PropertyInspectionSnapshot
	subscribe: (listener: (snapshot: PropertyInspectionSnapshot) => void) => () => void
}

export interface PropertyPrimitiveInternal {
	/**
	 * Tracked, lazy/cached read of the completed `ExecutionResult` snapshot, for every reader that is not a
	 * Property's own dependency read (a boundary, see {@link segment}): never bounded by the engine stack.
	 */
	getResult: () => ExecutionResult<unknown, RuntimePropertyDiagnostic>
	/**
	 * The same read for a Property's own dependency callable, from inside that Property's `compute`: nested in
	 * the reader's evaluation, it throws the internal abandonment through `compute` when the evaluation it
	 * reaches is abandoned (see {@link evaluate}).
	 */
	readFromProperty: () => ExecutionResult<unknown, RuntimePropertyDiagnostic>
	/** Tracked raw diagnostic-snapshot read. Reading this never activates the computed. */
	getDiagnostics: () => readonly RuntimePropertyDiagnostic[]
	/** Readonly-inspection retained-fact channel. See {@link PropertyInspectionChannel}. */
	readonly inspection: PropertyInspectionChannel
}

export interface PropertyPrimitive {
	readonly internal: PropertyPrimitiveInternal
	readonly public: RuntimeProperty<unknown>
}

export interface CreatePropertyPrimitiveParams {
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly definition: ErasedWidgetPropertyDefinition
	readonly buildConfigFragment: () => Record<string, unknown>
	readonly selfNode: unknown
	readonly blueprintView: unknown
	/** The compiled dependency tree; its callables are materialized on the first evaluation. */
	readonly depsTree: CompiledDependencyTree
	readonly registry: ReadonlyMap<number, PrimitiveRegistryEntry>
	readonly nodes: readonly CompiledWidgetNode[]
	/** The owner the dependency callables are materialized for. */
	readonly owner: CallbackOwner
	/** Called with every committed diagnostic-snapshot change (the Runtime aggregate's commit hook). */
	readonly onDiagnosticsCommitted: () => void
}

export function createPropertyPrimitive(context: RuntimeContext, params: CreatePropertyPrimitiveParams): PropertyPrimitive {
	const { owner } = params
	const diagnosticsSignal = signal<readonly RuntimePropertyDiagnostic[]>(EMPTY_DIAGNOSTICS)

	// Untracked mirror of `diagnosticsSignal`'s value: an unchanged snapshot skips the write.
	let committedDiagnostics: readonly RuntimePropertyDiagnostic[] = EMPTY_DIAGNOSTICS
	// Built on demand from `lastPublishedResult` while no inspection listener is attached; the same object
	// is returned until the next completed evaluation.
	let inspectionSnapshot: PropertyInspectionSnapshot | null = NEVER_EVALUATED_SNAPSHOT
	// Plain lazy-allocated registration list (not a `Set` keyed by the listener function itself — two
	// independent `subscribe(sameFn)` calls must stay two independent registrations, exactly like the
	// alien-signals-effect-backed `createTrackedSubscription` never dedupes by listener identity either).
	interface ListenerEntry { readonly listener: (snapshot: PropertyInspectionSnapshot) => void }
	let inspectionListeners: ListenerEntry[] | null = null
	let lastPublishedResult: ExecutionResult<unknown, RuntimePropertyDiagnostic> | null = null

	function readInspectionSnapshot(): PropertyInspectionSnapshot {
		return inspectionSnapshot ??= Object.freeze({ status: 'completed', result: lastPublishedResult! })
	}

	function publishInspectionCompletion(): void {
		inspectionSnapshot = null
		if (inspectionListeners === null || inspectionListeners.length === 0)
			return
		const snapshot = readInspectionSnapshot()
		// Iterate a stable snapshot taken at publication start: a listener that itself calls `subscribe()`
		// during this loop must not have its new registration visited by *this* publication (future-changes
		// -only / no-immediate-emission), which a live-array/live-Set iteration could otherwise do.
		const listenersSnapshot = inspectionListeners.slice()
		for (const entry of listenersSnapshot)
			invokeListenerIsolated(entry.listener, snapshot)
	}

	// Recovery bookkeeping for the outcomes that are not kept (see `getResultWithInspectionPublish`): how many
	// evaluations have started, and the per-Property signal a read writes to make the computed evaluate again.
	// The signal is created by the first evaluation, so a Property that is never read costs nothing.
	let evaluations = 0
	// The materialized `deps` of `compute`'s context: built by the first evaluation, the same object ever after.
	let deps: unknown
	let retries = 0
	let retrySignal: { (): number, (value: number): void } | null = null

	// The current result computed is replaced (see `replaceComputed`) when it has no outcome, or when its cached
	// outcome is abandoned while an earlier evaluation of it is still in progress further up the stack. Only the
	// current one evaluates. `currentNode` is its alien-signals node: alien-signals calls a computed's getter
	// as a method of the node (`c.getter(...)` in alien-signals@3.2.1), and a replacement is always read at
	// once, so the first evaluation after a replacement records it.
	let currentNode: object | null = null
	// Whether the current computed's cached outcome is the abandoned one, i.e. what its last evaluation returned.
	let cachedAbandoned = false
	// How many evaluations of the current computed are in progress on the stack.
	let inProgress = 0
	// Whether the current computed's dependency links, if it has any, are those of an evaluation that produced
	// an outcome other than the abandoned one. Reset by an evaluation that starts with no links (a first one, or
	// one after alien-signals tore the computed down): the links an abandoned evaluation leaves behind do not
	// count. See `hasCompletedLinks`.
	let linksCompleted = false

	/**
	 * Whether the computed whose alien-signals node is `target` has dependency links left by an evaluation that
	 * completed: it is neither new nor torn down (ALIEN-SIGNALS COUPLING 4). A reader links such a computed at
	 * once; any other one it reads without linking until it has completed (see `readFromProperty`).
	 */
	function hasCompletedLinks(target: object | null): boolean {
		return linksCompleted && (target as AlienComputedNode).deps !== undefined
	}

	// This Property as the driver loop sees it (see `driveAbandonedRead`).
	const node: EvaluationNode = {
		attempt,
		context,
		completedBy: 0,
		pendingIn: 0,
	}

	/**
	 * The computed's getter. Besides a completed result or a cached compute exception, an evaluation can yield
	 * an abandoned outcome (see {@link abandonedOutcome}), which is never kept; it then leaves the computed dirty
	 * with every dependency link it had (see `keepAbandoned`):
	 *
	 * - one that would start with {@link EVALUATION_NESTING_LIMIT} evaluations already in progress on the
	 *   segment does not run `compute`: it records itself as where the unwinding started ({@link segment}) and
	 *   yields it. The dependency read in the enclosing `compute` then throws the internal
	 *   {@link ABANDONMENT} (see `readFromProperty`), so the enclosing evaluation finishes too;
	 * - one that finishes while the segment unwinds yields it whatever its `compute` did (returned a fallback
	 *   after catching the abandonment, or threw anything else), and commits no diagnostics;
	 * - one that would start while the segment unwinds yields it without running `compute`.
	 *
	 * The getter itself never throws, also not the abandonment: it returns the abandoned outcome instead. The
	 * outermost evaluation of the segment ends the unwinding and hands the target to the segment's driver.
	 *
	 * `this` is the alien-signals node of the computed this evaluation runs for (see `currentNode`). A computed
	 * replaced while it ran drops every dependency link when it finishes, so nothing evaluates it again, and one
	 * alien-signals would still evaluate reads nothing and yields an abandoned outcome without running `compute`.
	 * A plain function rather than a closure per computed: no extra call frame per nesting level.
	 */
	function evaluate(this: object): PropertyOutcome {
		if (currentNode !== this && !claimCurrentNode(this))
			return abandonedOutcome()
		++evaluations
		// Decided before anything is read: only the links of the previous evaluation count.
		if (!hasCompletedLinks(this))
			linksCompleted = false
		// Tracked first, before anything that could throw, so every evaluation that produced an outcome depends
		// on it. Outside the `try`: an evaluation that cannot even read it never produces an outcome (see
		// `getResultWithInspectionPublish` for how that case is recovered).
		;(retrySignal ??= signal(0))()

		if (segment.abandonedAt !== null)
			return abandonAtStart(this)
		if (segment.nesting >= EVALUATION_NESTING_LIMIT) {
			segment.abandonedAt = node
			return abandonAtStart(this)
		}
		++segment.nesting
		++inProgress
		let abandoned = false

		// Everything below is caught: this getter can run inside any effect's dirty check during a flush, and
		// an exception escaping it would escape that flush (see the module doc).
		try {
			deps ??= materializeDependencyTree(params.depsTree, {
				consumer: 'property',
				ownerWidgetId: params.widgetId,
				ownerName: params.name,
				registry: params.registry,
				nodes: params.nodes,
				context,
				owner,
			})
			const collector = createOperationCollector<RelativeValueDiagnosticInput, RuntimePropertyDiagnostic>()
			const sink: ActiveDiagnosticSink = {
				addFinalizedDiagnostic: (diagnostic, dedupe) => collector.addFinalizedDiagnostic(diagnostic as RuntimePropertyDiagnostic, dedupe),
			}

			const ctx = {
				widget: params.selfNode,
				blueprint: params.blueprintView,
				deps,
				...params.buildConfigFragment(),
				addDiagnostic: collector.addDiagnostic,
				hasAnyDiagnostic: collector.hasAnyDiagnostic,
			}

			// This Property becomes the innermost running callback for the duration of `compute` (see
			// `callbackScope`): only its own dependency callables are usable, and they report into `sink`.
			// Saved and restored with plain assignments, so the restore survives an exhausted stack.
			const previousOwner = callbackScope.owner
			const previousSink = owner.sink
			callbackScope.owner = owner
			owner.sink = sink
			let value: unknown
			try {
				value = params.definition.compute(ctx)
			}
			finally {
				callbackScope.owner = previousOwner
				owner.sink = previousSink
				collector.close()
			}
			if (segment.abandonedAt !== null) {
				abandoned = true
				return abandonedOutcome()
			}
			assertSyncValue(value, 'Property', params.name, 'compute')

			const diagnostics = collector.finalize(input => buildPropertyResultDiagnostic(params.widgetId, params.name, value, input))
			// Commit the snapshot here — the fact-commit point every consumer's `getDiagnostics()` must already
			// reflect — but hold its *propagation* inside an alien batch until this evaluation (and whatever
			// drove it) is done. A watched signal write from inside a computed's own evaluator starts a nested
			// alien-signals flush while this computed is mid-`updateComputed`, which permanently marks the
			// Property's other dependents clean-but-stale; `writeDeferringFlush` documents the exact
			// alien-signals@3.2.1 mechanism.
			const snapshot = toDiagnosticSnapshot(diagnostics)
			if (snapshot !== committedDiagnostics) {
				committedDiagnostics = snapshot
				writeDeferringFlush(() => {
					diagnosticsSignal(snapshot)
					params.onDiagnosticsCommitted()
				})
			}

			// The alien computed caches this exact object as its reactive value and reuses it for every
			// `.get()`/dependency read until the next actual recompute; shallow-freeze the wrapper so external
			// code cannot rewrite `.value`/`.ok` in place with no invalidation. `diagnostics` is already
			// deep-frozen (via `finalize()`); `value` is the plugin's own payload and is deliberately left
			// untouched.
			const result: ExecutionResult<unknown, RuntimePropertyDiagnostic> = diagnostics.length > 0
				? { ok: false, failure: { diagnostics: diagnostics as readonly [RuntimePropertyDiagnostic, ...RuntimePropertyDiagnostic[]] } }
				: { ok: true, value }
			return Object.freeze(result)
		}
		catch (error) {
			if (segment.abandonedAt !== null) {
				abandoned = true
				// `abandonedOutcome()`, inline: a call could exhaust the stack here.
				return { [computeExceptionKey]: ABANDONMENT, [abandonedKey]: true } as AbandonedOutcome
			}
			// The in-progress collector is discarded and the previous diagnostic snapshot kept, exactly as when
			// the exception used to propagate out of the computed.
			return { [computeExceptionKey]: error }
		}
		finally {
			// The outermost evaluation of the segment ends the unwinding, so evaluations that start later on this
			// segment (the next effect of a flush, say) are not abandoned, and hands the target to the segment's
			// driver. Plain expressions, so they still run when the stack is exhausted.
			if (--segment.nesting === 0 && segment.abandonedAt !== null) {
				segment.recordedTarget = segment.abandonedAt
				segment.abandonedAt = null
			}
			if (this !== currentNode) {
				// Replaced while it ran (see `replaceComputed`): alien-signals drops every link when the getter
				// returns, so this computed no longer keeps its dependencies alive (nothing reads it again).
				(this as AlienComputedNode).depsTail = undefined
			}
			else if (abandoned) {
				// Stays dirty and keeps every dependency link, also those this evaluation did not get to read again
				// (see `keepAbandoned`); inline, since a call could exhaust the stack here.
				const links = this as AlienComputedNode
				links.flags |= ALIEN_DIRTY
				let last = links.depsTail ?? links.deps
				if (last !== undefined) {
					while (last.nextDep !== undefined)
						last = last.nextDep
					links.depsTail = last
				}
			}
			// Only the current computed's bookkeeping: this one may have been replaced while it ran.
			if (this === currentNode) {
				--inProgress
				cachedAbandoned = abandoned
				if (!abandoned)
					linksCompleted = true
			}
		}
	}

	/**
	 * An evaluation abandoned before running `compute` (see {@link evaluate}): leaves the computed dirty with its
	 * links (see `keepAbandoned`) and yields an abandoned outcome.
	 */
	function abandonAtStart(target: object): PropertyOutcome {
		cachedAbandoned = true
		keepAbandoned(target as AlienComputedNode)
		return abandonedOutcome()
	}

	/**
	 * Records `candidate` as the current computed's node if none is recorded yet (the first evaluation after a
	 * replacement); returns whether it is now the current one.
	 */
	function claimCurrentNode(candidate: object): boolean {
		if (currentNode !== null)
			return false
		currentNode = candidate
		return true
	}

	let resultComputed = computed<PropertyOutcome>(evaluate as () => PropertyOutcome)

	/**
	 * Replaces the result computed by a fresh one that has not evaluated yet. Used for a computed that has no
	 * outcome at all (see `getResultWithInspectionPublish`), and for one whose cached outcome is abandoned while
	 * an evaluation of it is still in progress further up the stack: something run during that evaluation (a
	 * listener) reads this Property again. Making that computed evaluate again would re-enter an evaluation
	 * alien-signals has not finished; the fresh one evaluates on its own instead, exactly as a re-entrant read
	 * of a Property whose first evaluation is in progress always did. The replaced computed finishes its
	 * evaluation in progress for its own readers and never evaluates again (see {@link evaluate}).
	 */
	function replaceComputed(): void {
		inProgress = 0
		cachedAbandoned = false
		linksCompleted = false
		currentNode = null
		resultComputed = computed<PropertyOutcome>(evaluate as () => PropertyOutcome)
	}

	/**
	 * Makes the computed evaluate again although no dependency changed, for a cached engine stack overflow: it
	 * depends on how deep the stack was when the evaluation ran, not on the compute's inputs. The write marks
	 * this Property (and through it its dependents) stale; its propagation is held until the enclosing Runtime
	 * operation leaves, like any write made while an evaluation may run. A computed no write reaches any more
	 * is replaced instead (see {@link isUnreachable}).
	 */
	function reevaluate(): PropertyOutcome {
		if (isUnreachable()) {
			replaceComputed()
		}
		else {
			const signal = retrySignal!
			writeDeferringFlush(() => signal(++retries))
		}
		return resultComputed()
	}

	/**
	 * Whether the current computed has no dependency link, so that the write that makes a computed evaluate
	 * again would not reach it: an engine stack overflow at the very start of an evaluation (when alien-signals
	 * calls the getter) leaves the computed marked clean, with its previous outcome and with every link purged
	 * (`deps`, its alien-signals@3.2.1 dependency list, is empty), so nothing would ever evaluate it again.
	 */
	function isUnreachable(): boolean {
		return (currentNode as { deps?: unknown } | null)?.deps === undefined
	}

	/** See {@link EvaluationNode.attempt}. Runs inside the boundary's Runtime operation with no active subscriber. */
	function attempt(): PropertyOutcome {
		const evaluationsBefore = evaluations
		const result = resultComputed() as PropertyOutcome | undefined
		if (result === undefined) {
			replaceComputed()
			return resultComputed()
		}
		if (computeExceptionKey in result && evaluations === evaluationsBefore) {
			if (isAbandoned(result))
				return readAbandonedAgain()
			if (isEngineStackOverflow(result[computeExceptionKey]))
				return reevaluate()
		}
		return result
	}

	/**
	 * A boundary read's own Property, read with no active subscriber: attempted, completed by the driver loop
	 * when abandoned, and only then read once more by `subscriber` (when there is one) to link it, so that a
	 * running subscriber is linked to the outcome the read completed, never to an abandoned one. The link read
	 * evaluates nothing unless foreign code changed this Property after it completed; that evaluation is driven
	 * like the first.
	 */
	function readAtBoundary(subscriber: ActiveSubscriber): PropertyOutcome {
		// {@link attempt}, with its rare branches out of line: every warm read takes this path.
		const evaluationsBefore = evaluations
		let outcome = resultComputed() as PropertyOutcome | undefined
		if (outcome === undefined || computeExceptionKey in outcome)
			outcome = completeBoundaryOutcome(outcome, evaluationsBefore)
		return subscriber === undefined ? outcome : linkSubscriber(subscriber, outcome)
	}

	/**
	 * Whether the current computed, whose cached outcome is abandoned, would not evaluate again when read: an
	 * abandoned computed is left dirty (see `keepAbandoned`), so this is one whose evaluation is still in
	 * progress further up the stack (alien-signals returns the cached outcome of a computed it is evaluating), or
	 * one an engine stack overflow inside alien-signals' own bookkeeping left marked clean.
	 */
	function abandonedWithoutReevaluation(): boolean {
		return inProgress > 0 || (((currentNode as AlienComputedNode | null)?.flags ?? 0) & ALIEN_DIRTY) === 0
	}

	/**
	 * A read found a cached abandonment it did not produce, and evaluated nothing (see
	 * {@link abandonedWithoutReevaluation}): the computed is replaced (see {@link replaceComputed}), and the
	 * fresh one read.
	 */
	function readAbandonedAgain(): PropertyOutcome {
		replaceComputed()
		return resultComputed()
	}

	/**
	 * The outcome of a boundary read's first read that is not a completed result: no outcome at all, an engine
	 * stack overflow this read did not produce, or an abandonment, each completed as {@link attempt} and the
	 * driver loop do; a compute exception is returned as it is.
	 */
	function completeBoundaryOutcome(outcome: PropertyOutcome | undefined, evaluationsBefore: number): PropertyOutcome {
		if (outcome === undefined) {
			replaceComputed()
			outcome = resultComputed()
		}
		else if (evaluations === evaluationsBefore) {
			if (isAbandoned(outcome)) {
				outcome = readAbandonedAgain()
			}
			else if (isEngineStackOverflow(outcome[computeExceptionKey as keyof PropertyOutcome])) {
				outcome = reevaluate()
			}
		}
		return isAbandoned(outcome) ? driveAbandonedRead(node) : outcome
	}

	/**
	 * Links `subscriber` to the computed whose `outcome` the boundary read just produced, by reading it once more
	 * with `subscriber` active (see {@link readAtBoundary}).
	 */
	function linkSubscriber(subscriber: NonNullable<ActiveSubscriber>, outcome: PropertyOutcome): PropertyOutcome {
		for (let rounds = 0; ; rounds++) {
			setActiveSub(subscriber)
			let linked: PropertyOutcome | undefined
			try {
				linked = resultComputed() as PropertyOutcome | undefined
			}
			finally {
				setActiveSub(undefined)
			}
			if (linked === outcome)
				return outcome
			if (linked !== undefined && !isAbandoned(linked))
				return linked
			// A read that ended in an engine stack overflow (see `driveAbandonedRead`) leaves the subscriber linked
			// to the computed whose evaluation it could not complete, which a later write evaluates again.
			if (!isAbandoned(outcome) && computeExceptionKey in outcome)
				return outcome
			if (rounds >= MAX_DRIVE_STALLS)
				throw new Error('widget-core: internal error — a Property read made no progress.')
			outcome = attempt()
			if (isAbandoned(outcome))
				outcome = driveAbandonedRead(node)
		}
	}

	/**
	 * The boundary read (see {@link segment}): starts a new segment, reads the computed result through the
	 * exact same call every existing consumer already makes — completing it in the driver loop when its
	 * evaluation was abandoned (see {@link driveAbandonedRead}) — then publishes the inspection fact only after
	 * that call has returned.
	 *
	 * In pinned alien-signals@3.2.1 a computed's cache assignment happens as `c.value = c.getter(...)`:
	 * the getter runs to completion *before* the assignment to `c.value` takes effect. Publishing from
	 * inside the getter body (as an earlier revision did) therefore ran before alien-signals had committed
	 * the fresh result to its own cache — a synchronous inspection listener that read the same Property
	 * back through the ordinary `.get()`/computed path during that window could observe the *previous*
	 * cached result (or an inconsistent one on the very first evaluation). Reading `resultComputed()` to
	 * completion here first, and only then comparing/publishing, means the cache is already committed by
	 * the time any listener runs. This is not a second alien-signals effect and creates no new tracked
	 * read: it is a plain post-return identity check on the same synchronous call `getResult()` already
	 * made. Every actual recompute produces a brand-new frozen `ExecutionResult` literal (see above), so
	 * comparing by reference — never by value — still notifies twice for two equal-value completions while
	 * never re-publishing a merely-re-read, already-cached result.
	 *
	 * A cached {@link ComputeException} is rethrown here, after the computed read has linked the caller
	 * (an enclosing evaluation or a subscription effect) to this Property, and is never published.
	 *
	 * Three outcomes are not kept, because they depend on the stack depth of an earlier read rather than on
	 * the Property's inputs, and a later read from a shallower stack must be able to succeed:
	 *
	 * - a cached engine stack overflow that this read did not just produce is evaluated again (see
	 *   {@link reevaluate}); one this read produced is thrown, since retrying at the same depth would only
	 *   overflow again. The engine's own overflow stays the last line of defence, for example when the host
	 *   itself calls from an already deep stack;
	 * - a cached abandonment (see {@link evaluate}) that this read did not just produce is evaluated again
	 *   too (its computed is dirty): an evaluation alien-signals started on its own during a flush (an effect's
	 *   dirty check) can be abandoned with no driver above it. One this read produced is completed by the
	 *   driver loop;
	 * - a computed with no outcome at all: the stack ran out inside alien-signals' own bookkeeping or at the
	 *   very start of the first evaluation, so the exception escaped the computed and left it marked clean
	 *   without a value. Nothing ever linked to a computed whose evaluation never completed (alien-signals
	 *   links the reader only after a read returns), so it is replaced by a fresh one.
	 */
	function getResultWithInspectionPublish(): ExecutionResult<unknown, RuntimePropertyDiagnostic> {
		const subscriber = getActiveSub()
		if (subscriber !== undefined)
			setActiveSub(undefined)
		const savedNesting = segment.nesting
		const savedAbandonedAt = segment.abandonedAt
		// With no evaluation in progress outside this read, nothing outside can still use a recorded target.
		const outerTarget = savedNesting === 0 ? null : segment.recordedTarget
		segment.nesting = 0
		segment.abandonedAt = null
		segment.recordedTarget = null
		let result: PropertyOutcome
		try {
			// `runRuntimeOperation` only records that an evaluation may start here: when this read is the
			// outermost such call, the diagnostic-snapshot propagations deferred during the evaluation (and
			// during every attempt of the driver loop) are released as soon as the computed has committed —
			// before the inspection publication below, exactly the order a direct in-evaluator write produced.
			// A nested read (a dependent Property's evaluator, or an effect run inside a state write's flush)
			// leaves the release to the outermost call instead.
			result = runRuntimeOperation(readAtBoundary, subscriber)
		}
		finally {
			segment.nesting = savedNesting
			segment.abandonedAt = savedAbandonedAt
			segment.recordedTarget = outerTarget
			if (subscriber !== undefined)
				setActiveSub(subscriber)
		}
		if (computeExceptionKey in result)
			throw result[computeExceptionKey]
		if (result !== lastPublishedResult) {
			lastPublishedResult = result
			publishInspectionCompletion()
		}
		return result
	}

	/**
	 * {@link getResultWithInspectionPublish} for a Property's own dependency callable, nested in the reading
	 * Property's evaluation on the same segment. An abandoned outcome is thrown as the internal
	 * {@link ABANDONMENT}, through the reader's `compute`, to the reader's evaluation.
	 *
	 * A cached abandonment is evaluated again by the read itself (the computed is dirty, see `keepAbandoned`),
	 * unless its computed is still evaluating further up the stack: it is then replaced (see
	 * {@link replaceComputed}) rather than re-entered.
	 */
	function readFromProperty(): ExecutionResult<unknown, RuntimePropertyDiagnostic> {
		if (cachedAbandoned) {
			// Once the segment unwinds, or an abandonment has reached its root (alien-signals' dirty check goes on
			// updating the readers of an abandoned Property during a flush, bottom-up), evaluating this Property
			// again would only descend to the same limit once per reader: the reader is abandoned at once instead,
			// and the driver loop, or the boundary read that follows the flush, completes the chain.
			if (segment.abandonedAt !== null || segment.recordedTarget !== null) {
				segment.abandonedAt ??= segment.recordedTarget
				throw ABANDONMENT
			}
			if (abandonedWithoutReevaluation())
				replaceComputed()
		}
		let result: PropertyOutcome | undefined
		if (hasCompletedLinks(currentNode)) {
			const evaluationsBefore = evaluations
			const read = resultComputed
			result = runRuntimeOperation(read) as PropertyOutcome | undefined
			if (result !== undefined) {
				if (computeExceptionKey in result && evaluations === evaluationsBefore && isEngineStackOverflow(result[computeExceptionKey]))
					result = runRuntimeOperation(reevaluate)
				// Replaced while it evaluated (a listener read this Property again, see `replaceComputed`): the
				// reader links the fresh computed too, since the replaced one drops its dependency links.
				else if (resultComputed !== read)
					result = runRuntimeOperation(resultComputed) as PropertyOutcome
				return finishReadFromProperty(result)
			}
			replaceComputed()
		}
		// Any other computed (one that has never completed, or that alien-signals tore down) is read with no
		// active subscriber, and the reader is linked to it only once it has completed (the second, cached read
		// below): when it is attempted again after an abandonment, it evaluates by nested reads, exactly like a
		// first read, rather than by alien-signals walking a chain of readers that have never completed. Inline
		// rather than a helper: this is the path a deep first read nests through.
		const reader = setActiveSub(undefined)
		try {
			const evaluationsBefore = evaluations
			result = runRuntimeOperation(resultComputed) as PropertyOutcome | undefined
			if (result === undefined) {
				replaceComputed()
				result = runRuntimeOperation(resultComputed) as PropertyOutcome
			}
			else if (computeExceptionKey in result && evaluations === evaluationsBefore && isEngineStackOverflow(result[computeExceptionKey])) {
				result = runRuntimeOperation(reevaluate)
			}
		}
		finally {
			setActiveSub(reader)
		}
		// Links the reader. Cached, unless foreign code changed this Property since: then it is evaluated again
		// here, as any tracked read would.
		if (!isAbandoned(result))
			result = runRuntimeOperation(resultComputed) as PropertyOutcome
		return finishReadFromProperty(result)
	}

	/** Throws an abandonment or a compute exception, or publishes a completed result unless already published. */
	function finishReadFromProperty(result: PropertyOutcome): ExecutionResult<unknown, RuntimePropertyDiagnostic> {
		if (isAbandoned(result)) {
			segment.abandonedAt ??= segment.recordedTarget ?? node
			throw ABANDONMENT
		}
		if (computeExceptionKey in result)
			throw result[computeExceptionKey]
		if (result !== lastPublishedResult) {
			lastPublishedResult = result
			publishInspectionCompletion()
		}
		return result
	}

	const internal: PropertyPrimitiveInternal = {
		getResult: getResultWithInspectionPublish,
		readFromProperty,
		getDiagnostics: () => diagnosticsSignal(),
		inspection: {
			getSnapshot: readInspectionSnapshot,
			subscribe: (listener) => {
				const entry: ListenerEntry = { listener }
				if (inspectionListeners === null)
					inspectionListeners = []
				inspectionListeners.push(entry)
				return () => {
					if (inspectionListeners === null)
						return
					const index = inspectionListeners.indexOf(entry)
					if (index !== -1)
						inspectionListeners.splice(index, 1)
				}
			},
		},
	}

	const publicProperty: RuntimeProperty<unknown> = {
		get() {
			context.assertActive()
			return internal.getResult()
		},
		subscribe(listener) {
			context.assertActive()
			return createTrackedSubscription(context, internal.getResult, listener)
		},
		getDiagnostics() {
			context.assertActive()
			return internal.getDiagnostics()
		},
		subscribeDiagnostics(listener) {
			context.assertActive()
			return createTrackedSubscription(context, internal.getDiagnostics, listener)
		},
	}

	return { internal, public: publicProperty }
}
