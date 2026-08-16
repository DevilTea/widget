import { describe, expect, it } from 'vitest'
import { decideDeterministicStart } from './deterministic-start'

describe('decideDeterministicStart', () => {
	it('requires confirmation when the current draft is dirty', () => {
		expect(decideDeterministicStart({ isDirty: true }))
			.toEqual({ needsConfirmation: true })
	})

	it('does not require confirmation when the current draft is not dirty', () => {
		expect(decideDeterministicStart({ isDirty: false }))
			.toEqual({ needsConfirmation: false })
	})
})
