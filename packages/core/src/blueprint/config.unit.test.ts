/**
 * Conformance coverage for COMMENT 26 §3 (config projection), COMMENT 2 (config semantics) and
 * COMMENT 14 (relative `addDiagnostic()` authoring / framework finalization).
 */

import type { BlueprintConfigDiagnostic, BlueprintDefinitionDiagnostic, WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

type ConfigMode = 'false-no-diagnostic' | 'false-with-diagnostic' | 'ok' | 'true-with-diagnostic'

interface ConfigRaw {
	readonly mode: ConfigMode
}

interface ConfigResolved {
	readonly mode: ConfigMode | 'none'
}

interface ConfigProbeInterfaces extends WidgetInterfaces {
	config: {
		raw: ConfigRaw
		resolved: ConfigResolved
	}
}

function isConfigRaw(value: unknown): value is ConfigRaw {
	return typeof value === 'object' && value !== null && Object.hasOwn(value, 'mode') && typeof (value as { mode: unknown }).mode === 'string'
}

const configProbeCalls: unknown[] = []

const configProbePlugin = createWidgetPlugin('config-probe')
	.description('Test widget')
	.interfaces<ConfigProbeInterfaces>()
	.config({
		description: 'Test config',
		validate: (input, ctx): input is ConfigRaw => {
			configProbeCalls.push(input)

			if (!isConfigRaw(input))
				return false

			switch (input.mode) {
				case 'ok':
					return true
				case 'true-with-diagnostic':
					ctx.addDiagnostic({ message: 'reported despite a true predicate', path: ['mode'], reason: 'fixture-rule' })
					return true
				case 'false-with-diagnostic':
					ctx.addDiagnostic({ message: 'reported alongside a false predicate' })
					return false
				case 'false-no-diagnostic':
					return false
			}
		},
		resolve: rawConfig => rawConfig === null ? { mode: 'none' } : { mode: rawConfig.mode },
	})
	.done()

interface BareInterfaces extends WidgetInterfaces {}

const barePlugin = createWidgetPlugin('bare')
	.description('Test widget')
	.interfaces<BareInterfaces>()
	.done()

const system = createWidgetSystem({ plugins: [configProbePlugin, barePlugin] })

function getProbeRoot(definition: unknown) {
	const blueprint = system.createBlueprint(definition)
	const root = blueprint.root
	if (!root.resolved || root.type !== 'config-probe')
		throw new Error('expected a resolved config-probe root')
	return { blueprint, root }
}

describe('config presence', () => {
	it('an omitted config resolves via resolve(null) without invoking validate', () => {
		configProbeCalls.length = 0

		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe' })

		expect(configProbeCalls)
			.toEqual([])
		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('an own-property config: undefined is passed to semantic validation and independently diagnosed outside the authored JSON domain', () => {
		configProbeCalls.length = 0

		const definition = { id: 'root', type: 'config-probe', config: undefined }
		expect(Object.hasOwn(definition, 'config'))
			.toBe(true)

		const { blueprint, root } = getProbeRoot(definition)

		expect(configProbeCalls)
			.toEqual([undefined])
		// undefined fails `isConfigRaw`, so the predicate returns false with no authored diagnostic: the
		// framework fallback still finalizes it as an ordinary config diagnostic, distinct from omission.
		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')
		const diagnostics = blueprint.diagnostics
		expect(diagnostics)
			.toHaveLength(2)
		expect(diagnostics[0]!.code)
			.toBe('invalid-widget-config')
		expect(diagnostics[1])
			.toEqual(expect.objectContaining({
				code: 'json-incompatible-value',
				path: ['config'],
				reason: 'undefined',
			}))
	})

	it('an invalid present config produces a config diagnostic without duplicating the raw input, then resolves via resolve(null)', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: 'not-an-object' })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const diagnostics = blueprint.diagnostics
		expect(diagnostics)
			.toHaveLength(1)
		const source = diagnostics[0]! as BlueprintConfigDiagnostic
		expect(source.code)
			.toBe('invalid-widget-config')
		expect('input' in source)
			.toBe(false)
		expect(source.location.node)
			.toBe(root)
	})

	it('a raw config field on a plugin without config capability produces a definition diagnostic at [\'config\']', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'bare', config: { anything: true } })
		const root = blueprint.root

		expect(root.resolved)
			.toBe(true)
		expect(blueprint.status)
			.toBe('invalid')

		const diagnostics = blueprint.diagnostics
		expect(diagnostics)
			.toHaveLength(1)
		const source = diagnostics[0]! as BlueprintDefinitionDiagnostic
		expect(source.code)
			.toBe('unexpected-widget-config')
		expect('path' in source ? source.path : undefined)
			.toEqual(['config'])
		expect(source.location.node)
			.toBe(root)
		expect(diagnostics.some(diagnostic => diagnostic.code === 'invalid-widget-config'))
			.toBe(false)
	})
})

describe('config.validate finalization (COMMENT 2 predicate + collector table)', () => {
	it('predicate true with an empty collector succeeds with the validated raw config', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: { mode: 'ok' } })

		expect(root.rawConfig)
			.toEqual({ mode: 'ok' })
		expect(root.config)
			.toEqual({ mode: 'ok' })
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('predicate true with diagnostics present still fails and discards the typed raw config', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: { mode: 'true-with-diagnostic' } })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const diagnostics = blueprint.diagnostics
		expect(diagnostics)
			.toHaveLength(1)
		const source = diagnostics[0]! as BlueprintConfigDiagnostic
		expect('input' in source)
			.toBe(false)
		// the callback's relative `path` is finalized into the absolute config source unchanged.
		expect(source.path)
			.toEqual(['mode'])
		expect(source.reason)
			.toBe('fixture-rule')
	})

	it('predicate false with diagnostics present fails using the authored diagnostic', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: { mode: 'false-with-diagnostic' } })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const diagnostics = blueprint.diagnostics
		expect(diagnostics)
			.toHaveLength(1)
		const source = diagnostics[0]! as BlueprintConfigDiagnostic
		expect('input' in source)
			.toBe(false)
		expect(source.path)
			.toBeUndefined()
	})

	it('predicate false with an empty collector triggers a framework-generated fallback diagnostic', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: { mode: 'false-no-diagnostic' } })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const diagnostics = blueprint.diagnostics
		expect(diagnostics)
			.toHaveLength(1)
		const source = diagnostics[0]! as BlueprintConfigDiagnostic
		expect(source.code)
			.toBe('invalid-widget-config')
		expect('input' in source)
			.toBe(false)
		// the exact fallback message text is not part of the stable contract (COMMENT 29); only that a
		// non-empty message was produced so `Diagnostic.message` remains a string.
		expect(typeof diagnostics[0]!.message)
			.toBe('string')
		expect(diagnostics[0]!.message.length)
			.toBeGreaterThan(0)
	})
})
