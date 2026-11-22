import { describe, expect, it } from 'vitest'
import { deriveExampleState } from './example'

const presets = [
	{ id: 'default', sourceText: '{ "a": 1 }\n' },
	{ id: 'other', sourceText: '{ "a": 2 }\n' },
]

describe('deriveExampleState', () => {
	it('still names the preset after Format + Apply: whitespace and key order are not edits (Lab UX phase 2)', () => {
		const formatted = [{ id: 'p', sourceText: '{"b":[1,2],"a":{"x":true}}' }]
		expect(deriveExampleState({ loadedPresetId: 'p', presets: formatted, appliedSourceText: '{\n  "a": { "x": true },\n  "b": [1, 2]\n}\n', isDirty: false }))
			.toEqual({ kind: 'preset', preset: formatted[0] })
		// Array order is content.
		expect(deriveExampleState({ loadedPresetId: 'p', presets: formatted, appliedSourceText: '{"a":{"x":true},"b":[2,1]}', isDirty: false }))
			.toEqual({ kind: 'edited' })
	})

	it('names the loaded preset while the applied source is exactly its text and nothing is unapplied', () => {
		expect(deriveExampleState({ loadedPresetId: 'other', presets, appliedSourceText: '{ "a": 2 }\n', isDirty: false }))
			.toEqual({ kind: 'preset', preset: presets[1] })
	})

	it('is edited once the applied source differs from the preset (JSON Apply, Structure commit, Undo)', () => {
		expect(deriveExampleState({ loadedPresetId: 'default', presets, appliedSourceText: '{ "a": 3 }\n', isDirty: false }))
			.toEqual({ kind: 'edited' })
	})

	it('is edited while the editor holds an unapplied draft', () => {
		expect(deriveExampleState({ loadedPresetId: 'default', presets, appliedSourceText: '{ "a": 1 }\n', isDirty: true }))
			.toEqual({ kind: 'edited' })
	})

	it('is edited when no preset matches, and names the preset again once the source matches', () => {
		expect(deriveExampleState({ loadedPresetId: null, presets, appliedSourceText: '{ "a": 3 }\n', isDirty: false }))
			.toEqual({ kind: 'edited' })
		expect(deriveExampleState({ loadedPresetId: 'gone', presets, appliedSourceText: '{ "a": 3 }\n', isDirty: false }))
			.toEqual({ kind: 'edited' })
		expect(deriveExampleState({ loadedPresetId: 'default', presets, appliedSourceText: '{ "a": 1 }\n', isDirty: false }))
			.toEqual({ kind: 'preset', preset: presets[0] })
	})

	it('names another preset of the showcase when the source equals it exactly (Undo back to the default)', () => {
		expect(deriveExampleState({ loadedPresetId: 'other', presets, appliedSourceText: '{ "a": 1 }\n', isDirty: false }))
			.toEqual({ kind: 'preset', preset: presets[0] })
		expect(deriveExampleState({ loadedPresetId: null, presets, appliedSourceText: '{ "a": 2 }\n', isDirty: false }))
			.toEqual({ kind: 'preset', preset: presets[1] })
	})
})
