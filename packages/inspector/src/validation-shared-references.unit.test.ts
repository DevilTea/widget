import { describe, expect, it } from 'vitest'
import { isInspectableValue } from './validation'

const LEVELS = 60

/**
 * A chain of `levels` diamonds: every level references the level below it twice, as structured clone
 * preserves shared references. Walking it as a tree takes 2^levels steps, so the test counts how often
 * each distinct object's children are read instead of timing anything.
 */
function createDiamond(levels: number, leaf: object, read: () => void): object {
	let node: object = leaf
	for (let level = 0; level < levels; level++) {
		const below = node
		node = {
			type: 'object',
			id: level,
			truncated: false,
			get entries() {
				read()
				return [{ key: 'l', value: below }, { key: 'r', value: below }]
			},
		}
	}
	return node
}

describe('validation of shared references', () => {
	it('validates each distinct InspectableValue node once, however often it is shared', () => {
		let reads = 0
		const value = createDiamond(LEVELS, { type: 'null' }, () => reads++)

		expect(isInspectableValue(value))
			.toBe(true)
		// A few `entries` reads per distinct node (shape check, length, iteration), never 2^LEVELS.
		expect(reads)
			.toBeLessThanOrEqual(4 * LEVELS)
	})

	it('still rejects a cyclic InspectableValue and an invalid node reached through shared references', () => {
		const cyclic: Record<string, unknown> = { type: 'object', id: 1, truncated: false, entries: [] }
		;(cyclic.entries as unknown[]).push({ key: 'self', value: cyclic })
		expect(isInspectableValue(cyclic))
			.toBe(false)

		const bad = { type: 'number', value: Number.NaN }
		expect(isInspectableValue({
			type: 'object',
			id: 1,
			truncated: false,
			entries: [{ key: 'l', value: bad }, { key: 'r', value: bad }],
		}))
			.toBe(false)
	})
})
