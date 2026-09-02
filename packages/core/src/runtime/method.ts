/**
 * RuntimeMethod primitive.
 *
 * Every invocation is one `alien-signals` batch boundary (start before `validateArgs`, end only after
 * the method's final diagnostic snapshot commits, `endBatch()` always in `finally`). Nested
 * dependency-invoked methods reuse this exact same pipeline, so nested calls naturally nest batch
 * depth; only the outermost `endBatch()` flushes.
 *
 * The diagnostic-snapshot commits go through `writeDeferringFlush`, which keeps that rule true one level
 * further out: a Property may declare a dependency on a write-free Method, so `invoke` can run inside a
 * Property evaluator, and there the invocation's own `endBatch()` must not be the frame that flushes —
 * doing so re-enters alien-signals' propagation while the evaluating computed is uncommitted (the helper
 * documents the mechanism). The still-open deferral level keeps this `endBatch()` from reaching depth `0`,
 * and the flush happens once the outermost enclosing read/write call is leaving instead.
 *
 * Normative source: diagnostic #10 consolidated handoff §15, amendment "RuntimeMethod invocation as
 * alien-signals batch boundary".
 */

import type { RelativeValueDiagnosticInput, RuntimeMethodDiagnostic } from '../diagnostic'
import type { ExecutionResult } from '../execution-result'
import type { RuntimeMethod } from '../internal/contract'
import type { ErasedWidgetMethodDefinition } from '../plugin'
import type { WidgetId, WidgetMemberKey } from '../types'
import type { ActiveDiagnosticSink, RuntimeContext } from './context'
import { endBatch, signal, startBatch } from 'alien-signals'
import { EMPTY_DIAGNOSTICS } from '../diagnostic'
import { createTrackedSubscription, runRuntimeOperation, writeDeferringFlush } from './adapter'
import { createOperationCollector } from './collector'
import { buildDefaultMethodArgsDiagnostic, buildMethodArgsDiagnostic, buildMethodResultDiagnostic, freezeDiagnosticSnapshot, toDiagnosticSnapshot } from './diagnostics'
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
	readonly deps: unknown
}

export function createMethodPrimitive(context: RuntimeContext, params: CreateMethodPrimitiveParams): MethodPrimitive {
	const diagnosticsSignal = signal<readonly RuntimeMethodDiagnostic[]>(EMPTY_DIAGNOSTICS)

	function invoke(...args: readonly unknown[]): ExecutionResult<unknown, RuntimeMethodDiagnostic> {
		context.assertActive()
		return runRuntimeOperation(() => invokeWithinOperation(...args))
	}

	function invokeWithinOperation(...args: readonly unknown[]): ExecutionResult<unknown, RuntimeMethodDiagnostic> {
		startBatch()
		try {
			const argsCollector = createOperationCollector<RelativeValueDiagnosticInput, RuntimeMethodDiagnostic>()
			const argsCtx = {
				...params.buildConfigFragment(),
				addDiagnostic: argsCollector.addDiagnostic,
				hasAnyDiagnostic: argsCollector.hasAnyDiagnostic,
			}

			const validArgs = params.definition.validateArgs(args, argsCtx)
			assertSyncValue(validArgs, `Method "${params.name}"'s validateArgs`)

			if (!validArgs || argsCollector.hasAnyDiagnostic()) {
				const finalized = argsCollector.finalize(input => buildMethodArgsDiagnostic(params.widgetId, params.name, args, input))
				// `finalize()` already returns a deep-frozen array; the generic-fallback branch builds
				// a fresh array here and needs the same immutable-snapshot treatment (diagnostic #10
				// diagnostic-snapshot contract).
				const diagnostics = finalized.length > 0 ? finalized : freezeDiagnosticSnapshot([buildDefaultMethodArgsDiagnostic(params.widgetId, params.name, args)])
				writeDeferringFlush(() => diagnosticsSignal(diagnostics))
				// `invoke()` doesn't cache its return value, so mutating it can't corrupt a later call
				// the way Property's cached computed result could — freezing the wrapper here is a
				// consistency/defense-in-depth measure, not a fix for a persistence hazard.
				return Object.freeze({ ok: false, failure: { diagnostics: diagnostics as readonly [RuntimeMethodDiagnostic, ...RuntimeMethodDiagnostic[]] } })
			}

			const execCollector = createOperationCollector<RelativeValueDiagnosticInput, RuntimeMethodDiagnostic>()
			const sink: ActiveDiagnosticSink = {
				addFinalizedDiagnostic: (diagnostic, dedupe) => execCollector.addFinalizedDiagnostic(diagnostic as RuntimeMethodDiagnostic, dedupe),
			}

			const executeCtx = {
				args,
				widget: params.selfNode,
				blueprint: params.blueprintView,
				deps: params.deps,
				...params.buildConfigFragment(),
				addDiagnostic: execCollector.addDiagnostic,
				hasAnyDiagnostic: execCollector.hasAnyDiagnostic,
			}

			const value = context.withActiveCollector(sink, () => params.definition.execute(executeCtx))
			assertSyncValue(value, `Method "${params.name}"'s execute`)

			const diagnostics = execCollector.finalize(input => buildMethodResultDiagnostic(params.widgetId, params.name, value, input))
			writeDeferringFlush(() => diagnosticsSignal(toDiagnosticSnapshot(diagnostics)))

			// Same consistency rationale as the validateArgs-failure branch above: not a persistence
			// hazard (each `invoke()` builds a fresh wrapper), but freezing it keeps every
			// `ExecutionResult` returned to plugin/consumer code equally immutable.
			const result: ExecutionResult<unknown, RuntimeMethodDiagnostic> = diagnostics.length > 0
				? { ok: false, failure: { diagnostics: diagnostics as readonly [RuntimeMethodDiagnostic, ...RuntimeMethodDiagnostic[]] } }
				: { ok: true, value }
			return Object.freeze(result)
		}
		finally {
			endBatch()
		}
	}

	const callable = ((...args: readonly unknown[]) => invoke(...args)) as RuntimeMethod<(...args: readonly unknown[]) => unknown>

	Object.assign(callable, {
		getDiagnostics() {
			context.assertActive()
			return diagnosticsSignal()
		},
		subscribeDiagnostics(listener: (diagnostics: readonly RuntimeMethodDiagnostic[]) => void) {
			context.assertActive()
			return createTrackedSubscription(context, () => diagnosticsSignal(), listener)
		},
	})

	return {
		getDiagnostics: () => diagnosticsSignal(),
		public: callable,
	}
}
