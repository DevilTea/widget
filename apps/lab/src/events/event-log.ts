/**
 * The Events log's data model (issue #230, audit U09): one entry per Event occurrence the Preview Runtime reported
 * through the Inspector protocol (`runtime.eventOccurred`), a bounded buffer for them, and the filters the panel
 * offers. Framework-free so it can be tested without a browser. Nothing here touches a Core Runtime: arguments are
 * the Inspector's bounded `InspectableValue` DTOs, exactly as they arrived.
 */

import type { InspectableValue } from '@deviltea/widget-inspector/value'

/** How many entries the log keeps; older ones are dropped (and counted) when a newer one arrives. */
export const EVENT_LOG_LIMIT = 500

export interface EventLogEntry {
	/** Increases by one per recorded occurrence, for the whole Lab session; a stable list key. */
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
	readonly event: string
	/** The emitted arguments as the Inspector snapshot sent them (bounded, JSON-safe). */
	readonly args: readonly InspectableValue[]
}

export interface EventLogBuffer {
	readonly entries: readonly EventLogEntry[]
	/** How many entries were dropped because the buffer was full, since it was last cleared. */
	readonly dropped: number
}

export const EMPTY_EVENT_LOG: EventLogBuffer = Object.freeze({ entries: [], dropped: 0 })

/** The buffer with `entry` added at the end; when it would exceed `limit` the oldest entries are dropped and counted. */
export function appendEventLogEntry(buffer: EventLogBuffer, entry: EventLogEntry, limit: number = EVENT_LOG_LIMIT): EventLogBuffer {
	const entries = [...buffer.entries, entry]
	const overflow = Math.max(0, entries.length - limit)
	return overflow === 0
		? { entries, dropped: buffer.dropped }
		: { entries: entries.slice(overflow), dropped: buffer.dropped + overflow }
}

export interface EventLogFilter {
	/** Only this widget id; `null` for all widgets. */
	readonly widgetId: string | null
	/** Only this Event name; `null` for all Events. */
	readonly event: string | null
	/** Only the widget selected in the Preview (its id); `null` when the option is off. */
	readonly selectedWidgetId: string | null
}

export const NO_EVENT_FILTER: EventLogFilter = Object.freeze({ widgetId: null, event: null, selectedWidgetId: null })

export function matchesEventFilter(entry: EventLogEntry, filter: EventLogFilter): boolean {
	return (filter.widgetId === null || entry.widgetId === filter.widgetId)
		&& (filter.event === null || entry.event === filter.event)
		&& (filter.selectedWidgetId === null || entry.widgetId === filter.selectedWidgetId)
}

/** Newest first, as the panel lists them. */
export function visibleEventLogEntries(entries: readonly EventLogEntry[], filter: EventLogFilter): readonly EventLogEntry[] {
	const matching: EventLogEntry[] = []
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
