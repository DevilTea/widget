import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inspectPlugin } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { defaultShowcase, getShowcase, listedShowcases, resolveInitialShowcase, showcases, urlWithShowcase } from './registry'

describe('the frame isolation e2e covers every registered showcase', () => {
	it('lists exactly the registered ids, in order', () => {
		const spec = readFileSync(fileURLToPath(new URL('../../e2e/nuxt-ui.spec.ts', import.meta.url)), 'utf8')
		const list = /for \(const showcase of \[([^\]]+)\] as const\)/.exec(spec)
		expect(list, 'the Preview frame isolation loop in e2e/nuxt-ui.spec.ts')
			.not
			.toBeNull()
		expect([...list![1]!.matchAll(/'([^']+)'/g)].map(match => match[1]))
			.toEqual(showcases.map(showcase => showcase.id))
	})
})

describe('the documentation each showcase carries (Core 0.3 has no descriptions at run time)', () => {
	it.each(showcases.map(showcase => [showcase.id, showcase] as const))('%s: every plugin, config, slot and Event is documented in its generated docs', (_id, showcase) => {
		expect(Object.keys(showcase.docs.plugins))
			.toEqual(showcase.system.catalog.widgets.map(widget => widget.type))
		for (const plugin of showcase.system.plugins) {
			const docs = showcase.docs.plugins[plugin.type]!
			expect(docs.summary, plugin.type).not.toBe('')
			expect(docs.config === null, `${plugin.type} config`)
				.toBe(!plugin.capabilities.config)
			if (docs.config !== null)
				expect(docs.config.summary, `${plugin.type} config`).not.toBe('')
			const slots = showcase.system.catalog.widgets.find(widget => widget.type === plugin.type)!.slots ?? []
			expect(Object.keys(docs.slots ?? {}), `${plugin.type} slots`)
				.toEqual([...slots])
			for (const name of slots)
				expect(docs.slots![name]!.summary, `${plugin.type} slot ${name}`).not.toBe('')
			const events = [...inspectPlugin(plugin).events?.keys() ?? []]
			expect(Object.keys(docs.events ?? {}), `${plugin.type} events`)
				.toEqual(events)
			for (const name of events)
				expect(docs.events![name]!.summary, `${plugin.type} event ${name}`).not.toBe('')
		}
	})

	it('hands the Lab a config JSON Schema only for plugins with a config', () => {
		for (const showcase of showcases) {
			for (const type of Object.keys(showcase.configSchemas)) {
				expect(showcase.system.catalog.widgets.find(widget => widget.type === type)?.capabilities.config, `${showcase.id} ${type}`)
					.toBe(true)
			}
		}
	})

	it('hands the Lab a config JSON Schema for every plugin with a config in every listed showcase', () => {
		for (const showcase of listedShowcases) {
			const configured = showcase.system.catalog.widgets
				.filter(widget => widget.capabilities.config)
				.map(widget => widget.type)
			expect(Object.keys(showcase.configSchemas)
				.sort(), showcase.id)
				.toEqual([...configured].sort())
		}
	})

	it('maps each Survey, document-repair and renderer-packs plugin type to its own schema', async () => {
		const survey = await import('./survey/schemas')
		expect(getShowcase('survey')?.configSchemas)
			.toStrictEqual({
				Survey: survey.surveyConfigSchema,
				SingleChoice: survey.singleChoiceConfigSchema,
				MultipleChoice: survey.multipleChoiceConfigSchema,
				Numeric: survey.numericConfigSchema,
				ShortAnswer: survey.shortAnswerConfigSchema,
			})
		const repair = await import('./document-repair/schemas')
		expect(getShowcase('document-repair')?.configSchemas)
			.toStrictEqual({
				RepairDesk: repair.repairDeskConfigSchema,
				SavedDraft: repair.savedDraftConfigSchema,
			})
		const packs = await import('./renderer-packs/schemas')
		expect(getShowcase('renderer-packs')?.configSchemas)
			.toStrictEqual({
				SettingsPage: packs.settingsPageConfigSchema,
				Appearance: packs.appearanceConfigSchema,
				Notifier: packs.notifierConfigSchema,
				Section: packs.sectionConfigSchema,
				TextField: packs.textFieldConfigSchema,
				Toggle: packs.toggleConfigSchema,
				Choice: packs.choiceConfigSchema,
				DangerAction: packs.dangerActionConfigSchema,
			})
	})
})

describe('showcase registry listing and ?showcase= selection', () => {
	it('lists Interactive Survey (the default), then the Trip budget splitter, the Quote rules showcase, the Onboarding wizard, the Legacy document repair and the two renderer packs; sandbox is a registered hidden fixture', () => {
		expect(listedShowcases.map(showcase => showcase.id))
			.toEqual(['survey', 'trip-budget', 'quote-rules', 'onboarding', 'document-repair', 'renderer-packs'])
		expect(defaultShowcase.id)
			.toBe('survey')
		expect(getShowcase('sandbox')?.hidden)
			.toBe(true)
		expect(getShowcase('trip-budget')?.hidden)
			.toBeUndefined()
		expect(showcases.map(showcase => showcase.id))
			.toEqual(['survey', 'trip-budget', 'quote-rules', 'onboarding', 'document-repair', 'renderer-packs', 'sandbox'])
	})

	it('selects any registered showcase, listed or hidden, from the query string', () => {
		expect(resolveInitialShowcase('?showcase=sandbox').id)
			.toBe('sandbox')
		expect(resolveInitialShowcase('?showcase=trip-budget').id)
			.toBe('trip-budget')
		expect(resolveInitialShowcase('?showcase=quote-rules').id)
			.toBe('quote-rules')
		expect(resolveInitialShowcase('?showcase=onboarding').id)
			.toBe('onboarding')
		expect(resolveInitialShowcase('?showcase=document-repair').id)
			.toBe('document-repair')
		expect(resolveInitialShowcase('?showcase=renderer-packs').id)
			.toBe('renderer-packs')
		expect(resolveInitialShowcase('?lab-test&showcase=survey').id)
			.toBe('survey')
	})

	it('falls back to the default for a missing, empty or unknown id', () => {
		for (const search of ['', '?lang=zh-TW', '?showcase=', '?showcase=crm', '?showcase=vuetify-tasks', '?showcase=SANDBOX']) {
			expect(resolveInitialShowcase(search).id, search)
				.toBe('survey')
		}
	})
})

describe('urlWithShowcase', () => {
	it('sets the showcase parameter and keeps every other parameter, the path and the hash', () => {
		expect(urlWithShowcase('http://localhost:4173/widget/lab/?lang=zh-TW&lab-test#frag', 'sandbox'))
			.toBe('/widget/lab/?lang=zh-TW&lab-test=&showcase=sandbox#frag')
		expect(urlWithShowcase('http://localhost:4173/?showcase=survey', 'sandbox'))
			.toBe('/?showcase=sandbox')
		expect(urlWithShowcase('http://localhost:4173/', 'survey'))
			.toBe('/?showcase=survey')
	})

	it('round-trips through resolveInitialShowcase', () => {
		for (const showcase of showcases) {
			const url = new URL(urlWithShowcase('http://localhost/?lab-test', showcase.id), 'http://localhost')
			expect(resolveInitialShowcase(url.search).id)
				.toBe(showcase.id)
		}
	})
})

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
