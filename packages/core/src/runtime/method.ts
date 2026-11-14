/**
 * RuntimeMethod primitive.
 *
 * Every invocation is one `alien-signals` batch boundary (start before `validateArgs`, end only after
 * the method's final diagnostic snapshot commits, `endBatch()` always in `finally`). Nested
 * dependency-invoked methods reuse this exact same pipeline, so nested calls naturally nest batch
 * depth; only the outermost `endBatch()` flushes. When runaway recursion (a valid Method <-> Method
 * cycle) exhausts the stack, the deepest frames' `endBatch()` calls can themselves overflow; the
 * outermost `runRuntimeOperation` frame closes those leaked levels (see `releaseBatches` in the adapter).
 *
 * That rule is kept true one level further out: a Property may declare a dependency on a write-free
 * Method, so `invoke` can run inside a Property evaluator — also one alien-signals' own flush started, at
 * batch depth `0` — and there the invocation's own batch must not be the one that flushes: doing so
 * re-enters alien-signals' propagation while the evaluating computed is uncommitted (`writeDeferringFlush`
 * documents the mechanism). An invocation enclosed by another Runtime operation therefore leaves its level
 * open (`endBatchDeferringFlush`), and the flush happens once the outermost enclosing read/write call is
 * leaving instead, whether or not the invocation committed a changed diagnostic snapshot.
 *
 * Normative contract: DevilTea/widget Discussion #12, Core composition architecture topic. Historical source (migrated): diagnostic #10 consolidated handoff §15, amendment "RuntimeMethod invocation as
 * alien-signals batch boundary".
 */

