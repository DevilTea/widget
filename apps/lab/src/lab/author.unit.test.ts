import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { surveyPresets } from '../showcases/survey/presets'
import { surveySystem } from '../showcases/survey/system'
import { createAuthorPatch, getAuthorConfigScalars, replaceConfigScalar } from './author'

const validSource = sandboxPresets.find(preset => preset.id === 'valid-interactive')!.sourceText

describe('author command lowering', () => {
	it('resolves the selected Document inspection node, not the first duplicate widget id', () => {
		const blueprint = sandboxSystem.createBlueprint({
			id: 'root',
			type: 'Stack',
			slots: { items: [
				{ id: 'duplicate', type: 'Text', config: { text: 'first' } },
				{ id: 'duplicate', type: 'Text', config: { text: 'second' } },
			] },
		})
		const inspection = inspectBlueprint(blueprint)
		const selected = inspection.nodes.filter(node => node.resolved && node.node.id === 'duplicate')[1]!

		const result = createAuthorPatch(blueprint, replaceConfigScalar(0, selected.nodeId, 'text', 'edited'), 0)

		expect(result)
			.toEqual({ ok: true, patch: [{ op: 'replace', path: ['slots', 'items', 1, 'config', 'text'], value: 'edited' }] })

		expect(createAuthorPatch(blueprint, replaceConfigScalar(1, selected.nodeId, 'text', 'edited'), 0))
			.toEqual({ ok: false, reason: 'stale-selection' })
	})

	it('rejects non-finite command values at the author model boundary', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))
		const inspection = inspectBlueprint(blueprint)
		const title = inspection.nodes.find(node => node.resolved && node.node.id === 'title')!
		const command = replaceConfigScalar(4, title.nodeId, 'text', Number.POSITIVE_INFINITY as never)

		expect(createAuthorPatch(blueprint, command, 4))
			.toEqual({ ok: false, reason: 'invalid-value' })
	})

	it('rejects a node id that is absent from the current Blueprint', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))

		expect(createAuthorPatch(blueprint, replaceConfigScalar(0, 'missing-node' as InspectionNodeId, 'text', 'edited'), 0))
			.toEqual({ ok: false, reason: 'widget-not-found' })
	})

	it('rejects a config key when the selected widget has no config object', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))
		const inspection = inspectBlueprint(blueprint)
		const counter = inspection.nodes.find(node => node.resolved && node.node.id === 'counter-1')!

		expect(createAuthorPatch(blueprint, replaceConfigScalar(0, counter.nodeId, 'text', 'edited'), 0))
			.toEqual({ ok: false, reason: 'config-not-found' })
	})

	it('rejects a config value that is not scalar', () => {
		const source = surveyPresets.find(preset => preset.id === 'survey-default')!.sourceText
		const blueprint = surveySystem.createBlueprint(JSON.parse(source))
		const rootNodeId = inspectBlueprint(blueprint).rootNodeId

		expect(createAuthorPatch(blueprint, replaceConfigScalar(0, rootNodeId, 'resetQuestionIds', 'edited'), 0))
			.toEqual({ ok: false, reason: 'config-value-not-scalar' })
	})

	it('keeps array-form SourcePath keys raw when a config key contains JSON Pointer characters', () => {
		interface SpecialInterfaces extends WidgetInterfaces {
			config: { raw: { readonly 'a/b~c': string }, resolved: { readonly 'a/b~c': string } }
		}
		const plugin = createWidgetPlugin('Special')
			.description('Special')
			.interfaces<SpecialInterfaces>()
			.config({
				description: 'Special config',
				validate: (input): input is { readonly 'a/b~c': string } => typeof input === 'object' && input !== null && typeof (input as Record<string, unknown>)['a/b~c'] === 'string',
				resolve: raw => ({ 'a/b~c': raw?.['a/b~c'] ?? '' }),
			})
			.done()
		const system = createWidgetSystem({ plugins: [plugin] })
		const blueprint = system.createBlueprint({ id: 'root', type: 'Special', config: { 'a/b~c': 'old' } })
		const nodeId = inspectBlueprint(blueprint).rootNodeId

		const result = createAuthorPatch(blueprint, replaceConfigScalar(0, nodeId, 'a/b~c', 'new'), 0)

		expect(result)
			.toEqual({ ok: true, patch: [{ op: 'replace', path: ['config', 'a/b~c'], value: 'new' }] })
	})

	it('only exposes existing scalar config values to the Structure view', () => {
		const blueprint = sandboxSystem.createBlueprint(JSON.parse(validSource))
		const inspection = inspectBlueprint(blueprint)
		const title = inspection.nodes.find(node => node.resolved && node.node.id === 'title')!

		expect(getAuthorConfigScalars(title))
			.toEqual([{ key: 'text', value: 'Widget Lab sandbox' }])
	})

	it('excludes null-valued config fields so they remain editable through JSON', () => {
		const source = surveyPresets.find(preset => preset.id === 'survey-default')!.sourceText
		const blueprint = surveySystem.createBlueprint(JSON.parse(source))
		const inspection = inspectBlueprint(blueprint)
		const familyPriority = inspection.nodes.find(node => node.resolved && node.node.id === 'family-priority')!

		expect(getAuthorConfigScalars(familyPriority))
			.toEqual([{ key: 'label', value: 'What matters most while traveling with children?' }])
	})
})
