/**
 * The live Events log (issue #230, audit U09): subscribes over the Inspector protocol to every Event the Preview
 * Runtime's widgets declare (`runtime.subscribeEvent`, answered by `runtime.eventOccurred`) and keeps the occurrences in
 * a bounded buffer. Like the shared Runtime snapshot source it is one source per store, not one per panel:
 *
 * - subscriptions exist only while a consumer says it is visible (a hidden Dockview tab stays mounted, so the panel
 *   passes `usePanelVisibility`), and every one is released when the panel hides, the connection is replaced (Apply,
 *   a retry, a showcase switch, a Preview remount) or the store goes away;
 * - a new connection is a new Runtime with new node ids, so subscriptions are made again from that connection's
 *   Blueprint snapshot; entries already recorded stay, tagged with the revision that emitted them;
 * - switching showcase clears the buffer: those entries describe widgets of another application;
 * - Core delivers only future occurrences (no replay), so what happens while the panel is hidden is not recorded.
 *
 * Read-only: the Inspector has no emit authority and neither has this module.
 */
import type { InspectorBlueprintNode } from '@deviltea/widget-inspector/protocol'
import type { ComputedRef, Ref } from 'vue'
import type { EventLogBuffer, EventLogEntry } from '../events/event-log'
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

export type EventLogListening
	/** No panel is visible, so nothing is subscribed. */
	= | { readonly state: 'off' }
	/** There is no Preview Runtime to listen to. */
		| { readonly state: 'no-preview' }
	/** The Preview Runtime's widgets declare no Events at all. */
		| { readonly state: 'no-events' }
		| { readonly state: 'listening', readonly widgets: number, readonly events: number, readonly failed: number }

export interface EventLog {
	readonly entries: Readonly<Ref<readonly EventLogEntry[]>>
	/** Entries dropped because the buffer was full, since the log was last cleared. */
	readonly dropped: Readonly<Ref<number>>
	/** Occurrences that arrived while the log was paused and were therefore not recorded. */
	readonly skippedWhilePaused: Readonly<Ref<number>>
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
	readonly listening: Ref<EventLogListening>
	readonly emitters: ComputedRef<readonly EventEmitterWidget[]>
	readonly visibleConsumers: Ref<number>
	readonly entries: ComputedRef<readonly EventLogEntry[]>
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

function sharedSource(store: LabStore): SharedSource {
	const existing = sources.get(store)
	if (existing !== undefined)
		return existing

	// A scope of its own: the source belongs to the store, not to whichever panel asked first.
	const scope = effectScope(true)
	const source = scope.run((): SharedSource => {
		const connection = computed(() => store.previewHost.connection.value)
		const emitters = computed(() => emittersOf(connection.value?.blueprint.nodes ?? []))
		const buffer = shallowRef<EventLogBuffer>(EMPTY_EVENT_LOG)
		const paused = shallowRef(false)
		const skippedWhilePaused = shallowRef(0)
		const listening = shallowRef<EventLogListening>({ state: 'off' })
		const visibleConsumers = shallowRef(0)
		const anyVisible = computed(() => visibleConsumers.value > 0)
		let sequence = 0

		function clear(): void {
			buffer.value = EMPTY_EVENT_LOG
			skippedWhilePaused.value = 0
		}

		// Another showcase is another application: its widgets and Events have nothing to do with the recorded ones.
		watch(() => store.showcaseId.value, clear)

		// A list of sources (not one getter returning a fresh array): only a real change of one of them re-subscribes.
		watch(
			[connection, anyVisible] as const,
			([current, active], _previous, onCleanup) => {
				if (!active) {
					listening.value = { state: 'off' }
					return
				}
				if (current === null) {
					listening.value = { state: 'no-preview' }
					return
				}
				const widgets = emittersOf(current.blueprint.nodes)
				if (widgets.length === 0) {
					listening.value = { state: 'no-events' }
					return
				}

				const client = current.inspectorClient
				const targets = new Map<string, EventEmitterWidget & { readonly event: string }>()
				const subscribed: string[] = []
				let live = true
				let failed = 0
				const report = (): void => {
					listening.value = { state: 'listening', widgets: new Set([...targets.values()].map(target => target.nodeId)).size, events: targets.size, failed }
				}
				listening.value = { state: 'listening', widgets: 0, events: 0, failed: 0 }

				const stopListening = client.on('runtime.eventOccurred', (occurrence) => {
					if (!live)
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
				})

				const release = (subscriptionId: string): void => {
					// The connection may already be closed (a replaced Preview): nothing is left to release then.
					void client.request('runtime.unsubscribeEvent', { subscriptionId })
						.catch(() => {})
				}

				onCleanup(() => {
					live = false
					stopListening()
					for (const subscriptionId of subscribed)
						release(subscriptionId)
					subscribed.length = 0
					targets.clear()
				})

				for (const widget of widgets) {
					for (const event of widget.events) {
						void client.request('runtime.subscribeEvent', { ref: { runtimeId: current.runtimeId, nodeId: widget.nodeId }, event })
							.then((result) => {
								if (!live) {
									// Replaced or hidden while the request was in flight: release it at once.
									release(result.subscriptionId)
									return
								}
								subscribed.push(result.subscriptionId)
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
			},
			{ immediate: true },
		)

		return {
			buffer,
			paused,
			skippedWhilePaused,
			listening,
			emitters,
			visibleConsumers,
			entries: computed(() => buffer.value.entries),
			dropped: computed(() => buffer.value.dropped),
			clear,
		}
	})!
	sources.set(store, source)
	return source
}

/** `visible`: whether the calling panel can be seen; the Runtime is listened to while any caller can be seen. */
export function useEventLog(visible: Readonly<Ref<boolean>> = shallowRef(true)): EventLog {
	const source = sharedSource(useLabStore())

	let counted = false
	const stopCounting = watch(visible, (isVisible) => {
		if (isVisible === counted)
			return
		counted = isVisible
		source.visibleConsumers.value += isVisible ? 1 : -1
	}, { immediate: true, flush: 'sync' })
	onScopeDispose(() => {
		stopCounting()
		if (counted)
			source.visibleConsumers.value -= 1
		counted = false
	})

	return {
		entries: source.entries,
		dropped: source.dropped,
		skippedWhilePaused: source.skippedWhilePaused,
		paused: source.paused,
		listening: source.listening,
		emitters: source.emitters,
		setPaused: (value) => {
			source.paused.value = value
		},
		clear: source.clear,
	}
}
