/**
 * The live Events log (issue #230, audit U09): subscribes over the Inspector protocol to every Event the Preview
 * Runtime's widgets declare (`runtime.subscribeEvent`, answered by `runtime.eventOccurred`) and keeps the occurrences in
 * a bounded buffer. Like the shared Runtime snapshot source it is one source per store, not one per panel:
 *
 * - it records while the Lab has a Preview connection and at least one consumer is mounted (the Events panel; Dockview
 *   mounts every canonical panel at load and keeps it mounted while its tab is hidden), not only while the tab is the
 *   visible one: Events are push-only, cost nothing while idle and Core has no replay, so a Submit pressed while another
 *   tab is open must still be there when the Events tab is opened. Entries that arrive while no consumer is visible are
 *   counted as unseen (`unseen`), so the tab can say so;
 * - every subscription is released when the connection is replaced (Apply, a retry, a showcase switch, a Preview
 *   remount) or the last consumer goes away;
 * - a new connection is a new Runtime with new node ids, so subscriptions are made again from that connection's
 *   Blueprint snapshot; entries already recorded stay, tagged with the revision that emitted them;
 * - switching showcase clears the buffer (those entries describe widgets of another application) and ignores whatever
 *   the previous showcase's connection still sends until the new one has replaced it.
 *
 * Method failures (issue #230, audit U08): from protocol 0.5 the log also subscribes to every Method of every resolved
 * widget (`runtime.subscribeMember` with a Method member) and records an entry whenever a Method's diagnostic snapshot
 * arrives (`runtime.memberChanged`) with diagnostics. The snapshot is a current fact and not a call log (Core keeps no
 * history of Method calls): the Method's state when the subscription starts is not an occurrence and is not recorded, a
 * snapshot that became empty again (a later success) records nothing, and changes made inside one Runtime call can arrive
 * as one entry. These entries are listed next to the Events but are not Events, and the log never invokes a Method.
 *
 * Read-only: the Inspector has no emit authority and neither has this module.
 */
import type { InspectorBlueprintNode } from '@deviltea/widget-inspector/protocol'
import type { ComputedRef, Ref } from 'vue'
import type { EventLogBuffer, EventLogItem } from '../events/event-log'
import type { PreviewFrameConnection } from '../preview-host/frame-driver'
import type { LabStore } from './use-lab-store'
import { computed, effectScope, onScopeDispose, shallowRef, watch } from 'vue'
import { appendEventLogEntry, EMPTY_EVENT_LOG, EVENT_LOG_LIMIT } from '../events/event-log'
import { useLabStore } from './use-lab-store'

/** One widget of the current Preview that declares Events. */
export interface EventEmitterWidget {
	readonly nodeId: number
	readonly widgetId: string
	readonly widgetType: string
	readonly events: readonly string[]
}

/** One widget of the current Preview that declares Methods. */
export interface MethodWidget {
	readonly nodeId: number
	readonly widgetId: string
	readonly widgetType: string
	readonly methods: readonly string[]
}

export type EventLogListening
	/** No consumer is mounted, so nothing is subscribed. */
	= | { readonly state: 'off' }
	/** There is no valid Preview: the Document has problems and nothing has been applied yet. */
		| { readonly state: 'no-preview' }
	/** A valid Preview exists but its frame has not connected yet. */
		| { readonly state: 'loading' }
	/** The Preview frame was connected and is not any more (closed, did not answer), so nothing runs to listen to. */
		| { readonly state: 'lost' }
	/**
	 * The frame refused to switch to the current showcase and still runs the previous one: its Events belong to another
	 * application and are not recorded (nothing is subscribed on it).
	 */
		| { readonly state: 'previous-showcase' }
	/** The Preview Runtime's widgets declare no Events at all. */
		| { readonly state: 'no-events' }
		| { readonly state: 'listening', readonly widgets: number, readonly events: number, readonly failed: number }

