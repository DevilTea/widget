import { describe, expect, it } from 'vitest'
import { isBlueprintNode, isInspectableValue } from './validation'

const LEVELS = 60

/**
 * A chain of `levels` diamonds: every level references the level below it twice, as structured clone
 * preserves shared references. Walking it as a tree takes 2^levels steps, so the test counts how often
 * each distinct object's children are read instead of timing anything.
 */
function createDiamond(levels: number, leaf: object, key: 'l' | 'entries', read: () => void): object {
	let node: object = leaf
	for (let level = 0; level < levels; level++) {
		const below = node
		node = key === 'l'
			? {
					get l() {
						read()
						return below
					},
					get r() {
						read()
						return below
					},
				}
			: {
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

function blueprintNodeWithSchema(schema: object) {
	return {
		nodeId: 0,
		resolved: true,
		widgetId: 'w',
		widgetType: 't',
		capabilities: { config: true, slots: false, state: false, properties: false, methods: false, events: false },
		config: { description: 'd', schema },
		sourceSlots: [],
		semanticSlots: [],
		state: [],
		properties: [],
		methods: [],
		events: [],
		diagnostics: [],
	}
}

describe('validation of shared references', () => {
	it('validates each distinct JSON object of a config schema once, however often it is shared', () => {
		let reads = 0
		const schema = createDiamond(LEVELS, { type: 'string' }, 'l', () => reads++)

		expect(isBlueprintNode(blueprintNodeWithSchema(schema), 4))
			.toBe(true)
		// Two child reads per distinct object (Object.values reads both once), never 2^LEVELS.
		expect(reads)
			.toBeLessThanOrEqual(2 * LEVELS)
	})

	it('still rejects a cycle and a bad value reachable through shared references', () => {
		const cyclic: Record<string, unknown> = { a: 1 }
		cyclic.self = cyclic
		expect(isBlueprintNode(blueprintNodeWithSchema(cyclic), 4))
			.toBe(false)

		const shared = { bad: Number.NaN }
		expect(isBlueprintNode(blueprintNodeWithSchema({ l: shared, r: shared }), 4))
			.toBe(false)
		expect(isBlueprintNode(blueprintNodeWithSchema({ l: { ok: 1 }, r: { ok: 1 } }), 4))
			.toBe(true)
	})

	it('validates each distinct InspectableValue node once, however often it is shared', () => {
		let reads = 0
		const value = createDiamond(LEVELS, { type: 'null' }, 'entries', () => reads++)

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
