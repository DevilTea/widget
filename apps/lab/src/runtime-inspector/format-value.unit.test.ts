import type { InspectableValue } from '@deviltea/widget-inspector/value'
import { describe, expect, it } from 'vitest'
import { describeContainer, formatInspectableValue, hasTruncation, isExpandableValue } from './format-value'

const num = (value: number): InspectableValue => ({ type: 'number', value })
const str = (value: string, truncated = false): InspectableValue => ({ type: 'string', value, truncated })
const arr = (items: InspectableValue[], truncated = false): InspectableValue => ({ type: 'array', id: 1, items, truncated })
function obj(entries: Record<string, InspectableValue>, truncated = false): InspectableValue {
	return {
		type: 'object',
		id: 2,
		entries: Object.entries(entries)
			.map(([key, value]) => ({ key, value })),
		truncated,
	}
}
const depthCut: InspectableValue = { type: 'truncated', reason: 'max-depth' }

describe('hasTruncation', () => {
	it('is false for complete values', () => {
		expect(hasTruncation(obj({ a: arr([num(1), str('x')]), b: { type: 'null' } })))
			.toBe(false)
	})

	it('finds a depth cut anywhere inside', () => {
		expect(hasTruncation(obj({ a: arr([obj({ b: depthCut })]) })))
			.toBe(true)
	})

	it('finds a container cut at its entry budget and a string cut at its length limit', () => {
		expect(hasTruncation(arr([num(1)], true)))
			.toBe(true)
		expect(hasTruncation(obj({ a: num(1) }, true)))
			.toBe(true)
		expect(hasTruncation(obj({ a: str('x', true) })))
			.toBe(true)
	})

	it('finds a cut object key', () => {
		expect(hasTruncation({ type: 'object', id: 1, truncated: false, entries: [{ key: 'k', keyTruncated: true, value: num(1) }] }))
			.toBe(true)
	})
})

describe('isExpandableValue', () => {
	it('opens containers, long strings and cut strings only', () => {
		expect(isExpandableValue(arr([])))
			.toBe(true)
		expect(isExpandableValue(obj({})))
			.toBe(true)
		expect(isExpandableValue(str('x'.repeat(41))))
			.toBe(true)
		expect(isExpandableValue(str('short', true)))
			.toBe(true)
		expect(isExpandableValue(str('x'.repeat(40))))
			.toBe(false)
		expect(isExpandableValue(num(3)))
			.toBe(false)
		expect(isExpandableValue({ type: 'null' }))
			.toBe(false)
	})
})

describe('describeContainer', () => {
	it('counts entries and marks a cut container with a plus', () => {
		expect(describeContainer(arr([num(1), num(2)]) as never))
			.toBe('Array(2)')
		expect(describeContainer(obj({ a: num(1) }, true) as never))
			.toBe('Object {1+}')
	})
})

describe('formatInspectableValue (unchanged one-line summary)', () => {
	it('still renders a depth cut as <truncated>', () => {
		expect(formatInspectableValue(obj({ errors: arr([depthCut]) })))
			.toBe('{ "errors": [<truncated>] }')
	})
})
