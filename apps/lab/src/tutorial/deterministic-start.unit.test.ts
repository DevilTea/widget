import { describe, expect, it } from 'vitest'
import { decideDeterministicStart } from './deterministic-start'

describe('decideDeterministicStart', () => {
	it('requires confirmation while the JSON text does not parse', () => {
		expect(decideDeterministicStart({ jsonSyntaxError: true, hasCommittedEdits: false, switchesShowcase: false }))
			.toEqual({ needsConfirmation: true, loss: 'draft' })
	})

	it('does not require confirmation when the JSON text parses', () => {
		expect(decideDeterministicStart({ jsonSyntaxError: false, hasCommittedEdits: false, switchesShowcase: false }))
			.toEqual({ needsConfirmation: false, loss: 'none' })
	})

	it('does not ask about committed edits on the tour\'s own showcase: the preset reload can be undone', () => {
		expect(decideDeterministicStart({ jsonSyntaxError: false, hasCommittedEdits: true, switchesShowcase: false }))
			.toEqual({ needsConfirmation: false, loss: 'none' })
	})

	it('asks about committed edits when the start switches showcase, which Undo cannot take back', () => {
		expect(decideDeterministicStart({ jsonSyntaxError: false, hasCommittedEdits: true, switchesShowcase: true }))
			.toEqual({ needsConfirmation: true, loss: 'edits' })
		expect(decideDeterministicStart({ jsonSyntaxError: true, hasCommittedEdits: true, switchesShowcase: true }))
			.toEqual({ needsConfirmation: true, loss: 'draft-and-edits' })
	})
})
