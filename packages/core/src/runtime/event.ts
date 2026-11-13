/**
 * Runtime semantic event channel.
 *
 * Event delivery deliberately does not use alien-signals: it is synchronous and depth-first, with the
 * listener list snapshotted at emit start and inspection listeners first. Like every other external
 * listener, a throwing public event listener is isolated — reported outside the emit, never aborting the
 * remaining listeners or the emitting Method (amends Discussion #12 C0R154, which propagated it).
 *
 * Because of that isolation a listener that re-invokes the emitting Method would not fail fast: each
 * nesting level would retry its remaining listeners after the deeper one failed. A non-semantic
 * re-entrancy guard therefore bounds one Runtime's nested emits at {@link MAX_EMIT_DEPTH}. Its
 * `WidgetSystemRuntimeReentrancyError` (and an engine stack overflow raised inside a listener) is never
 * isolated; while it unwinds, every emit of this Runtime still on the stack rethrows it — even one whose
 * listener swallowed it — so the loop ends at the operation that started it after linear work.
 */

import type { RuntimeEvent } from '../internal/contract'
import type { WidgetMemberKey } from '../types'
import type { RuntimeContext } from './context'
import { WidgetSystemRuntimeReentrancyError } from '../diagnostic'
import { invokeEventListenerIsolated, invokeListenerIsolated } from './adapter'
import { callbackScope } from './context'
import { throwClosedCallbackMember } from './sync'

/**
 * How deeply one Runtime's event emits may nest. Generous for legitimate re-entrancy: an event bubbled up
 * through the deepest widget tree `MAX_JSON_DEPTH` admits (86 levels) by one listener-invoked Method per
 * level fits with room to spare. Still far below where a minimal loop exhausts Node's default stack
 * (about 650 nested emits), so on common engines the guard, not the stack, ends a runaway loop.
 */
export const MAX_EMIT_DEPTH = 128

export interface EventInspectionChannel {
	subscribe: (listener: (args: readonly unknown[]) => void) => () => void
}

export interface EventPrimitive {
	readonly public: RuntimeEvent<readonly unknown[]>
	readonly emit: (...args: readonly unknown[]) => void
	readonly inspection: EventInspectionChannel
}

export function createEventPrimitive(context: RuntimeContext): EventPrimitive {
	const listeners = new Set<{ readonly listener: (...args: readonly unknown[]) => void }>()
	interface InspectionListenerEntry { readonly listener: (args: readonly unknown[]) => void }
	let inspectionListeners: InspectionListenerEntry[] | null = null

	function publishInspectionOccurrence(args: readonly unknown[]): void {
		if (inspectionListeners === null)
			return
		const snapshot = inspectionListeners.slice()
		for (const { listener } of snapshot)
			invokeListenerIsolated(listener, args)
	}

	const publicEvent: RuntimeEvent<readonly unknown[]> = Object.freeze({
		subscribe(listener: (...args: readonly unknown[]) => void) {
			context.assertActive()
			const entry = { listener }
			listeners.add(entry)
			return context.registerSubscription(() => listeners.delete(entry))
		},
	})

	return {
		public: publicEvent,
		emit(...args) {
			context.assertActive()
			const nesting = context.emitNesting
			if (nesting.unwinding !== null)
				throw nesting.unwinding
			if (nesting.depth >= MAX_EMIT_DEPTH)
				throw (nesting.unwinding = new WidgetSystemRuntimeReentrancyError(`Event emits nested deeper than ${MAX_EMIT_DEPTH} levels in one Runtime: an event listener keeps re-invoking a Method that emits.`))
			// Plain updates only, so the bookkeeping survives an exhausted stack.
			++nesting.depth
			try {
				// Public membership is fixed at emit start, before an inspection callback can itself subscribe
				// or unsubscribe through some separately-held Runtime handle.
				const listenersSnapshot = [...listeners]
				const occurrenceArgs = Object.freeze([...args])
				publishInspectionOccurrence(occurrenceArgs)
				for (const { listener } of listenersSnapshot) {
					// A listener (or the code between it and a deeper emit) swallowed an unwinding error.
					if (nesting.unwinding !== null)
						throw nesting.unwinding
					invokeEventListenerIsolated(listener, args)
				}
				if (nesting.unwinding !== null)
					throw nesting.unwinding
			}
			catch (error) {
				// Only an error isolation does not swallow gets here (see `isEmitLoopError`), possibly raised in
				// another Runtime: it unwinds this Runtime's nested emits too.
				nesting.unwinding ??= error
				throw error
			}
			finally {
				if (--nesting.depth === 0)
					nesting.unwinding = null
			}
		},
		inspection: {
			subscribe(listener) {
				const entry: InspectionListenerEntry = { listener }
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
}

/** The renderer-integration emitter (`@deviltea/widget-core/integration`): valid until disposal. */
export function buildEventEmitter(events: ReadonlyMap<WidgetMemberKey, EventPrimitive>): Readonly<Record<string, (...args: readonly unknown[]) => void>> {
	const emitter: Record<string, (...args: readonly unknown[]) => void> = Object.create(null)
	for (const name of events.keys()) {
		const primitive = events.get(name)!
		emitter[name] = (...args: readonly unknown[]) => primitive.emit(...args)
	}
	return Object.freeze(emitter)
}

/**
 * The `emit` surface one widget's Method `execute` callbacks receive (shared by that widget's Methods).
 * Besides the disposal guard, each call requires the innermost running callback to be one of those
 * Methods — its `CallbackOwner.emitter` is this very object — so an emitter retained past its callback,
 * or reached from a Property `compute`, throws without delivering.
 */
export function buildCallbackEventEmitter(
	context: RuntimeContext,
	events: ReadonlyMap<WidgetMemberKey, EventPrimitive>,
): Readonly<Record<string, (...args: readonly unknown[]) => void>> {
	const emitter: Record<string, (...args: readonly unknown[]) => void> = Object.create(null)
	for (const name of events.keys()) {
		const primitive = events.get(name)!
		emitter[name] = (...args: readonly unknown[]) => {
			context.assertActive()
			if (callbackScope.owner?.emitter !== emitter)
				throwClosedCallbackMember('emit')
			primitive.emit(...args)
		}
	}
	return Object.freeze(emitter)
}
