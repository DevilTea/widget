/**
 * Conformance coverage for COMMENT 26 §3 (config projection), COMMENT 2 (config semantics) and
 * COMMENT 14 (relative `addDiagnostic()` authoring / framework finalization).
 */

import type { BlueprintConfigDiagnostic, BlueprintDefinitionDiagnostic, WidgetInterfaces, WidgetSourceFor } from '../index'
import { describe, expect, expectTypeOf, it } from 'vitest'
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

interface OptionalConfigRaw {
	readonly label: string
}

interface OptionalConfigInterfaces extends WidgetInterfaces {
	config: {
		raw: OptionalConfigRaw | null
		resolved: { readonly label: string }
	}
}

const optionalConfigCalls: unknown[] = []

// Accepts omission: its raw config type admits `null` and its validator accepts it.
const optionalConfigPlugin = createWidgetPlugin('optional-config')
	.description('Test widget')
	.interfaces<OptionalConfigInterfaces>()
	.config({
		description: 'Test config',
		validate: (input): input is OptionalConfigRaw | null => {
			optionalConfigCalls.push(input)
			return input === null || (typeof input === 'object' && typeof (input as { label?: unknown }).label === 'string')
		},
		resolve: rawConfig => ({ label: rawConfig?.label ?? 'default' }),
	})
	.done()

interface RequiredConfigInterfaces extends WidgetInterfaces {
	config: {
		raw: { readonly title: string }
		resolved: { readonly title: string }
	}
}

// Requires config and reports its own diagnostic for the `null` candidate.
const requiredConfigPlugin = createWidgetPlugin('required-config')
	.description('Test widget')
	.interfaces<RequiredConfigInterfaces>()
	.config({
		description: 'Test config',
		validate: (input, ctx): input is { title: string } => {
			if (input === null) {
				ctx.addDiagnostic({ message: 'A title is required.', path: ['title'], reason: 'required' })
				return false
			}
			return typeof input === 'object' && typeof (input as { title?: unknown }).title === 'string'
		},
		resolve: rawConfig => ({ title: rawConfig?.title ?? '' }),
	})
	.done()

interface BareInterfaces extends WidgetInterfaces {}

const barePlugin = createWidgetPlugin('bare')
	.description('Test widget')
	.interfaces<BareInterfaces>()
	.done()

const system = createWidgetSystem({ plugins: [configProbePlugin, optionalConfigPlugin, requiredConfigPlugin, barePlugin] })

function getProbeRoot(definition: unknown) {
	const blueprint = system.createBlueprint(definition)
	const root = blueprint.root
	if (!root.resolved || root.type !== 'config-probe')
		throw new Error('expected a resolved config-probe root')
	return { blueprint, root }
}

describe('config presence', () => {
	it('an omitted config is validated as the candidate null; a validator rejecting null makes the Blueprint invalid', () => {
		configProbeCalls.length = 0

		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe' })

		expect(configProbeCalls)
			.toEqual([null])
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
		expect(source.location.node)
			.toBe(root)
	})

	it('an omitted config is valid when the validator accepts null, and resolves via resolve(null)', () => {
		optionalConfigCalls.length = 0

		const blueprint = system.createBlueprint({ id: 'root', type: 'optional-config' })
		const root = blueprint.root
		if (!root.resolved || root.type !== 'optional-config')
			throw new Error('expected a resolved optional-config root')

		expect(optionalConfigCalls)
			.toEqual([null])
		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ label: 'default' })
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
	})

	it('an omitted config and an explicit config: null are validated identically', () => {
		optionalConfigCalls.length = 0
		configProbeCalls.length = 0

		const omittedOptional = system.createBlueprint({ id: 'root', type: 'optional-config' })
		const nullOptional = system.createBlueprint({ id: 'root', type: 'optional-config', config: null })
		const omittedProbe = system.createBlueprint({ id: 'root', type: 'config-probe' })
		const nullProbe = system.createBlueprint({ id: 'root', type: 'config-probe', config: null })

		expect(optionalConfigCalls)
			.toEqual([null, null])
		expect(configProbeCalls)
			.toEqual([null, null])
		expect([omittedOptional.status, nullOptional.status])
			.toEqual(['valid', 'valid'])
		expect([omittedProbe.status, nullProbe.status])
			.toEqual(['invalid', 'invalid'])
		expect(omittedProbe.diagnostics.map(diagnostic => diagnostic.code))
			.toEqual(nullProbe.diagnostics.map(diagnostic => diagnostic.code))
	})

	it('a validator reports its own diagnostic for an omitted required config', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'required-config' })
		const root = blueprint.root
		if (!root.resolved || root.type !== 'required-config')
			throw new Error('expected a resolved required-config root')

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ title: '' })
		expect(blueprint.status)
			.toBe('invalid')
		const diagnostics = blueprint.diagnostics
		expect(diagnostics)
			.toHaveLength(1)
		const source = diagnostics[0]! as BlueprintConfigDiagnostic
		expect(source.code)
			.toBe('invalid-widget-config')
		expect(source.path)
			.toEqual(['title'])
		expect(source.reason)
			.toBe('required')
	})

	it('a config that cannot be inspected safely is diagnosed without invoking validate', () => {
		configProbeCalls.length = 0

		const definition = { id: 'root', type: 'config-probe' }
		Object.defineProperty(definition, 'config', { enumerable: true, get: () => ({ mode: 'ok' }) })

		const { blueprint, root } = getProbeRoot(definition)

		expect(configProbeCalls)
			.toEqual([])
		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics.some(diagnostic => diagnostic.code === 'invalid-widget-config'))
			.toBe(true)
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

describe('config raw type expresses required-ness', () => {
	it('a raw config type that admits null is accepted by .interfaces()', () => {
		expectTypeOf(createWidgetPlugin('optional')
			.description('Test widget')
			.interfaces<OptionalConfigInterfaces>())
			.toHaveProperty('config')
	})

	it('typed authored source makes config optional only when the raw type admits null', () => {
		type OptionalSource = WidgetSourceFor<typeof optionalConfigPlugin, [typeof optionalConfigPlugin]>
		type RequiredSource = WidgetSourceFor<typeof requiredConfigPlugin, [typeof requiredConfigPlugin]>

		expectTypeOf<{ id: 'a', type: 'optional-config' }>()
			.toExtend<OptionalSource>()
		expectTypeOf<{ id: 'a', type: 'optional-config', config: null }>()
			.toExtend<OptionalSource>()
		expectTypeOf<{ id: 'a', type: 'required-config' }>()
			.not
			.toExtend<RequiredSource>()
		expectTypeOf<{ id: 'a', type: 'required-config', config: { title: string } }>()
			.toExtend<RequiredSource>()
	})
})