export interface EventLog {
	readonly entries: Readonly<Ref<readonly EventLogItem[]>>
	/** Entries dropped because the buffer was full, since the log was last cleared. */
	readonly dropped: Readonly<Ref<number>>
	/** Event occurrences that arrived while the log was paused and were therefore not recorded. */
	readonly skippedWhilePaused: Readonly<Ref<number>>
	/** Method failures that arrived while the log was paused and were therefore not recorded. */
	readonly skippedFailuresWhilePaused: Readonly<Ref<number>>
	/** Method failures recorded since the log was last cleared (including any that were dropped from the buffer). */
	readonly recordedFailures: Readonly<Ref<number>>
	/** The Methods the log watches for failures, and how many of them it could not subscribe to. */
	readonly watchingMethods: Readonly<Ref<{ readonly methods: number, readonly failed: number }>>
	/** Entries recorded while no consumer was visible, since one last was. */
	readonly unseen: Readonly<Ref<number>>
	readonly paused: Readonly<Ref<boolean>>
	readonly listening: Readonly<Ref<EventLogListening>>
	/** The widgets of the current Preview that declare Events (what the log can show), whether or not subscribed. */
	readonly emitters: Readonly<Ref<readonly EventEmitterWidget[]>>
	setPaused: (paused: boolean) => void
	clear: () => void
}

interface SharedSource {
	readonly buffer: Ref<EventLogBuffer>
	readonly paused: Ref<boolean>
	readonly skippedWhilePaused: Ref<number>
	readonly skippedFailuresWhilePaused: Ref<number>
	readonly recordedFailures: Ref<number>
	readonly watchingMethods: Ref<{ readonly methods: number, readonly failed: number }>
	readonly unseen: Ref<number>
	readonly subscribed: Ref<{ readonly widgets: number, readonly events: number, readonly failed: number }>
	readonly listening: ComputedRef<EventLogListening>
	readonly emitters: ComputedRef<readonly EventEmitterWidget[]>
	/** How many consumers are mounted right now. */
	readonly consumers: Ref<number>
	/** How many of them are visible right now. */
	readonly viewers: Ref<number>
	readonly entries: ComputedRef<readonly EventLogItem[]>
	readonly dropped: ComputedRef<number>
	clear: () => void
}

const sources = new WeakMap<LabStore, SharedSource>()

function emittersOf(nodes: readonly InspectorBlueprintNode[]): readonly EventEmitterWidget[] {
	const found: EventEmitterWidget[] = []
	for (const node of nodes) {
		if (!node.resolved || node.widgetId === undefined || node.widgetType === undefined)
			continue
		const events = (node.events ?? []).map(event => event.name)
		if (events.length > 0)
			found.push({ nodeId: node.nodeId, widgetId: node.widgetId, widgetType: node.widgetType, events })
	}
	return found
}

function methodWidgetsOf(nodes: readonly InspectorBlueprintNode[]): readonly MethodWidget[] {
	const found: MethodWidget[] = []
	for (const node of nodes) {
		if (!node.resolved || node.widgetId === undefined || node.widgetType === undefined)
			continue
		const methods = (node.methods ?? []).map(method => method.name)
		if (methods.length > 0)
			found.push({ nodeId: node.nodeId, widgetId: node.widgetId, widgetType: node.widgetType, methods })
	}
	return found
}

