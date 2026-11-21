import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

describe('showcase registry listing and ?showcase= selection', () => {
	it('lists Interactive Survey (the default), then the Trip budget splitter, the Quote rules showcase and the Onboarding wizard; sandbox is a registered hidden fixture', () => {
		expect(listedShowcases.map(showcase => showcase.id))
			.toEqual(['survey', 'trip-budget', 'quote-rules', 'onboarding'])
		expect(defaultShowcase.id)
			.toBe('survey')
		expect(getShowcase('sandbox')?.hidden)
			.toBe(true)
		expect(getShowcase('trip-budget')?.hidden)
			.toBeUndefined()
		expect(showcases.map(showcase => showcase.id))
			.toEqual(['survey', 'trip-budget', 'quote-rules', 'onboarding', 'sandbox'])
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