import type { RelativeValueDiagnosticInput, RuntimeMethodDiagnostic } from '../diagnostic'
import type { ExecutionResult } from '../execution-result'
import type { CompiledDependencyTree, CompiledWidgetNode, RuntimeMethod } from '../internal/contract'
import type { ErasedWidgetMethodDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { ActiveDiagnosticSink, CallbackOwner, RuntimeContext } from './context'
import type { PrimitiveRegistryEntry } from './deps'
import type { EventPrimitive } from './event'
import { signal, startBatch } from 'alien-signals'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { createTrackedSubscription, endBatchDeferringFlush, runRuntimeOperation, writeDeferringFlush } from './adapter'
import { createOperationCollector } from './collector'
import { callbackScope } from './context'
import { materializeDependencyTree } from './deps'
import { buildDefaultMethodArgsDiagnostic, buildMethodArgsDiagnostic, buildMethodResultDiagnostic, freezeDiagnosticSnapshot, toDiagnosticSnapshot } from './diagnostics'
import { createMethodEmitFragment } from './event'
import { assertSyncValue } from './sync'

export interface MethodPrimitive {
	/** Tracked raw diagnostic-snapshot read. */
	getDiagnostics: () => readonly RuntimeMethodDiagnostic[]
	public: RuntimeMethod<(...args: readonly unknown[]) => unknown>
}

export interface CreateMethodPrimitiveParams {
	readonly widgetId: WidgetId
	readonly name: WidgetMemberKey
	readonly definition: ErasedWidgetMethodDefinition
	readonly buildConfigFragment: () => Record<string, unknown>
	readonly selfNode: unknown
	readonly blueprintView: unknown
	/** The compiled dependency tree; its callables are materialized on the first execution. */
	readonly depsTree: CompiledDependencyTree
	readonly registry: ReadonlyMap<number, PrimitiveRegistryEntry>
	readonly nodes: readonly CompiledWidgetNode[]
	/** The plugin's type, its Event declarations and this widget's Event primitives (the last two are `null` for a plugin without Events). */
	readonly pluginType: string
	readonly eventDefinitions: ReadonlyMap<WidgetMemberKey, unknown> | null
	readonly events: ReadonlyMap<WidgetMemberKey, EventPrimitive> | null
	/** The owner the dependency callables and the `emit` callables are materialized for. */
	readonly owner: CallbackOwner
	/** Called with every committed diagnostic-snapshot change (the Runtime aggregate's commit hook). */
	readonly onDiagnosticsCommitted: () => void
}

export function createMethodPrimitive(context: RuntimeContext, params: CreateMethodPrimitiveParams): MethodPrimitive {
	const diagnosticsSignal = signal<readonly RuntimeMethodDiagnostic[]>(EMPTY_DIAGNOSTICS)

	// Untracked mirror of `diagnosticsSignal`'s value: an unchanged snapshot skips the write.
	let committedDiagnostics: readonly RuntimeMethodDiagnostic[] = EMPTY_DIAGNOSTICS
	function commitDiagnostics(next: readonly RuntimeMethodDiagnostic[]): void {
		if (next === committedDiagnostics)
			return
		committedDiagnostics = next
		writeDeferringFlush(() => {
			diagnosticsSignal(next)
			params.onDiagnosticsCommitted()
		})
	}

	// The materialized `deps` of `execute`'s context: built by the first execution, the same object ever after.
	let deps: unknown
	// The `emit`-related members of `execute`'s context: built by the first execution, the same object ever after.
	let emitFragment: Readonly<Record<string, unknown>> | undefined

	function invokeWithinOperation(args: readonly unknown[]): ExecutionResult<unknown, RuntimeMethodDiagnostic> {
		startBatch()
		try {
			const argsCollector = createOperationCollector<RelativeValueDiagnosticInput, RuntimeMethodDiagnostic>()
			const argsCtx = {
				...params.buildConfigFragment(),
				addDiagnostic: argsCollector.addDiagnostic,
				hasAnyDiagnostic: argsCollector.hasAnyDiagnostic,
			}

			let validArgs: unknown
			let hasArgsDiagnostic: boolean
			// `validateArgs` owns no dependency or `emit` callables, so no callback is open while it runs (see
			// `callbackScope`), even when the invoking Method or Property is still running.
			const previousArgsOwner = callbackScope.owner
			callbackScope.owner = null
			try {
				validArgs = params.definition.validateArgs(args, argsCtx)
				assertSyncValue(validArgs, 'Method', params.name, 'validateArgs')
				hasArgsDiagnostic = argsCollector.hasAnyDiagnostic()
			}
			finally {
				callbackScope.owner = previousArgsOwner
				argsCollector.close()
			}

			if (!validArgs || hasArgsDiagnostic) {
				const finalized = argsCollector.finalize(input => buildMethodArgsDiagnostic(params.widgetId, params.name, args, input))
				// `finalize()` already returns a deep-frozen array; the generic-fallback branch builds
				// a fresh array here and needs the same immutable-snapshot treatment (diagnostic #10
				// diagnostic-snapshot contract).
				const diagnostics = finalized.length > 0 ? finalized : freezeDiagnosticSnapshot([buildDefaultMethodArgsDiagnostic(params.widgetId, params.name, args)])
				commitDiagnostics(diagnostics)
				// `invoke()` doesn't cache its return value, so mutating it can't corrupt a later call
				// the way Property's cached computed result could — freezing the wrapper here is a
				// consistency/defense-in-depth measure, not a fix for a persistence hazard.
				return Object.freeze({ ok: false, failure: { diagnostics: diagnostics as readonly [RuntimeMethodDiagnostic, ...RuntimeMethodDiagnostic[]] } })
			}

			deps ??= materializeDependencyTree(params.depsTree, {
				consumer: 'method',
				ownerWidgetId: params.widgetId,
				ownerName: params.name,
				registry: params.registry,
				nodes: params.nodes,
				context,
				owner: params.owner,
			})
			emitFragment ??= createMethodEmitFragment(context, params.owner, params.pluginType, params.eventDefinitions, params.events, params.definition.emits)
			const execCollector = createOperationCollector<RelativeValueDiagnosticInput, RuntimeMethodDiagnostic>()
			const sink: ActiveDiagnosticSink = {
				addFinalizedDiagnostic: (diagnostic, dedupe) => execCollector.addFinalizedDiagnostic(diagnostic as RuntimeMethodDiagnostic, dedupe),
			}

			const executeCtx = {
				args,
				widget: params.selfNode,
				blueprint: params.blueprintView,
				deps,
				...emitFragment,
				...params.buildConfigFragment(),
				addDiagnostic: execCollector.addDiagnostic,
				hasAnyDiagnostic: execCollector.hasAnyDiagnostic,
			}

			// This Method becomes the innermost running callback for the duration of `execute` (see
			// `callbackScope`): only its own dependency callables and its own `emit` are usable, and
			// they report into `sink`. Plain-assignment save/restore, so it survives an exhausted stack.
			const { owner } = params
			const previousOwner = callbackScope.owner
			const previousSink = owner.sink
			callbackScope.owner = owner
			owner.sink = sink
			let value: unknown
			try {
				value = params.definition.execute(executeCtx)
			}
			finally {
				callbackScope.owner = previousOwner
				owner.sink = previousSink
				execCollector.close()
			}
			assertSyncValue(value, 'Method', params.name, 'execute')

			const diagnostics = execCollector.finalize(input => buildMethodResultDiagnostic(params.widgetId, params.name, value, input))
			commitDiagnostics(toDiagnosticSnapshot(diagnostics))

			// Same consistency rationale as the validateArgs-failure branch above: not a persistence
			// hazard (each `invoke()` builds a fresh wrapper). Only Method and Property results are frozen:
			// `RuntimeState.set()` and dependency-callable results are equally fresh per call and never
			// retained by Core, so mutating one cannot corrupt Runtime state, and freezing them was
			// measured at roughly a fifth of a dependency-heavy invocation's cost.
			const result: ExecutionResult<unknown, RuntimeMethodDiagnostic> = diagnostics.length > 0
				? { ok: false, failure: { diagnostics: diagnostics as readonly [RuntimeMethodDiagnostic, ...RuntimeMethodDiagnostic[]] } }
				: { ok: true, value }
			return Object.freeze(result)
		}
		finally {
			endBatchDeferringFlush()
		}
	}

	// The rest parameter is the one fresh `args` array of the invocation: it is handed on as is.
	const callable = ((...args: readonly unknown[]) => {
		context.assertActive()
		return runRuntimeOperation(invokeWithinOperation, args)
	}) as RuntimeMethod<(...args: readonly unknown[]) => unknown>

	Object.assign(callable, {
		getDiagnostics() {
			context.assertActive()
			return diagnosticsSignal()
		},
		subscribeDiagnostics(listener: (diagnostics: readonly RuntimeMethodDiagnostic[]) => void) {
			context.assertActive()
			return createTrackedSubscription(context, () => diagnosticsSignal(), listener, 'the diagnostics of Method', params.widgetId, params.name)
		},
	})

	return {
		getDiagnostics: () => diagnosticsSignal(),
		public: callable,
	}
}