function sharedSource(store: LabStore): SharedSource {
	const existing = sources.get(store)
	if (existing !== undefined)
		return existing

	// A scope of its own: the source belongs to the store, not to whichever panel asked first.
	const scope = effectScope(true)
	const source = scope.run((): SharedSource => {
		const connection = computed(() => store.previewHost.connection.value)
		// The connection that was current when the showcase last changed: it belongs to the previous showcase. A ref, so the
		// listening state and the subscriptions follow it when a refused switch leaves that connection current.
		const staleConnection = shallowRef<PreviewFrameConnection | null>(null)
		// The Preview error shown when the showcase last changed: only a different one says the frame refused the switch (the
		// coordinator clears an error only when a mount succeeds, so an earlier refusal may still be shown while it loads).
		// A refusal with the very same message as the earlier one cannot be told apart and reads as loading.
		let errorAtSwitch: string | null = null
		// What the log can show: nothing of the previous showcase, whose connection is still current until the new one mounts.
		const emitters = computed(() => connection.value === null || connection.value === staleConnection.value ? [] : emittersOf(connection.value.blueprint.nodes))
		const buffer = shallowRef<EventLogBuffer>(EMPTY_EVENT_LOG)
		const paused = shallowRef(false)
		const skippedWhilePaused = shallowRef(0)
		const skippedFailuresWhilePaused = shallowRef(0)
		const recordedFailures = shallowRef(0)
		const watchingMethods = shallowRef({ methods: 0, failed: 0 })
		const unseen = shallowRef(0)
		const subscribed = shallowRef({ widgets: 0, events: 0, failed: 0 })
		const consumers = shallowRef(0)
		const viewers = shallowRef(0)
		const active = computed(() => consumers.value > 0)
		let sequence = 0
		const listening = computed<EventLogListening>(() => {
			if (!active.value)
				return { state: 'off' }
			if (connection.value === null) {
				if (store.preview.value === null)
					return { state: 'no-preview' }
				return store.previewHost.error.value === null ? { state: 'loading' } : { state: 'lost' }
			}
			// Until the new showcase mounts, the previous one's connection is still current: loading, or, once the frame
			// refused the switch, the previous showcase.
			if (connection.value === staleConnection.value) {
				const error = store.previewHost.error.value
				return error === null || error === errorAtSwitch ? { state: 'loading' } : { state: 'previous-showcase' }
			}
			return emitters.value.length === 0 ? { state: 'no-events' } : { state: 'listening', ...subscribed.value }
		})

		function clear(): void {
			buffer.value = EMPTY_EVENT_LOG
			skippedWhilePaused.value = 0
			skippedFailuresWhilePaused.value = 0
			recordedFailures.value = 0
			unseen.value = 0
		}

		// Another showcase is another application: its widgets and Events have nothing to do with the recorded ones, and
		// its connection stays current until the new one has mounted, so what it still sends is not recorded either.
		watch(() => store.showcaseId.value, () => {
			clear()
			errorAtSwitch = store.previewHost.error.value
			staleConnection.value = connection.value
		}, { flush: 'sync' })

		// Looking at the log is seeing what it holds.
		watch(() => viewers.value > 0, (looking) => {
			if (looking)
				unseen.value = 0
		}, { flush: 'sync' })

		// A list of sources (not one getter returning a fresh array): only a real change of one of them re-subscribes.
		watch(
			[connection, active, staleConnection] as const,
			([current, isActive, stale], _previous, onCleanup) => {
				subscribed.value = { widgets: 0, events: 0, failed: 0 }
				watchingMethods.value = { methods: 0, failed: 0 }
				if (!isActive || current === null || current === stale)
					return
				const widgets = emittersOf(current.blueprint.nodes)
				const methodWidgets = methodWidgetsOf(current.blueprint.nodes)
				if (widgets.length === 0 && methodWidgets.length === 0)
					return

				const client = current.inspectorClient
				const targets = new Map<string, EventEmitterWidget & { readonly event: string }>()
				const methodTargets = new Map<string, MethodWidget & { readonly method: string }>()
				const held: string[] = []
				const heldMethods: string[] = []
				let live = true
				let failed = 0
				let methodsFailed = 0
				const report = (): void => {
					subscribed.value = { widgets: new Set([...targets.values()].map(target => target.nodeId)).size, events: targets.size, failed }
				}
				const reportMethods = (): void => {
					watchingMethods.value = { methods: methodTargets.size, failed: methodsFailed }
				}

				const stopListening = client.on('runtime.eventOccurred', (occurrence) => {
					if (!live || current === staleConnection.value)
						return
					const target = targets.get(occurrence.subscriptionId)
					if (target === undefined)
						return
					if (paused.value) {
						skippedWhilePaused.value += 1
						return
					}
					sequence += 1
					buffer.value = appendEventLogEntry(buffer.value, {
						kind: 'event',
						seq: sequence,
						at: Date.now(),
						revision: current.revision,
						runtimeId: current.runtimeId,
						nodeId: target.nodeId,
						widgetId: target.widgetId,
						widgetType: target.widgetType,
						event: target.event,
						args: occurrence.args,
					}, EVENT_LOG_LIMIT)
					if (viewers.value === 0)
						unseen.value += 1
				})

				// A Method's snapshot changed: only one that now holds diagnostics is a failure to record.
				const stopListeningToMethods = client.on('runtime.memberChanged', (change) => {
					if (!live || current === staleConnection.value || change.member.type !== 'method' || change.member.diagnostics.length === 0)
						return
					const target = methodTargets.get(change.subscriptionId)
					if (target === undefined)
						return
					if (paused.value) {
						skippedFailuresWhilePaused.value += 1
						return
					}
					sequence += 1
					recordedFailures.value += 1
					buffer.value = appendEventLogEntry(buffer.value, {
						kind: 'method-failure',
						seq: sequence,
						at: Date.now(),
						revision: current.revision,
						runtimeId: current.runtimeId,
						nodeId: target.nodeId,
						widgetId: target.widgetId,
						widgetType: target.widgetType,
						method: target.method,
						diagnostics: change.member.diagnostics,
					}, EVENT_LOG_LIMIT)
					if (viewers.value === 0)
						unseen.value += 1
				})

				const releaseMethod = (subscriptionId: string): void => {
					void client.request('runtime.unsubscribeMember', { subscriptionId })
						.catch(() => {})
				}

				const release = (subscriptionId: string): void => {
					// The connection may already be closed (a replaced Preview), or its Agent gone while the client lives on
					// (an Apply): nothing is left to release then, and a refusal is not worth reporting.
					void client.request('runtime.unsubscribeEvent', { subscriptionId })
						.catch(() => {})
				}

				onCleanup(() => {
					live = false
					stopListening()
					stopListeningToMethods()
					for (const subscriptionId of held)
						release(subscriptionId)
					held.length = 0
					targets.clear()
					for (const subscriptionId of heldMethods)
						releaseMethod(subscriptionId)
					heldMethods.length = 0
					methodTargets.clear()
				})

				for (const widget of widgets) {
					for (const event of widget.events) {
						void client.request('runtime.subscribeEvent', { ref: { runtimeId: current.runtimeId, nodeId: widget.nodeId }, event })
							.then((result) => {
								if (!live) {
									// Replaced or unmounted while the request was in flight: release it at once.
									release(result.subscriptionId)
									return
								}
								held.push(result.subscriptionId)
								targets.set(result.subscriptionId, { ...widget, event })
								report()
							})
							.catch(() => {
								if (!live)
									return
								failed += 1
								report()
							})
					}
				}

				for (const widget of methodWidgets) {
					for (const method of widget.methods) {
						void client.request('runtime.subscribeMember', { ref: { runtimeId: current.runtimeId, nodeId: widget.nodeId }, member: { type: 'method', name: method } })
							.then((result) => {
								if (!live) {
									releaseMethod(result.subscriptionId)
									return
								}
								heldMethods.push(result.subscriptionId)
								methodTargets.set(result.subscriptionId, { ...widget, method })
								reportMethods()
							})
							.catch(() => {
								if (!live)
									return
								methodsFailed += 1
								reportMethods()
							})
					}
				}
			},
			{ immediate: true },
		)

		return {
			buffer,
			paused,
			skippedWhilePaused,
			skippedFailuresWhilePaused,
			recordedFailures,
			watchingMethods,
			unseen,
			subscribed,
			listening,
			emitters,
			consumers,
			viewers,
			entries: computed(() => buffer.value.entries),
			dropped: computed(() => buffer.value.dropped),
			clear,
		}
	})!
	sources.set(store, source)
	return source
}

