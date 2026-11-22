import type { WidgetInterfaces } from '@deviltea/widget-core'
import type { InspectionNodeId } from '@deviltea/widget-core/inspection'
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { sandboxPresets } from '../sandbox/presets'
import { sandboxSystem } from '../sandbox/system'
import { surveyPresets } from '../showcases/survey/presets'
import { surveySystem } from '../showcases/survey/system'
import { createAuthorPatch, editConfig, replaceConfigScalar } from './author'

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

		expect(createAuthorPatch(blueprint, replaceConfigScalar(0, 999_999 as InspectionNodeId, 'text', 'edited'), 0))
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

		expect(createAuthorPatch(blueprint, replaceConfigScalar(0, rootNodeId, 'languages', 'edited'), 0))
			.toEqual({ ok: false, reason: 'config-value-not-scalar' })
	})

	it('keeps array-form SourcePath keys raw when a config key contains JSON Pointer characters', () => {
		interface SpecialInterfaces extends WidgetInterfaces {
			config: { raw: { readonly 'a/b~c': string }, resolved: { readonly 'a/b~c': string } }
		}
		const plugin = createWidgetPlugin('Special')
			.interfaces<SpecialInterfaces>()
			.config({
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
})

describe('edit-config lowering (issue #230 PR 3c, audit U15)', () => {
	const source = surveyPresets.find(preset => preset.id === 'survey-default')!.sourceText
	const blueprint = surveySystem.createBlueprint(JSON.parse(source))
	const inspection = inspectBlueprint(blueprint)
	const nodeOf = (id: string) => inspection.nodes.find(node => node.resolved && node.node.id === id)!
	const sessions = nodeOf('sessions')
	const guests = nodeOf('guests')
	const phone = nodeOf('phone')

	it('replaces a nested value by its source path', () => {
		expect(createAuthorPatch(blueprint, editConfig(0, guests.nodeId, ['max'], { op: 'replace', value: 5 }), 0))
			.toEqual({ ok: true, patch: [{ op: 'replace', path: [...guests.sourcePath, 'config', 'max'], value: 5 }] })
		expect(createAuthorPatch(blueprint, editConfig(0, sessions.nodeId, ['options', 1, 'label', 'en'], { op: 'replace', value: 'Laser' }), 0))
			.toEqual({ ok: true, patch: [{ op: 'replace', path: [...sessions.sourcePath, 'config', 'options', 1, 'label', 'en'], value: 'Laser' }] })
	})

	it('adds an absent object key and removes an existing one', () => {
		expect(createAuthorPatch(blueprint, editConfig(0, guests.nodeId, ['help'], { op: 'add', value: { en: 'x' } }), 0))
			.toEqual({ ok: true, patch: [{ op: 'add', path: [...guests.sourcePath, 'config', 'help'], value: { en: 'x' } }] })
		expect(createAuthorPatch(blueprint, editConfig(0, phone.nodeId, ['maxLength'], { op: 'remove' }), 0))
			.toEqual({ ok: true, patch: [{ op: 'remove', path: [...phone.sourcePath, 'config', 'maxLength'] }] })
	})

	it('inserts into an array at an index and appends with the pointer form, escaping what a pointer must', () => {
		expect(createAuthorPatch(blueprint, editConfig(0, sessions.nodeId, ['options', 1], { op: 'add', value: { value: 'x', label: { en: 'X' } } }), 0))
			.toEqual({ ok: true, patch: [{ op: 'add', path: [...sessions.sourcePath, 'config', 'options', 1], value: { value: 'x', label: { en: 'X' } } }] })
		const append = createAuthorPatch(blueprint, editConfig(0, sessions.nodeId, ['options', 3], { op: 'add', value: 'x' }), 0)
		expect(append)
			.toEqual({ ok: true, patch: [{ op: 'add', path: `/${[...sessions.sourcePath, 'config', 'options', '-'].join('/')}`, value: 'x' }] })
		expect(createAuthorPatch(blueprint, editConfig(0, sessions.nodeId, ['options', 2], { op: 'remove' }), 0))
			.toEqual({ ok: true, patch: [{ op: 'remove', path: [...sessions.sourcePath, 'config', 'options', 2] }] })
	})

	it('creates the config object when the widget has none yet', () => {
		const bare = sandboxSystem.createBlueprint({ id: 'root', type: 'Stack', slots: { items: [{ id: 'title', type: 'Text' }] } })
		const title = inspectBlueprint(bare).nodes.find(node => node.resolved && node.node.id === 'title')!
		expect(createAuthorPatch(bare, editConfig(0, title.nodeId, ['text'], { op: 'add', value: 'hello' }), 0))
			.toEqual({ ok: true, patch: [{ op: 'add', path: [...title.sourcePath, 'config'], value: { text: 'hello' } }] })
		expect(createAuthorPatch(bare, editConfig(0, title.nodeId, ['text'], { op: 'replace', value: 'hello' }), 0))
			.toEqual({ ok: false, reason: 'config-not-found' })
	})

	it('refuses what no longer fits the Document, without producing a patch', () => {
		const refuse = (command: ReturnType<typeof editConfig>) => createAuthorPatch(blueprint, command, 0)
		expect(refuse(editConfig(1, guests.nodeId, ['max'], { op: 'replace', value: 5 })))
			.toEqual({ ok: false, reason: 'stale-selection' })
		expect(refuse(editConfig(0, 999_999 as InspectionNodeId, ['max'], { op: 'replace', value: 5 })))
			.toEqual({ ok: false, reason: 'widget-not-found' })
		expect(refuse(editConfig(0, guests.nodeId, [], { op: 'remove' })))
			.toEqual({ ok: false, reason: 'config-path-not-found' })
		expect(refuse(editConfig(0, guests.nodeId, [], { op: 'add', value: {} })))
			.toEqual({ ok: false, reason: 'config-path-exists' })
		expect(refuse(editConfig(0, guests.nodeId, ['nope'], { op: 'replace', value: 5 })))
			.toEqual({ ok: false, reason: 'config-path-not-found' })
		expect(refuse(editConfig(0, guests.nodeId, ['nope'], { op: 'remove' })))
			.toEqual({ ok: false, reason: 'config-path-not-found' })
		expect(refuse(editConfig(0, guests.nodeId, ['max'], { op: 'add', value: 5 })))
			.toEqual({ ok: false, reason: 'config-path-exists' })
		expect(refuse(editConfig(0, sessions.nodeId, ['options', 9], { op: 'add', value: 'x' })))
			.toEqual({ ok: false, reason: 'config-path-not-found' })
		expect(refuse(editConfig(0, sessions.nodeId, ['options', 9], { op: 'remove' })))
			.toEqual({ ok: false, reason: 'config-path-not-found' })
		expect(refuse(editConfig(0, guests.nodeId, ['max'], { op: 'replace', value: Number.NaN })))
			.toEqual({ ok: false, reason: 'invalid-value' })
		expect(refuse(editConfig(0, guests.nodeId, ['min', 'deeper'], { op: 'replace', value: 1 })))
			.toEqual({ ok: false, reason: 'config-path-not-found' })
	})

	describe('the whole config (issue #230 PR 3c review)', () => {
		const bare = (config: unknown) => {
			const source = { id: 'root', type: 'Stack', slots: { items: [{ id: 'title', type: 'Text', ...(config === undefined ? {} : { config }) }] } }
			const blueprint = sandboxSystem.createBlueprint(source)
			const title = inspectBlueprint(blueprint).nodes.find(node => node.node.resolved && node.node.id === 'title')!
			return { blueprint, title }
		}

		it('replaces a config that is a string, a list or null, whatever it is, with any JSON value', () => {
			for (const config of ['x', [], null, { text: 'a' }]) {
				const { blueprint, title } = bare(config)
				expect(createAuthorPatch(blueprint, editConfig(0, title.nodeId, [], { op: 'replace', value: { text: 'fixed' } }), 0), JSON.stringify(config))
					.toEqual({ ok: true, patch: [{ op: 'replace', path: [...title.sourcePath, 'config'], value: { text: 'fixed' } }] })
			}
		})

		it('creates a config that is absent, by replace or add', () => {
			const { blueprint, title } = bare(undefined)
			for (const op of ['replace', 'add'] as const) {
				expect(createAuthorPatch(blueprint, editConfig(0, title.nodeId, [], { op, value: { text: 'new' } }), 0))
					.toEqual({ ok: true, patch: [{ op: 'add', path: [...title.sourcePath, 'config'], value: { text: 'new' } }] })
			}
		})

		it('adds the first key to a config that is null, which the editor shows as an empty object', () => {
			const { blueprint, title } = bare(null)
			expect(createAuthorPatch(blueprint, editConfig(0, title.nodeId, ['text'], { op: 'add', value: 'hello' }), 0))
				.toEqual({ ok: true, patch: [{ op: 'replace', path: [...title.sourcePath, 'config'], value: { text: 'hello' } }] })
			expect(createAuthorPatch(blueprint, editConfig(0, title.nodeId, ['text', 'deeper'], { op: 'add', value: 'x' }), 0))
				.toEqual({ ok: false, reason: 'config-path-not-found' })
		})

		it('refuses a key inside a config that is not an object, and an add over a config that exists', () => {
			const { blueprint, title } = bare('x')
			expect(createAuthorPatch(blueprint, editConfig(0, title.nodeId, ['text'], { op: 'add', value: 'x' }), 0))
				.toEqual({ ok: false, reason: 'config-path-not-found' })
			expect(createAuthorPatch(blueprint, editConfig(0, title.nodeId, [], { op: 'add', value: {} }), 0))
				.toEqual({ ok: false, reason: 'config-path-exists' })
		})
	})
})
