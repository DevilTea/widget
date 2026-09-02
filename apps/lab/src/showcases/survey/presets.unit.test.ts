/**
 * Both canonical Showcase A presets (checkpoint §6) compile to a valid Blueprint, and the declared
 * `semantics` slot topology is present in Blueprint inspection — diagnostic #13's "semantic application
 * structure is not identical to mounted component structure" thesis at the Blueprint level.
 *
 * A renderer-level mounted assertion (that `TripSurveyRenderer` never renders the "semantics" slot
 * children) is deliberately not added here: every survey renderer SFC uses the app's `pika()` styling
 * helper, which only exists via `@pikacss/unplugin-pikacss`'s Vite transform — `vitest.config.ts`
 * intentionally omits that plugin (see this app's `AGENTS.md`, "UI/editor/workbench components are not
 * unit tested this phase"), so mounting a `pika()`-using SFC throws `_ctx.pika is not a function` here
 * regardless of showcase. The non-rendering behavior is verified manually against the dev server
 * instead (see the implementation report).
 */
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { surveyPresets } from './presets'
import { surveySystem } from './system'

describe('interactive Survey presets', () => {
	it.each(surveyPresets)('"$id" compiles to a valid Blueprint with no collected diagnostics', (preset) => {
		const blueprint = surveySystem.createBlueprint(JSON.parse(preset.sourceText))
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('the "semantics" slot is present in Blueprint inspection with TripReadiness/TripRecommendation as children', () => {
		const blueprint = surveySystem.createBlueprint(JSON.parse(surveyPresets[0]!.sourceText))
		if (blueprint.status !== 'valid')
			throw new Error('expected a valid Blueprint')

		const inspection = inspectBlueprint(blueprint)
		const surveyNode = inspection.nodes.find(node => node.resolved && node.node.id === 'trip-survey')
		if (surveyNode === undefined || !surveyNode.resolved)
			throw new Error('expected a resolved "trip-survey" inspection node')

		const semanticsSlot = surveyNode.semanticSlots.find(slot => slot.name === 'semantics')
		expect(semanticsSlot)
			.toBeDefined()
		expect(semanticsSlot!.children)
			.toHaveLength(2)

		const childTypes = semanticsSlot!.children.map((childNodeId) => {
			const childNode = inspection.nodes.find(node => node.nodeId === childNodeId)
			if (childNode === undefined || !childNode.resolved)
				throw new Error('expected a resolved semantics-slot child')
			return childNode.node.type
		})
		expect(childTypes.sort())
			.toEqual(['TripReadiness', 'TripRecommendation'])
	})
})