/**
 * What the tab that labels the Events panel shows: entries recorded while the panel was not visible, and whether the
 * log is subscribed to something (the panel's own DOM is not in the page while its tab is hidden, so the tab is where a
 * hidden log can be told to be ready). Reading is not consuming: it subscribes to nothing and keeps nothing alive.
 */
export function useEventLogTabState(): { readonly unseen: Readonly<Ref<number>>, readonly recording: ComputedRef<boolean> } {
	const source = sharedSource(useLabStore())
	return {
		unseen: source.unseen,
		recording: computed(() => (source.listening.value.state === 'listening' && source.listening.value.events > 0) || source.watchingMethods.value.methods > 0),
	}
}

/**
 * The shared log. Calling it makes the caller a mounted consumer (the log records while one exists); `visible` says
 * whether the caller can be seen, which is what "seen" means for the unseen count.
 */
export function useEventLog(visible: Readonly<Ref<boolean>> = shallowRef(true)): EventLog {
	const source = sharedSource(useLabStore())

	source.consumers.value += 1
	let counted = false
	const stopCounting = watch(visible, (isVisible) => {
		if (isVisible === counted)
			return
		counted = isVisible
		source.viewers.value += isVisible ? 1 : -1
	}, { immediate: true, flush: 'sync' })
	onScopeDispose(() => {
		stopCounting()
		if (counted)
			source.viewers.value -= 1
		counted = false
		source.consumers.value -= 1
	})

	return {
		entries: source.entries,
		dropped: source.dropped,
		skippedWhilePaused: source.skippedWhilePaused,
		skippedFailuresWhilePaused: source.skippedFailuresWhilePaused,
		recordedFailures: source.recordedFailures,
		watchingMethods: source.watchingMethods,
		unseen: source.unseen,
		paused: source.paused,
		listening: source.listening,
		emitters: source.emitters,
		setPaused: (value) => {
			source.paused.value = value
		},
		clear: source.clear,
	}
}
