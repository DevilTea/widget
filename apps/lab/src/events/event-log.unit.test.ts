import type { EventLogBuffer, EventLogEntry } from './event-log'
import { describe, expect, it } from 'vitest'
import { appendEventLogEntry, EMPTY_EVENT_LOG, EVENT_LOG_LIMIT, formatEventTime, isSameWidget, NO_EVENT_FILTER, visibleEventLogEntries } from './event-log'

function entry(seq: number, overrides: Partial<EventLogEntry> = {}): EventLogEntry {
	return { seq, at: 0, revision: 1, runtimeId: 'r', nodeId: 1, widgetId: 'form', widgetType: 'Survey', event: 'submitted', args: [], ...overrides }
}

describe('event log buffer', () => {
	it('keeps the newest entries and counts the dropped ones when the buffer is full', () => {
		let buffer: EventLogBuffer = EMPTY_EVENT_LOG
		for (let seq = 1; seq <= EVENT_LOG_LIMIT + 7; seq++)
			buffer = appendEventLogEntry(buffer, entry(seq))
		expect(buffer.entries)
			.toHaveLength(EVENT_LOG_LIMIT)
		expect(buffer.entries[0]!.seq)
			.toBe(8)
		expect(buffer.entries.at(-1)!.seq)
			.toBe(EVENT_LOG_LIMIT + 7)
		expect(buffer.dropped)
			.toBe(7)
	})

	it('drops nothing below the limit and does not change the buffer it was given', () => {
		const first = appendEventLogEntry(EMPTY_EVENT_LOG, entry(1))
		const second = appendEventLogEntry(first, entry(2), 2)
		expect(first.entries)
			.toHaveLength(1)
		expect(second)
			.toMatchObject({ dropped: 0 })
		expect(second.entries.map(item => item.seq))
			.toEqual([1, 2])
		expect(appendEventLogEntry(second, entry(3), 2))
			.toMatchObject({ dropped: 1 })
	})
})

describe('event log filter', () => {
	const entries = [
		entry(1, { widgetId: 'a', event: 'opened' }),
		entry(2, { widgetId: 'b', event: 'submitted' }),
		entry(3, { widgetId: 'a', event: 'submitted' }),
	]

	it('lists the newest first and everything without a filter', () => {
		expect(visibleEventLogEntries(entries, NO_EVENT_FILTER)
			.map(item => item.seq))
			.toEqual([3, 2, 1])
	})

	it('filters by widget, by Event name and by the selected widget (id and type), all together', () => {
		const seqs = (filter: Partial<typeof NO_EVENT_FILTER>): number[] => visibleEventLogEntries(entries, { ...NO_EVENT_FILTER, ...filter })
			.map(item => item.seq)
		const selected = (widgetId: string, widgetType = 'Survey') => ({ onlySelected: true, selectedWidget: { widgetId, widgetType } })
		expect(seqs({ widgetId: 'a' }))
			.toEqual([3, 1])
		expect(seqs({ event: 'submitted' }))
			.toEqual([3, 2])
		expect(seqs(selected('b')))
			.toEqual([2])
		expect(seqs({ widgetId: 'a', event: 'submitted' }))
			.toEqual([3])
		expect(seqs({ widgetId: 'a', ...selected('b') }))
			.toEqual([])
		// A selection is remembered by the panel, but only matters while the option is on.
		expect(seqs({ onlySelected: false, selectedWidget: { widgetId: 'b', widgetType: 'Survey' } }))
			.toEqual([3, 2, 1])
		// Nothing selected: nothing matches.
		expect(seqs({ onlySelected: true, selectedWidget: null }))
			.toEqual([])
	})

	it('does not take another widget for the selected one when only the id is the same', () => {
		const mixed = [entry(1, { widgetId: 'a', widgetType: 'Survey' }), entry(2, { widgetId: 'a', widgetType: 'Numeric' })]
		expect(visibleEventLogEntries(mixed, { ...NO_EVENT_FILTER, onlySelected: true, selectedWidget: { widgetId: 'a', widgetType: 'Numeric' } })
			.map(item => item.seq))
			.toEqual([2])
		expect(isSameWidget(mixed[0]!, { widgetId: 'a', widgetType: 'Numeric' }))
			.toBe(false)
		expect(isSameWidget(mixed[0]!, null))
			.toBe(false)
	})
})

describe('formatEventTime', () => {
	it('formats local time with milliseconds', () => {
		const date = new Date(2026, 0, 2, 3, 4, 5, 6)
		expect(formatEventTime(date.getTime()))
			.toBe('03:04:05.006')
	})
})
