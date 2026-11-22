/**
 * The two presets: the default compiles to a valid Blueprint (a settings page with two providers and three sections), and the
 * invalid one has exactly one located diagnostic per mistake.
 */

import { describe, expect, it } from 'vitest'
import { defaultPacksPreset, packsPresets } from './presets'
import { packsSystem } from './system'
import { createPresetRuntime, valueOf, widgetsOf } from './test-support'

function blueprintOf(id: string) {
	const preset = packsPresets.find(candidate => candidate.id === id)!
	return packsSystem.createBlueprint(JSON.parse(preset.sourceText))
}

describe('preset list', () => {
	it('has the default first and a stable set of ids, each with a description', () => {
		expect(packsPresets.map(preset => preset.id))
			.toEqual(['packs-default', 'packs-invalid'])
		expect(defaultPacksPreset)
			.toBe(packsPresets[0])
		for (const preset of packsPresets) {
			expect(preset.description.length, preset.id)
				.toBeGreaterThan(20)
		}
	})
})

describe('packs-default', () => {
	it('is a valid, JSON-compatible Blueprint with no diagnostics', () => {
		const blueprint = blueprintOf('packs-default')
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
		expect(blueprint.sourceJsonCompatible)
			.toBe(true)
	})

	it('has the two providers, three sections and the ten widgets the tour and the e2e suite name', () => {
		const document = JSON.parse(defaultPacksPreset.sourceText)
		expect(document.slots.providers.map((widget: { id: string }) => widget.id))
			.toEqual(['appearance', 'notifier'])
		expect(document.slots.sections.map((widget: { id: string }) => widget.id))
			.toEqual(['profile', 'preferences', 'danger'])
		expect(document.slots.sections.flatMap((section: { slots: { fields: { id: string }[] } }) => section.slots.fields.map(field => field.id)))
			.toEqual(['workspace-name', 'tagline', 'week-start', 'digest', 'beta', 'clear-cache', 'archive-workspace'])
	})

	it('uses only the widget keys Core knows (id, type, config, slots)', () => {
		const seen = new Set<string>()
		const walk = (widget: { slots?: Record<string, unknown[]> } & Record<string, unknown>): void => {
			for (const key of Object.keys(widget))
				seen.add(key)
			for (const children of Object.values(widget.slots ?? {})) {
				for (const child of children)
					walk(child as never)
			}
		}
		walk(JSON.parse(defaultPacksPreset.sourceText))
		expect([...seen].sort())
			.toEqual(['config', 'id', 'slots', 'type'])
	})

	it('starts with nothing notified, nothing asked and the fields at their configured values', () => {
		const { runtime } = createPresetRuntime('packs-default')
		const widgets = widgetsOf(runtime)
		expect(widgets.notifier.state.items.get())
			.toEqual([])
		expect(widgets.archive.state.confirming.get())
			.toBe(false)
		expect(widgets.workspaceName.state.value.get())
			.toBe('Harbour Studio')
		expect(valueOf(widgets.page.properties.title.get()))
			.toEqual({ 'en': 'Workspace settings', 'zh-TW': '工作區設定' })
	})
})

describe('packs-invalid', () => {
	it('has exactly the four intended diagnostics, located, none hiding another', () => {
		const blueprint = blueprintOf('packs-invalid')
		expect(blueprint.status)
			.toBe('invalid')
		const found = blueprint.diagnostics.map(diagnostic => ({
			code: diagnostic.code,
			widget: diagnostic.location.type === 'widget' ? diagnostic.location.node.id : null,
			reason: 'reason' in diagnostic ? diagnostic.reason : undefined,
			path: 'path' in diagnostic ? diagnostic.path : undefined,
		}))
		expect(found)
			.toEqual(expect.arrayContaining([
				{ code: 'invalid-widget-config', widget: 'workspace-name', reason: 'invalid-max-length', path: ['maxLength'] },
				{ code: 'invalid-widget-structure', widget: 'tagline', reason: 'unknown-appearance', path: undefined },
				{ code: 'invalid-widget-structure', widget: 'beta', reason: 'not-an-appearance', path: undefined },
				{ code: 'invalid-widget-structure', widget: 'archive-workspace', reason: 'unknown-notifier', path: undefined },
			]))
		expect(found)
			.toHaveLength(4)
	})

	it('differs from the default only by the four mistakes', () => {
		const clean = JSON.parse(defaultPacksPreset.sourceText)
		const broken = JSON.parse(packsPresets[1]!.sourceText)
		clean.slots.sections[0].slots.fields[0].config.maxLength = 0
		clean.slots.sections[0].slots.fields[1].config.appearance = 'look-and-feel'
		clean.slots.sections[1].slots.fields[1].config.appearance = 'notifier'
		clean.slots.sections[2].slots.fields[1].config.notifier = 'notification-center'
		expect(broken)
			.toEqual(clean)
	})
})
