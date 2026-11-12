import { describe, expect, it } from 'vitest'
import { showcases } from './registry'

describe('showcase registry presets', () => {
	const presets = showcases.flatMap(showcase => showcase.presets.map(preset => ({ showcase, preset })))

	it('registers presets for every showcase', () => {
		expect(presets.length)
			.toBeGreaterThan(0)
		for (const showcase of showcases)
			expect(showcase.presets, showcase.id).not.toHaveLength(0)
	})

	// Core treats any own widget key other than id/type/config/slots/meta as an authoring error, so a shipped
	// preset (valid or deliberately invalid) must never trip it by accident.
	it.each(presets.map(({ showcase, preset }) => [`${showcase.id}/${preset.id}`, showcase, preset] as const))(
		'%s authors only recognized widget keys and has no duplicate widget ids',
		(_name, showcase, preset) => {
			const blueprint = showcase.system.createBlueprint(JSON.parse(preset.sourceText))
			const codes = blueprint.diagnostics.map(diagnostic => diagnostic.code)

			expect(codes)
				.not
				.toContain('unexpected-widget-field')
			expect(codes)
				.not
				.toContain('duplicate-widget-id')
			expect(blueprint.sourceJsonCompatible)
				.toBe(true)
		},
	)
})
