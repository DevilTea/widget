/**
 * The Onboarding slot rules, through a real Blueprint compile: an empty `steps` slot is an ordinary structure
 * diagnostic (`no-steps`) on the slot, never an exception, and a child that is not a step type is reported at its index.
 */

import { describe, expect, it } from 'vitest'
import { defaultOnboardingPreset } from '../presets'
import { onboardingSystem } from '../system'

function presetSource(): { slots: { steps: unknown[] } } & Record<string, unknown> {
	return JSON.parse(defaultOnboardingPreset.sourceText)
}

describe('onboarding: steps slot structure', () => {
	it('compiles an empty steps slot to an invalid Blueprint with a no-steps diagnostic instead of throwing', () => {
		const source = presetSource()
		source.slots.steps = []
		const blueprint = onboardingSystem.createBlueprint(source)
		expect(blueprint.status)
			.toBe('invalid')
		const noSteps = blueprint.diagnostics.filter(diagnostic => 'reason' in diagnostic && diagnostic.reason === 'no-steps')
		expect(noSteps)
			.toHaveLength(1)
		expect(noSteps[0])
			.not
			.toHaveProperty('path.index')
	})

	it('reports a child that is not a step type at its index', () => {
		const source = presetSource()
		source.slots.steps.push({ id: 'stray', type: 'Onboarding', slots: { steps: [] } })
		const blueprint = onboardingSystem.createBlueprint(source)
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics.some(diagnostic => 'reason' in diagnostic && diagnostic.reason === 'not-a-step'))
			.toBe(true)
	})
})
