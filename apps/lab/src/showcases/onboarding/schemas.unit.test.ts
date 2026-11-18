/**
 * The config JSON Schemas declare exactly the keys the checkers know, and reach the catalog through the system.
 */

import { WIDGET_CONFIG_JSON_SCHEMA_DIALECT } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_CONFIG_KEYS, ACCOUNT_PREFILL_KEYS, INDUCTION_CONFIG_KEYS, INTEREST_OPTION_KEYS, INTERESTS_CONFIG_KEYS, ONBOARDING_CONFIG_KEYS, SAFETY_CONFIG_KEYS, SAFETY_RULE_KEYS } from './config'
import { defaultOnboardingPreset } from './presets'
import { accountConfigSchema, inductionConfigSchema, interestsConfigSchema, onboardingConfigSchema, safetyConfigSchema } from './schemas'
import { onboardingSystem } from './system'

describe('onboarding config schemas', () => {
	const cases = [
		['Onboarding', onboardingConfigSchema, ONBOARDING_CONFIG_KEYS],
		['AccountStep', accountConfigSchema, ACCOUNT_CONFIG_KEYS],
		['InterestsStep', interestsConfigSchema, INTERESTS_CONFIG_KEYS],
		['SafetyStep', safetyConfigSchema, SAFETY_CONFIG_KEYS],
		['InductionStep', inductionConfigSchema, INDUCTION_CONFIG_KEYS],
	] as const

	it.each(cases)('%s declares exactly the keys its checker accepts, in Draft 2020-12', (_type, schema, keys) => {
		expect(schema.$schema)
			.toBe(WIDGET_CONFIG_JSON_SCHEMA_DIALECT)
		expect(Object.keys(schema.properties)
			.sort())
			.toEqual([...keys].sort())
		expect(schema.additionalProperties)
			.toBe(false)
	})

	it('declares the keys of the nested objects the checkers know', () => {
		expect(Object.keys(accountConfigSchema.properties.prefill.properties)
			.sort())
			.toEqual([...ACCOUNT_PREFILL_KEYS].sort())
		expect(Object.keys(interestsConfigSchema.properties.options.items.properties)
			.sort())
			.toEqual([...INTEREST_OPTION_KEYS].sort())
		expect(Object.keys(safetyConfigSchema.properties.rules.items.properties)
			.sort())
			.toEqual([...SAFETY_RULE_KEYS].sort())
	})

	it('reaches the catalog through the system, with a description, for every widget type; the declared Events reach the Blueprint inspection', () => {
		const byType = new Map(onboardingSystem.catalog.widgets.map(entry => [entry.type, entry]))
		expect([...byType.keys()])
			.toEqual(['Onboarding', 'AccountStep', 'InterestsStep', 'SafetyStep', 'InductionStep'])
		for (const [type, entry] of byType) {
			expect(entry.config?.schema, type).not.toBeNull()
			expect(entry.config?.description.length, type)
				.toBeGreaterThan(0)
		}
		const nodes = inspectBlueprint(onboardingSystem.createBlueprint(JSON.parse(defaultOnboardingPreset.sourceText))).nodes
		const events = (id: string): string[] => nodes.flatMap(node => node.resolved && node.node.id === id ? node.events.map(event => event.name) : [])
		expect(events('onboarding'))
			.toEqual(['stepChanged', 'completed'])
		expect(events('induction'))
			.toEqual(['slotRequested', 'slotConfirmed', 'slotDeclined', 'slotCancelled'])
		expect(events('account'))
			.toEqual([])
	})
})
