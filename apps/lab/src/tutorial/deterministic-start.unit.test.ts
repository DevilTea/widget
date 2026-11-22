import { describe, expect, it } from 'vitest'
import { decideDeterministicStart } from './deterministic-start'

describe('decideDeterministicStart', () => {
	it('requires confirmation when the current draft is dirty', () => {
		expect(decideDeterministicStart({ isDirty: true, hasCommittedEdits: false, switchesShowcase: false }))
			.toEqual({ needsConfirmation: true, loss: 'draft' })
	})

	it('does not require confirmation when the current draft is not dirty', () => {
		expect(decideDeterministicStart({ isDirty: false, hasCommittedEdits: false, switchesShowcase: false }))
			.toEqual({ needsConfirmation: false, loss: 'none' })
	})

	it('does not ask about committed edits on the tour\'s own showcase: the preset reload can be undone', () => {
		expect(decideDeterministicStart({ isDirty: false, hasCommittedEdits: true, switchesShowcase: false }))
			.toEqual({ needsConfirmation: false, loss: 'none' })
	})

	it('asks about committed edits when the start switches showcase, which Undo cannot take back', () => {
		expect(decideDeterministicStart({ isDirty: false, hasCommittedEdits: true, switchesShowcase: true }))
			.toEqual({ needsConfirmation: true, loss: 'edits' })
		expect(decideDeterministicStart({ isDirty: true, hasCommittedEdits: true, switchesShowcase: true }))
			.toEqual({ needsConfirmation: true, loss: 'draft-and-edits' })
	})
})
