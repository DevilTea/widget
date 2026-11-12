/**
 * Runtime semantic event channel.
 *
 * Event delivery deliberately does not use alien-signals: it is synchronous and depth-first, with the
 * listener list snapshotted at emit start and inspection listeners first. Like every other external
 * listener, a throwing public event listener is isolated — reported outside the emit, never aborting the
 * remaining listeners or the emitting Method (amends Discussion #12 C0R154, which propagated it).
 */

import type { RuntimeEvent } from '../internal/contract'
import type { WidgetMemberKey } from '../types'
import type { RuntimeContext } from './context'
import { invokeEventListenerIsolated, invokeListenerIsolated } from './adapter'
import { callbackScope } from './context'
import { throwClosedCallbackMember } from './sync'

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
			// Public membership is fixed at emit start, before an inspection callback can itself subscribe
			// or unsubscribe through some separately-held Runtime handle.
			const listenersSnapshot = [...listeners]
			const occurrenceArgs = Object.freeze([...args])
			publishInspectionOccurrence(occurrenceArgs)
			for (const { listener } of listenersSnapshot)
				invokeEventListenerIsolated(listener, args)
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
	for (const [name, primitive] of events)
		emitter[name] = (...args: readonly unknown[]) => primitive.emit(...args)
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
	for (const [name, primitive] of events) {
		emitter[name] = (...args: readonly unknown[]) => {
			context.assertActive()
			if (callbackScope.owner?.emitter !== emitter)
				throwClosedCallbackMember('emit')
			primitive.emit(...args)
		}
	}
	return Object.freeze(emitter)
}
