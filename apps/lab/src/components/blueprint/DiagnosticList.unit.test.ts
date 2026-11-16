// @vitest-environment happy-dom
import { createWidgetPlugin, createWidgetSystem } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { LabI18nKey } from '../../composables/use-lab-i18n'
import { sandboxSystem } from '../../sandbox/system'
import { testGlobalProperties } from '../../test-support'
import DiagnosticList from './DiagnosticList.vue'

const global = {
	config: { globalProperties: testGlobalProperties },
	provide: {
		[LabI18nKey as symbol]: {
			locale: { value: 'en' },
			locales: ['en', 'zh-TW'],
			setLocale: () => {},
			t: (source: string) => source,
		},
	},
}

function mountFor(source: unknown) {
	const blueprint = sandboxSystem.createBlueprint(source)
	const inspection = inspectBlueprint(blueprint)
	const wrapper = mount(DiagnosticList, { props: { diagnostics: blueprint.diagnostics, inspection }, global })
	const rows = blueprint.diagnostics.map((_, index) => wrapper.get(`[data-testid="blueprint-diagnostic-${index}"]`)
		.text())
	return { blueprint, rows }
}

describe('diagnostic list', () => {
	it('renders the duplicate-widget-id and unexpected-widget-field codes from the structured diagnostic', () => {
		const { blueprint, rows } = mountFor({
			id: 'root',
			type: 'Stack',
			extra: true,
			slots: { items: [
				{ id: 'same', type: 'Text', config: { text: 'a' } },
				{ id: 'same', type: 'Text', config: { text: 'b' } },
			] },
		})

		const codes = blueprint.diagnostics.map(diagnostic => diagnostic.code)
		expect(codes)
			.toContain('duplicate-widget-id')
		expect(codes)
			.toContain('unexpected-widget-field')
		expect(codes)
			.not
			.toContain('invalid-widget-id')

		const unexpected = rows[codes.indexOf('unexpected-widget-field')]!
		expect(unexpected)
			.toContain('unexpected-widget-field')
		expect(unexpected)
			.toContain('path: extra')
		expect(unexpected)
			.toContain('widget "root : Stack"')
		expect(rows[codes.indexOf('duplicate-widget-id')])
			.toContain('duplicate-widget-id')
	})

	it('labels an unresolved node by Core\'s id/type hints, with ? for a non-string value', () => {
		const { blueprint, rows } = mountFor({
			id: 'root',
			type: 'Stack',
			slots: { items: [
				{ id: 'mystery-1', type: 'NoSuchType' },
				{ id: 7, type: 'Text' },
			] },
		})

		const locations = blueprint.diagnostics.map((diagnostic, index) => ({ diagnostic, row: rows[index]! }))
		expect(locations.some(({ row }) => row.includes('widget "mystery-1 : NoSuchType (unresolved)"')))
			.toBe(true)
		expect(locations.some(({ row }) => row.includes('widget "? : Text (unresolved)"')))
			.toBe(true)
	})
})

describe('diagnostic list related locations', () => {
	interface FixtureInterfaces {
		state: { value: number }
		properties: { p1: unknown, p2: unknown, viaMethod: unknown }
		methods: { write: () => void }
	}

	const validateValue = (input: unknown): input is number => typeof input === 'number'
	const noArgs = (args: readonly unknown[]): args is [] => args.length === 0
	const idle = { compute: () => null }

	/** `p1` and `p2` depend on each other. */
	const cyclePlugin = createWidgetPlugin('cycle')
		.description('cycle fixture')
		.interfaces<FixtureInterfaces>()
		.state(state => state.value({ validate: validateValue, default: () => 0 }))
		.properties(properties => properties
			.p1({ registerDeps: ({ dep }) => ({ other: dep.self.properties.get('p2') }), compute: () => null })
			.p2({ registerDeps: ({ dep }) => ({ other: dep.self.properties.get('p1') }), compute: () => null })
			.viaMethod(idle))
		.methods(methods => methods.write({ registerDeps: ({ dep }) => ({ set: dep.self.state.set('value') }), validateArgs: noArgs, execute: () => {} }))
		.done()

	/** `p1` depends on itself. */
	const selfPlugin = createWidgetPlugin('self-dependent')
		.description('self-dependent fixture')
		.interfaces<FixtureInterfaces>()
		.state(state => state.value({ validate: validateValue, default: () => 0 }))
		.properties(properties => properties
			.p1({ registerDeps: ({ dep }) => ({ me: dep.self.properties.get('p1') }), compute: () => null })
			.p2(idle)
			.viaMethod(idle))
		.methods(methods => methods.write({ registerDeps: ({ dep }) => ({ set: dep.self.state.set('value') }), validateArgs: noArgs, execute: () => {} }))
		.done()

	/** `viaMethod` depends on a Method that writes State. */
	const sideEffectPlugin = createWidgetPlugin('side-effect')
		.description('side-effect fixture')
		.interfaces<FixtureInterfaces>()
		.state(state => state.value({ validate: validateValue, default: () => 0 }))
		.properties(properties => properties
			.p1(idle)
			.p2(idle)
			.viaMethod({ registerDeps: ({ dep }) => ({ call: dep.self.methods.invoke('write') }), compute: () => null }))
		.methods(methods => methods.write({ registerDeps: ({ dep }) => ({ set: dep.self.state.set('value') }), validateArgs: noArgs, execute: () => {} }))
		.done()

	const system = createWidgetSystem({ plugins: [cyclePlugin, selfPlugin, sideEffectPlugin] })

	function rowsOf(type: string, code: string) {
		const blueprint = system.createBlueprint({ id: 'root', type })
		const inspection = inspectBlueprint(blueprint)
		const wrapper = mount(DiagnosticList, { props: { diagnostics: blueprint.diagnostics, inspection }, global })
		return blueprint.diagnostics
			.map((diagnostic, index) => ({
				diagnostic,
				chips: wrapper.get(`[data-testid="blueprint-diagnostic-${index}"]`)
					.findAll('button')
					.map(button => button.text())
					.filter(text => text !== 'jump to node'),
			}))
			.filter(row => row.diagnostic.code === code)
			.map(row => ({
				own: row.diagnostic.location.type === 'property' ? row.diagnostic.location.name : null,
				related: 'related' in row.diagnostic ? row.diagnostic.related?.length : undefined,
				chips: row.chips,
			}))
	}

	it('shows only the other member of a two-Property cycle on each diagnostic', () => {
		const rows = rowsOf('cycle', 'property-evaluation-cycle')
		expect(rows)
			.toHaveLength(2)
		// Core lists both members, the diagnostic's own Property included, in one shared list.
		expect(rows.map(row => row.related))
			.toEqual([2, 2])
		expect(rows.find(row => row.own === 'p1')?.chips)
			.toEqual(['property "p2"'])
		expect(rows.find(row => row.own === 'p2')?.chips)
			.toEqual(['property "p1"'])
	})

	it('shows no related chip for a Property that depends on itself', () => {
		const rows = rowsOf('self-dependent', 'property-evaluation-cycle')
		expect(rows)
			.toHaveLength(1)
		expect(rows[0]?.related)
			.toBe(1)
		expect(rows[0]?.chips)
			.toEqual([])
	})

	it('leaves a diagnostic whose related locations are all other members unchanged', () => {
		const rows = rowsOf('side-effect', 'property-dependency-has-side-effects')
		expect(rows)
			.toHaveLength(1)
		expect(rows[0]?.own)
			.toBe('viaMethod')
		expect(rows[0]?.chips)
			.toEqual(['method "write"'])
	})
})
