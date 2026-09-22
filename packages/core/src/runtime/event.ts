/**
 * Runtime semantic event channel.
 *
 * Event delivery deliberately does not use alien-signals: unlike value/diagnostic subscriptions,
 * event subscriber exceptions are part of synchronous emit semantics and must propagate immediately.
 */

import type { RuntimeEvent } from '../internal/contract'
import type { WidgetMemberKey } from '../types'
import type { RuntimeContext } from './context'
import { invokeListenerIsolated } from './adapter'

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
				listener(...args)
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

export function buildEventEmitter(events: ReadonlyMap<WidgetMemberKey, EventPrimitive>): Readonly<Record<string, (...args: readonly unknown[]) => void>> {
	const emitter: Record<string, (...args: readonly unknown[]) => void> = Object.create(null)
	for (const [name, primitive] of events)
		emitter[name] = (...args: readonly unknown[]) => primitive.emit(...args)
	return Object.freeze(emitter)
}
