import { describe, expect, it } from 'vitest'
import { decideDeterministicStart } from './deterministic-start'

describe('decideDeterministicStart', () => {
	it('requires confirmation when the current draft is dirty', () => {
		expect(decideDeterministicStart({ isDirty: true, hasCommittedEdits: false, switchesShowcase: false }))
			.toEqual({ needsConfirmation: true, discardsEdits: false })
	})

	it('does not require confirmation when the current draft is not dirty', () => {
		expect(decideDeterministicStart({ isDirty: false, hasCommittedEdits: false, switchesShowcase: false }))
			.toEqual({ needsConfirmation: false, discardsEdits: false })
	})

	it('does not ask about committed edits on the tour\'s own showcase: the preset reload can be undone', () => {
		expect(decideDeterministicStart({ isDirty: false, hasCommittedEdits: true, switchesShowcase: false }))
			.toEqual({ needsConfirmation: false, discardsEdits: false })
	})

	it('asks about committed edits when the start switches showcase, which Undo cannot take back', () => {
		expect(decideDeterministicStart({ isDirty: false, hasCommittedEdits: true, switchesShowcase: true }))
			.toEqual({ needsConfirmation: true, discardsEdits: true })
		expect(decideDeterministicStart({ isDirty: true, hasCommittedEdits: true, switchesShowcase: true }))
			.toEqual({ needsConfirmation: true, discardsEdits: true })
	})
})
