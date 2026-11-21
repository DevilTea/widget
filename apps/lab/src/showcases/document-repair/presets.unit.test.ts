/**
 * The two presets: the default compiles to a valid Blueprint (the repair desk with four drafts), and the invalid one has
 * exactly one located diagnostic per mistake, in the OUTER document.
 */

import { describe, expect, it } from 'vitest'
import { defaultRepairPreset, repairPresets } from './presets'
import { repairSystem } from './system'
import { createPresetRuntime, valueOf, widgetsOf } from './test-support'

function blueprintOf(id: string) {
	const preset = repairPresets.find(candidate => candidate.id === id)!
	return repairSystem.createBlueprint(JSON.parse(preset.sourceText))
}

describe('preset list', () => {
	it('has the default first and a stable set of ids, each with a description', () => {
		expect(repairPresets.map(preset => preset.id))
			.toEqual(['repair-default', 'repair-invalid'])
		expect(defaultRepairPreset)
			.toBe(repairPresets[0])
		for (const preset of repairPresets) {
			expect(preset.description.length, preset.id)
				.toBeGreaterThan(20)
		}
	})
})

describe('repair-default', () => {
	it('is a valid Blueprint with no diagnostics, JSON-compatible, with the four drafts in order', () => {
		const blueprint = blueprintOf('repair-default')
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
		expect(blueprint.sourceJsonCompatible)
			.toBe(true)
		const document = JSON.parse(defaultRepairPreset.sourceText)
		expect(document.slots.drafts.map((draft: { id: string }) => draft.id))
			.toEqual(['draft-v1', 'draft-v2', 'draft-v3', 'draft-poll'])
	})

	it('has no widget keys other than the ones Core knows, even though the stored drafts hold legacy ones (they are data)', () => {
		const document = JSON.parse(defaultRepairPreset.sourceText)
		for (const draft of document.slots.drafts) {
			expect(Object.keys(draft)
				.sort())
				.toEqual(['config', 'id', 'type'])
		}
		expect(Object.keys(document.slots.drafts[0].config.source.slots.items[0]))
			.toContain('style')
	})

	it('shows each draft\'s findings as Core sees them: three invalid, one valid', () => {
		const { v1, v2, v3, poll } = widgetsOf(createPresetRuntime('repair-default').runtime)
		expect([v1, v2, v3, poll].map(draft => valueOf(draft.properties.findings.get()).status))
			.toEqual(['invalid', 'invalid', 'valid', 'invalid'])
	})
})

describe('repair-invalid', () => {
	it('has exactly the four intended diagnostics, located in the outer document, none hiding another', () => {
		const blueprint = blueprintOf('repair-invalid')
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
				{ code: 'invalid-widget-config', widget: 'draft-v1', reason: 'missing-key', path: ['source'] },
				{ code: 'invalid-widget-config', widget: 'draft-v2', reason: 'unknown-saved-with', path: ['savedWith'] },
				{ code: 'invalid-widget-config', widget: 'draft-v3', reason: 'missing-key', path: ['title'] },
				{ code: 'invalid-widget-config', widget: 'desk', reason: 'invalid-version', path: ['appVersion'] },
			])
	})

	it('differs from the default only by the four mistakes', () => {
		const clean = JSON.parse(defaultRepairPreset.sourceText)
		const broken = JSON.parse(repairPresets[1]!.sourceText)
		expect(broken.slots.drafts[1].config.source)
			.toEqual(clean.slots.drafts[1].config.source)
		expect(broken.slots.drafts)
			.toHaveLength(3)
	})
})
