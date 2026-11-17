/**
 * The Events log's data model (issue #230, audit U09): one entry per Event occurrence the Preview Runtime reported
 * through the Inspector protocol (`runtime.eventOccurred`) and, from protocol 0.5 (issue #230, audit U08), one per
 * Method whose latest diagnostic snapshot became non-empty (`runtime.memberChanged` of a Method member), in one bounded
 * buffer, and the filters the panel offers. Framework-free so it can be tested without a browser. Nothing here touches a Core Runtime: arguments are
 * the Inspector's bounded `InspectableValue` DTOs, exactly as they arrived.
 */

import type { InspectorRuntimeDiagnostic } from '@deviltea/widget-inspector/protocol'
import type { InspectableValue } from '@deviltea/widget-inspector/value'

/** How many entries the log keeps; older ones are dropped (and counted) when a newer one arrives. */
export const EVENT_LOG_LIMIT = 500

interface EventLogEntryBase {
	/** Increases by one per recorded entry, for the whole Lab session; a stable list key. */
	readonly seq: number
	/** When the Lab received the occurrence (`Date.now()`): the protocol carries no timestamp of its own. */
	readonly at: number
	/** The Preview revision whose Runtime emitted it. */
	readonly revision: number
	readonly runtimeId: string
	/** The emitting widget's node id inside that Runtime's Inspector Blueprint snapshot (not stable across revisions). */
	readonly nodeId: number
	readonly widgetId: string
	readonly widgetType: string
}

/** An Event occurrence. */
export interface EventLogEntry extends EventLogEntryBase {
	readonly kind: 'event'
	readonly event: string
	/** The emitted arguments as the Inspector snapshot sent them (bounded, JSON-safe). */
	readonly args: readonly InspectableValue[]
}

/**
 * A Method failure: the Method's diagnostic snapshot after a call that returned with diagnostics. It is a fact about the
 * Method's latest returned call (Core keeps no history), not a call log: changes inside one Runtime call can arrive as one
 * entry carrying the final snapshot, and a call that threw records nothing.
 */
export interface MethodFailureEntry extends EventLogEntryBase {
	readonly kind: 'method-failure'
	readonly method: string
	/** The Method's whole snapshot as the Inspector sent it (never empty). */
	readonly diagnostics: readonly InspectorRuntimeDiagnostic[]
}

export type EventLogItem = EventLogEntry | MethodFailureEntry

export interface EventLogBuffer {
	readonly entries: readonly EventLogItem[]
	/** How many entries were dropped because the buffer was full, since it was last cleared. */
	readonly dropped: number
}

export const EMPTY_EVENT_LOG: EventLogBuffer = Object.freeze({ entries: [], dropped: 0 })

/** The buffer with `entry` added at the end; when it would exceed `limit` the oldest entries are dropped and counted. */
export function appendEventLogEntry(buffer: EventLogBuffer, entry: EventLogItem, limit: number = EVENT_LOG_LIMIT): EventLogBuffer {
	const entries = [...buffer.entries, entry]
	const overflow = Math.max(0, entries.length - limit)
	return overflow === 0
		? { entries, dropped: buffer.dropped }
		: { entries: entries.slice(overflow), dropped: buffer.dropped + overflow }
}

/** A widget as the log identifies it: id and type (an id alone could be another widget after an Apply). */
export interface WidgetIdentity {
	readonly widgetId: string
	readonly widgetType: string
}

/** Which kinds of entry to show. */
export type EventLogKindFilter = 'all' | 'events' | 'method-failures'

export interface EventLogFilter {
	/** Only this widget id; `null` for all widgets. */
	readonly widgetId: string | null
	/** Only this Event name (Method failures are not Events and never match); `null` for all Events. */
	readonly event: string | null
	/** Only Event occurrences, only Method failures, or both. */
	readonly kind: EventLogKindFilter
	/** `true`: only `selectedWidget`; with no widget selected (`null`) nothing matches. */
	readonly onlySelected: boolean
	/** The widget selected in the Preview, when there is one. */
	readonly selectedWidget: WidgetIdentity | null
}

export const NO_EVENT_FILTER: EventLogFilter = Object.freeze({ widgetId: null, event: null, kind: 'all', onlySelected: false, selectedWidget: null })

export function isSameWidget(entry: WidgetIdentity, widget: WidgetIdentity | null): boolean {
	return widget !== null && entry.widgetId === widget.widgetId && entry.widgetType === widget.widgetType
}

export function matchesEventFilter(entry: EventLogItem, filter: EventLogFilter): boolean {
	return (filter.widgetId === null || entry.widgetId === filter.widgetId)
		&& (filter.event === null || (entry.kind === 'event' && entry.event === filter.event))
		&& (filter.kind === 'all' || (filter.kind === 'events') === (entry.kind === 'event'))
		&& (!filter.onlySelected || isSameWidget(entry, filter.selectedWidget))
}

/** Newest first, as the panel lists them. */
export function visibleEventLogEntries(entries: readonly EventLogItem[], filter: EventLogFilter): readonly EventLogItem[] {
	const matching: EventLogItem[] = []
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]!
		if (matchesEventFilter(entry, filter))
			matching.push(entry)
	}
	return matching
}

function pad(value: number, width: number): string {
	return String(value)
		.padStart(width, '0')
}

/** `HH:MM:SS.mmm` in local time. */
export function formatEventTime(at: number): string {
	const date = new Date(at)
	return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
}
