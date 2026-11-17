import { describe, expect, it } from 'vitest'
import { deriveExampleState } from './example'

const presets = [
	{ id: 'default', sourceText: '{ "a": 1 }\n' },
	{ id: 'other', sourceText: '{ "a": 2 }\n' },
]

describe('deriveExampleState', () => {
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

	it('is edited when the preset is unknown or none was loaded, and names it again once the source matches', () => {
		expect(deriveExampleState({ loadedPresetId: null, presets, appliedSourceText: '{ "a": 1 }\n', isDirty: false }))
			.toEqual({ kind: 'edited' })
		expect(deriveExampleState({ loadedPresetId: 'gone', presets, appliedSourceText: '{ "a": 1 }\n', isDirty: false }))
			.toEqual({ kind: 'edited' })
		expect(deriveExampleState({ loadedPresetId: 'default', presets, appliedSourceText: '{ "a": 1 }\n', isDirty: false }))
			.toEqual({ kind: 'preset', preset: presets[0] })
	})
})
