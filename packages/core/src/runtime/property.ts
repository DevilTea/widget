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
 * Reading a Property is not bounded by the engine stack. The first read of a Property whose dependencies
 * are not evaluated yet nests one evaluation per link of the dependency chain (every `compute` reads its
 * dependency, whose `compute` reads the next), so Core bounds that nesting with an internal limit: an
 * evaluation that would nest deeper abandons every evaluation in progress, and the read that started them
 * completes them in a loop, deepest first (see {@link driveAbandonedRead}). An abandoned evaluation caches
 * nothing that is kept, commits no diagnostics and publishes no inspection completion, so the outcome is
 * that of an evaluation that had enough stack. Re-evaluating an evaluated chain after a write does not nest
 * (alien-signals' `checkDirty` updates the deepest dirty dependency first), which is why completing the
 * deepest evaluations first is the cure; where a re-evaluation does nest (a dependency read reaching a
 * dependency the dirty check has not updated yet starts a nested check), the same limit applies. Accepted in
 * DevilTea/widget Discussion #12
 * (https://github.com/DevilTea/widget/discussions/12#discussioncomment-19593596).
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
import { computed, signal } from 'alien-signals'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { createTrackedSubscription, invokeListenerIsolated, isEngineStackOverflow, readUntracked, runRuntimeOperation, writeDeferringFlush } from './adapter'
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

/**
 * How many Property evaluations may nest on one stack segment (see {@link segment}) before the evaluation
 * that would nest deeper is abandoned and completed later from a shallower stack. Internal: not API, not
 * configurable, and it may change.
 *
 * The figure that bounds it is the smallest stack Core has to run on: on quickjs-ng 0.18.0 with its default
 * 1 MiB stack, the head of a chain of trivial `compute`s read cold from a shallow host stack overflowed above
 * 129 nested evaluations. 32 is a quarter of that, which leaves room for what that measurement did not
 * include: real `compute` bodies (refinements, diagnostics, helper calls), the host's own stack below the
 * read, listener and flush frames, and further segments a read can open on top of this one (a Method a
 * `compute` depends on reads its own Properties on a new segment). A smaller limit only adds driver rounds,
 * not `compute` calls: a chain costs at most about two `compute` calls per Property whatever the limit.
 */
const EVALUATION_NESTING_LIMIT = 32

/**
 * Thrown by a Property's dependency read through `compute` to abandon the evaluation in progress (see
 * {@link evaluate}). Internal: plugin code must not rely on it, and a `compute` that catches it has its
 * return value discarded anyway. An `Error` only so that code which logs what it caught says what it is.
 */
const ABANDONMENT: Error = Object.freeze(new Error('widget-core: internal — this Property evaluation was abandoned to be completed from a shallower stack; do not catch it.'))

/**
 * The cached outcome of an abandoned evaluation: like an engine stack overflow it is an outcome that is not
 * kept, so a boundary read that finds it cached and did not just produce it evaluates again (a dependency
 * read does so only while that can be useful, see `readFromProperty`). One shared object,
 * so abandoning an evaluation whose cached outcome was already abandoned changes nothing alien-signals
 * would propagate.
 */
const ABANDONED_OUTCOME: ComputeException = Object.freeze({ [computeExceptionKey]: ABANDONMENT })

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
	/** Publishes the inspection completion of a completed result read by the driver, unless already published. */
	readonly publish: (outcome: PropertyOutcome) => void
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
 * Only the read's own Property is read tracked by the caller's subscriber; the targets are read untracked,
 * so a subscription or an enclosing evaluation never gains a dependency on them. A completed target's
 * inspection completion is published as a nested read publishes it. A target whose evaluation ends in an
 * engine stack overflow (the host called from an already deep stack) ends the read with that overflow,
 * exactly as an overflowing read did before. Disposal during the loop ends it with the post-dispose error.
 */
function driveAbandonedRead(root: EvaluationNode): PropertyOutcome {
	const drive = ++drives
	const pending: EvaluationNode[] = []
	let current = root
	let outcome: PropertyOutcome = ABANDONED_OUTCOME
	let stalls = 0
	for (;;) {
		if (outcome === ABANDONED_OUTCOME) {
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
			if (current === root)
				return outcome
			if (computeExceptionKey in outcome && isEngineStackOverflow(outcome[computeExceptionKey]))
				return outcome
			current.completedBy = drive
			current.publish(outcome)
			current = pending.pop()!
			current.pendingIn = 0
		}
		root.context.assertActive()
		segment.nesting = 0
		segment.abandonedAt = null
		segment.recordedTarget = null
		outcome = current === root ? root.attempt() : readUntracked(current.attempt)
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

	// This Property as the driver loop sees it (see `driveAbandonedRead`).
	const node: EvaluationNode = {
		attempt,
		publish: (outcome) => {
			if (!(computeExceptionKey in outcome) && outcome !== lastPublishedResult) {
				lastPublishedResult = outcome
				publishInspectionCompletion()
			}
		},
		context,
		completedBy: 0,
		pendingIn: 0,
	}

	/**
	 * The computed's getter. Besides a completed result or a cached compute exception it can yield the
	 * abandoned outcome, which is never kept (see {@link ABANDONED_OUTCOME}):
	 *
	 * - an evaluation that would start with {@link EVALUATION_NESTING_LIMIT} evaluations already in progress on
	 *   the segment does not run `compute`: it records itself as where the unwinding started
	 *   ({@link segment}) and yields it. The dependency read in the enclosing `compute` then throws the
	 *   internal {@link ABANDONMENT} (see `readFromProperty`), so the enclosing evaluation finishes too;
	 * - an evaluation that finishes while the segment unwinds yields it whatever its `compute` did (returned
	 *   a fallback after catching the abandonment, or threw anything else), and commits no diagnostics;
	 * - an evaluation that would start while the segment unwinds yields it without running `compute`.
	 *
	 * The getter itself never throws, also not the abandonment: it returns the abandoned outcome instead. The
	 * outermost evaluation of the segment ends the unwinding and hands the target to the segment's driver.
	 */
	function evaluate(): PropertyOutcome {
		++evaluations
		// Tracked first, before anything that could throw, so every evaluation that produced an outcome depends
		// on it. Outside the `try`: an evaluation that cannot even read it never produces an outcome (see
		// `getResultWithInspectionPublish` for how that case is recovered).
		;(retrySignal ??= signal(0))()

		if (segment.abandonedAt !== null)
			return ABANDONED_OUTCOME
		if (segment.nesting >= EVALUATION_NESTING_LIMIT) {
			segment.abandonedAt = node
			return ABANDONED_OUTCOME
		}
		++segment.nesting

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
			if (segment.abandonedAt !== null)
				return ABANDONED_OUTCOME
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
			if (segment.abandonedAt !== null)
				return ABANDONED_OUTCOME
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
		}
	}

	let resultComputed = computed<PropertyOutcome>(evaluate)

	/**
	 * Makes the computed evaluate again although no dependency changed, for a cached outcome that is not kept
	 * (an engine stack overflow or an abandonment): it depends on how deep the stack was when the evaluation
	 * ran, not on the compute's inputs. The write marks this Property (and through it its dependents) stale;
	 * its propagation is held until the enclosing Runtime operation leaves, like any write made while an
	 * evaluation may run.
	 */
	function reevaluate(): PropertyOutcome {
		const signal = retrySignal!
		writeDeferringFlush(() => signal(++retries))
		return resultComputed()
	}

	/** See {@link EvaluationNode.attempt}. Runs inside the boundary's Runtime operation. */
	function attempt(): PropertyOutcome {
		const evaluationsBefore = evaluations
		const result = resultComputed() as PropertyOutcome | undefined
		if (result === undefined) {
			resultComputed = computed<PropertyOutcome>(evaluate)
			return resultComputed()
		}
		if (computeExceptionKey in result && evaluations === evaluationsBefore && (result === ABANDONED_OUTCOME || isEngineStackOverflow(result[computeExceptionKey])))
			return reevaluate()
		return result
	}

	/**
	 * A boundary read's own Property: {@link attempt} (inlined, since every warm read takes this path), and
	 * completed by the driver loop when abandoned.
	 */
	function readAtBoundary(): PropertyOutcome {
		const evaluationsBefore = evaluations
		let result = resultComputed() as PropertyOutcome | undefined
		if (result === undefined) {
			resultComputed = computed<PropertyOutcome>(evaluate)
			result = resultComputed()
		}
		else if (computeExceptionKey in result && evaluations === evaluationsBefore && (result === ABANDONED_OUTCOME || isEngineStackOverflow(result[computeExceptionKey]))) {
			result = reevaluate()
		}
		return result === ABANDONED_OUTCOME ? driveAbandonedRead(node) : result
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
	 *   too: an evaluation alien-signals started on its own during a flush (an effect's dirty check reaching a
	 *   newly read, cold and deep branch) can be abandoned with no driver above it. One this read produced is
	 *   completed by the driver loop;
	 * - a computed with no outcome at all: the stack ran out inside alien-signals' own bookkeeping or at the
	 *   very start of the first evaluation, so the exception escaped the computed and left it marked clean
	 *   without a value. Nothing ever linked to a computed whose evaluation never completed (alien-signals
	 *   links the reader only after a read returns), so it is replaced by a fresh one.
	 */
	function getResultWithInspectionPublish(): ExecutionResult<unknown, RuntimePropertyDiagnostic> {
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
			result = runRuntimeOperation(readAtBoundary)
		}
		finally {
			segment.nesting = savedNesting
			segment.abandonedAt = savedAbandonedAt
			segment.recordedTarget = outerTarget
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
	 * A cached abandonment this read did not produce is evaluated again only while it can be useful: when the
	 * segment is not unwinding and no abandonment has reached its root yet. Once one has (alien-signals' dirty
	 * check goes on updating the dependents of an abandoned Property, bottom-up, each of which reads it),
	 * evaluating it again would only descend to the same limit once per dependent; the reader is abandoned at
	 * once instead, and the driver loop, or the boundary read that follows a flush, completes the chain.
	 */
	function readFromProperty(): ExecutionResult<unknown, RuntimePropertyDiagnostic> {
		const evaluationsBefore = evaluations
		let result = runRuntimeOperation(resultComputed) as PropertyOutcome | undefined
		if (result === undefined) {
			resultComputed = computed<PropertyOutcome>(evaluate)
			result = runRuntimeOperation(resultComputed)
		}
		else if (computeExceptionKey in result && evaluations === evaluationsBefore) {
			if (result !== ABANDONED_OUTCOME) {
				if (isEngineStackOverflow(result[computeExceptionKey]))
					result = runRuntimeOperation(reevaluate)
			}
			else if (segment.abandonedAt === null) {
				if (segment.recordedTarget === null)
					result = runRuntimeOperation(reevaluate)
				else
					segment.abandonedAt = segment.recordedTarget
			}
		}
		if (result === ABANDONED_OUTCOME)
			throw ABANDONMENT
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
