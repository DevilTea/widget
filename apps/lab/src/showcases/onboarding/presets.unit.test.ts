/**
 * The four presets: three compile to a valid Blueprint (and start where they say they do), and the invalid one has
 * exactly one located diagnostic per mistake.
 */

import { describe, expect, it } from 'vitest'
import { defaultOnboardingPreset, onboardingPresets } from './presets'
import { onboardingSystem } from './system'
import { createPresetRuntime, valueOf, widgetsOf } from './test-support'

function blueprintOf(id: string) {
	const preset = onboardingPresets.find(candidate => candidate.id === id)!
	return onboardingSystem.createBlueprint(JSON.parse(preset.sourceText))
}

describe('preset list', () => {
	it('has the default first and a stable set of ids, each with a description', () => {
		expect(onboardingPresets.map(preset => preset.id))
			.toEqual(['onboarding-default', 'onboarding-ready-to-book', 'onboarding-deep-link', 'onboarding-invalid'])
		expect(defaultOnboardingPreset)
			.toBe(onboardingPresets[0])
		for (const preset of onboardingPresets) {
			expect(preset.description.length, preset.id)
				.toBeGreaterThan(20)
		}
	})
})

describe.each(['onboarding-default', 'onboarding-ready-to-book', 'onboarding-deep-link'])('%s', (id) => {
	it('is a valid Blueprint with no diagnostics, JSON-compatible, with the four steps in order', () => {
		const blueprint = blueprintOf(id)
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
		expect(blueprint.sourceJsonCompatible)
			.toBe(true)
		const document = JSON.parse(onboardingPresets.find(preset => preset.id === id)!.sourceText)
		expect(document.slots.steps.map((step: { id: string }) => step.id))
			.toEqual(['account', 'interests', 'safety', 'induction'])
	})
})

describe('onboarding-default', () => {
	it('starts on the first step with every step incomplete', () => {
		const { runtime } = createPresetRuntime('onboarding-default')
		const { root } = widgetsOf(runtime)
		expect(root.state.current.get())
			.toBe(0)
		expect(valueOf(root.properties.progress.get()).allComplete)
			.toBe(false)
	})
})

describe('onboarding-ready-to-book', () => {
	it('opens on the induction with the first three steps complete and nothing booked', () => {
		const { runtime } = createPresetRuntime('onboarding-ready-to-book')
		const { root, induction } = widgetsOf(runtime)
		expect(root.state.current.get())
			.toBe(3)
		expect(valueOf(root.properties.steps.get())
			.map(step => [step.id, step.complete]))
			.toEqual([['account', true], ['interests', true], ['safety', true], ['induction', false]])
		expect(induction.state.status.get())
			.toBe('idle')
	})
})

describe('onboarding-deep-link', () => {
	it('opens on the induction with nothing filled in', () => {
		const { runtime } = createPresetRuntime('onboarding-deep-link')
		const { root, account } = widgetsOf(runtime)
		expect(root.state.current.get())
			.toBe(3)
		expect(account.state.name.get())
			.toBe('')
		expect(valueOf(root.properties.progress.get()))
			.toMatchObject({ firstIncomplete: 0, furthest: 0 })
	})
})

describe('onboarding-invalid', () => {
	it('has exactly the four intended diagnostics, one per widget, none hiding another', () => {
		const blueprint = blueprintOf('onboarding-invalid')
		expect(blueprint.status)
			.toBe('invalid')
		const found = blueprint.diagnostics.map(diagnostic => ({
			code: diagnostic.code,
			widget: diagnostic.location.type === 'widget' ? diagnostic.location.node.id : null,
			reason: 'reason' in diagnostic ? diagnostic.reason : undefined,
			path: 'path' in diagnostic ? diagnostic.path : undefined,
		}))
		expect(found)
			.toEqual([
				{ code: 'invalid-widget-config', widget: 'interests', reason: 'out-of-range', path: ['minimum'] },
				{ code: 'invalid-widget-config', widget: 'safety', reason: 'unknown-id', path: ['acknowledged', 0] },
				{ code: 'invalid-widget-config', widget: 'induction', reason: 'invalid-date', path: ['days', 1] },
				{ code: 'invalid-widget-structure', widget: 'onboarding', reason: 'start-step-out-of-range', path: undefined },
			])
	})

	it('differs from the default only by the four mistakes', () => {
		const clean = JSON.parse(defaultOnboardingPreset.sourceText)
		const broken = JSON.parse(onboardingPresets[3]!.sourceText)
		expect(broken.slots.steps[0])
			.toEqual(clean.slots.steps[0])
		expect(broken.slots.steps[1].config.options)
			.toEqual(clean.slots.steps[1].config.options)
	})
})
