/**
 * What the Structure editor makes of the onboarding plugins' config JSON Schemas (`describeField`, the reader behind its
 * controls): option and rule lists with Add and Remove, a whole-number box, text-per-language objects and day and time
 * lists. It lives with the Lab's code, not in the showcase, because a showcase test may not import the Lab.
 */

import { describe, expect, it } from 'vitest'
import { inductionConfigSchema, interestsConfigSchema, onboardingConfigSchema, safetyConfigSchema } from '../showcases/onboarding/schemas'
import { describeField } from './config-schema'

function propertiesOf(schema: Record<string, unknown>, value: unknown): Record<string, Record<string, unknown>> {
	return (describeField(schema, schema, value).field as { properties: Record<string, Record<string, unknown>> }).properties
}

describe('the Structure editor over the onboarding plugins\' config JSON Schemas', () => {
	it('offers a whole-number box for the start step and lists for the options, rules, days and times', () => {
		const onboarding = propertiesOf(onboardingConfigSchema, { title: { en: 'A' }, startStep: 0 })
		expect(describeField(onboardingConfigSchema, onboarding.startStep!, 0).field.kind)
			.toMatch(/number|integer/)

		const interests = { title: { en: 'A' }, options: [{ id: 'a', label: { en: 'A' } }] }
		const options = describeField(interestsConfigSchema, propertiesOf(interestsConfigSchema, interests).options!, interests.options)
		expect(options.field)
			.toMatchObject({ kind: 'array', known: true, minItems: 1 })

		const safety = { title: { en: 'A' }, rules: [{ id: 'a', text: { en: 'A' } }] }
		expect(describeField(safetyConfigSchema, propertiesOf(safetyConfigSchema, safety).rules!, safety.rules).field)
			.toMatchObject({ kind: 'array', known: true })

		const induction = { title: { en: 'A' }, days: ['2026-12-05'], times: ['10:00'] }
		const inductionProperties = propertiesOf(inductionConfigSchema, induction)
		expect(describeField(inductionConfigSchema, inductionProperties.days!, induction.days).field)
			.toMatchObject({ kind: 'array', known: true })
		expect(describeField(inductionConfigSchema, inductionProperties.times!, induction.times).field)
			.toMatchObject({ kind: 'array', known: true })
	})
})
