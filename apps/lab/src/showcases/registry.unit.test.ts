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

	it('hands the Lab the generated config schema of each plugin, except quote-rules, which keeps its Valibot schemas', async () => {
		// Per showcase: the plugin types with a config, and for one of them a named type its schema must define.
		const expected: Record<string, { readonly types: readonly string[], readonly type: string, readonly def: string }> = {
			'survey': { types: ['Survey', 'SingleChoice', 'MultipleChoice', 'Numeric', 'ShortAnswer'], type: 'Numeric', def: 'type_Condition' },
			'trip-budget': { types: ['Trip', 'Currency', 'Person', 'Expense'], type: 'Expense', def: 'type_PercentSplitRaw' },
			'onboarding': { types: ['Onboarding', 'AccountStep', 'InterestsStep', 'SafetyStep', 'InductionStep'], type: 'InterestsStep', def: 'type_InterestOptionRaw' },
			'document-repair': { types: ['RepairDesk', 'SavedDraft'], type: 'SavedDraft', def: 'type_SavedDraftRawConfig' },
			'renderer-packs': { types: ['SettingsPage', 'Appearance', 'Notifier', 'Section', 'TextField', 'Toggle', 'Choice', 'DangerAction'], type: 'Choice', def: 'type_ChoiceOption' },
		}
		expect(showcases.filter(entry => !['quote-rules', 'sandbox'].includes(entry.id))
			.map(entry => entry.id))
			.toEqual(Object.keys(expected))
		for (const [id, { types, type, def }] of Object.entries(expected)) {
			const showcase = getShowcase(id)!
			expect(Object.keys(showcase.configSchemas), id)
				.toEqual(types)
			for (const [name, schema] of Object.entries(showcase.configSchemas)) {
				// The very object `widgetDocs()` generated, a Draft 2020-12 document of its own.
				expect(schema, `${id} ${name}`)
					.toBe(showcase.docs.plugins[name]!.config!.schema)
				expect(schema, `${id} ${name}`)
					.toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: `${name} config` })
			}
			expect(Object.keys(showcase.configSchemas[type]!.$defs as object), `${id} ${type}`)
				.toContain(def)
		}
		expect(getShowcase('document-repair')!.configSchemas.SavedDraft)
			.toMatchObject({ $ref: '#/$defs/type_SavedDraftRawConfig', $defs: { type_SavedDraftRawConfig: { required: ['title', 'savedWith', 'source'] } } })
		const quote = await import('./quote-rules/schemas')
		expect(getShowcase('quote-rules')?.configSchemas)
			.toBe(quote.quoteConfigSchemas)
		expect(getShowcase('sandbox')?.configSchemas)
			.toEqual({})
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
