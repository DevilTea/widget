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
import type { CallbackOwner, RuntimeContext } from './context'
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

type EmitCallable = (...args: readonly unknown[]) => void

/**
 * What every widget of one plugin shares for the `emit` of its Methods: the prototype of every Method
 * `emit` object, whose non-enumerable members are one throwing stand-in per Event of the plugin (an own
 * member, declared in `emits`, shadows its stand-in), and the `emit` object of a Method that declares
 * nothing. Built when the first Method of the plugin first runs, so creating a Runtime allocates none of it.
 */
interface MethodEmitTemplate {
	readonly prototype: object
	readonly fragment: Readonly<Record<string, unknown>>
}

const methodEmitTemplates = new WeakMap<object, MethodEmitTemplate>()

/** The context members of a Method of a plugin that declares no Events: there is no `emit`. */
const NO_EMIT_FRAGMENT: Readonly<Record<string, unknown>> = Object.freeze({})

function methodEmitTemplate(pluginType: string, eventDefinitions: ReadonlyMap<WidgetMemberKey, unknown>): MethodEmitTemplate {
	let template = methodEmitTemplates.get(eventDefinitions)
	if (template === undefined) {
		const prototype: object = Object.create(null)
		for (const name of eventDefinitions.keys()) {
			Object.defineProperty(prototype, name, {
				value: function undeclaredEmit(): never {
					const owner = callbackScope.owner
					// Only a running Method can have declared anything: from anywhere else (after its callback, from
					// a Property, after disposal) this is a retained callable.
					if (owner === null || owner.method === null)
						throwClosedCallbackMember('emit')
					// A running Method that did declare the Event has its own callable for it, so this one is retained
					// from another Method (typically one that declared nothing): it is not the running Method's fault.
					if (owner.emits?.includes(name))
						throwClosedCallbackMember('emit')
					throw new TypeError(`Widget plugin "${pluginType}": Method "${owner.method}" (widget "${owner.widgetId}") emitted Event "${name}" without declaring it. Add "${name}" to the Method's "emits". This is a plugin implementation bug.`)
				},
				writable: false,
				configurable: false,
			})
		}
		// Shared by every Runtime and System that loads this plugin: nothing may replace a stand-in.
		Object.freeze(prototype)
		template = { prototype, fragment: Object.freeze({ emit: Object.freeze(Object.create(prototype)) }) }
		methodEmitTemplates.set(eventDefinitions, template)
	}
	return template
}

/**
 * The `emit`-related members of one Method's `execute` context. A Method of a plugin without Events has
 * none; a Method that declares no `emits` receives the plugin's shared empty `emit`; a Method that declares
 * some receives its own `emit`, holding only the declared Events. Each of its callables requires the owner
 * of this very Method to be the innermost running callback (like a dependency callable), so an `emit`
 * retained past its callback, reached from a Property `compute`, or used while a different Method of the
 * same widget runs, throws without delivering. An Event the Method did not declare is not an own member:
 * calling it throws a `TypeError` naming the Method before anything is delivered.
 */
export function createMethodEmitFragment(
	context: RuntimeContext,
	owner: CallbackOwner,
	pluginType: string,
	eventDefinitions: ReadonlyMap<WidgetMemberKey, unknown> | null,
	events: ReadonlyMap<WidgetMemberKey, EventPrimitive> | null,
	emits: readonly WidgetMemberKey[] | undefined,
): Readonly<Record<string, unknown>> {
	if (eventDefinitions === null || events === null)
		return NO_EMIT_FRAGMENT
	const template = methodEmitTemplate(pluginType, eventDefinitions)
	if (emits === undefined || emits.length === 0)
		return template.fragment

	const emitter: Record<string, EmitCallable> = Object.create(template.prototype)
	for (const name of emits) {
		const primitive = events.get(name)!
		Object.defineProperty(emitter, name, {
			value: (...args: readonly unknown[]) => {
				context.assertActive()
				if (callbackScope.owner !== owner)
					throwClosedCallbackMember('emit')
				primitive.emit(...args)
			},
			enumerable: true,
		})
	}
	return Object.freeze({ emit: Object.freeze(emitter) })
}
