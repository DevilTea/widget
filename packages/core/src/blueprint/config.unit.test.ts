/**
 * Conformance coverage for COMMENT 26 §3 (config projection), COMMENT 2 (config semantics) and
 * COMMENT 14 (relative `addIssue()` authoring / framework finalization).
 */

import type { BlueprintConfigIssueSource, BlueprintDefinitionIssueSource, WidgetInterfaces } from '../index'
import { describe, expect, it } from 'vitest'
import { createWidgetPlugin, createWidgetSystem } from '../index'

type ConfigMode = 'false-no-issue' | 'false-with-issue' | 'ok' | 'true-with-issue'

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
	.interfaces<ConfigProbeInterfaces>()
	.config({
		validate: (input, ctx): input is ConfigRaw => {
			configProbeCalls.push(input)

			if (!isConfigRaw(input))
				return false

			switch (input.mode) {
				case 'ok':
					return true
				case 'true-with-issue':
					ctx.addIssue({ message: 'reported despite a true predicate', path: ['mode'] })
					return true
				case 'false-with-issue':
					ctx.addIssue({ message: 'reported alongside a false predicate' })
					return false
				case 'false-no-issue':
					return false
			}
		},
		resolve: rawConfig => rawConfig === null ? { mode: 'none' } : { mode: rawConfig.mode },
	})
	.done()

interface BareInterfaces extends WidgetInterfaces {}

const barePlugin = createWidgetPlugin('bare')
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
		expect(blueprint.getCollectedIssues())
			.toEqual([])
	})

	it('an own-property config: undefined is present and is passed to validate', () => {
		configProbeCalls.length = 0

		const definition = { id: 'root', type: 'config-probe', config: undefined }
		expect(Object.hasOwn(definition, 'config'))
			.toBe(true)

		const { blueprint, root } = getProbeRoot(definition)

		expect(configProbeCalls)
			.toEqual([undefined])
		// undefined fails `isConfigRaw`, so the predicate returns false with no authored issue: the
		// framework fallback still finalizes it as an ordinary config issue, distinct from omission.
		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')
		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		expect(issues[0]!.source.type)
			.toBe('config')
	})

	it('an invalid present config produces a config issue carrying the raw input, then resolves via resolve(null)', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: 'not-an-object' })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintConfigIssueSource
		expect(source.type)
			.toBe('config')
		expect(source.input)
			.toBe('not-an-object')
		expect(source.node)
			.toBe(root)
	})

	it('a raw config field on a plugin without config capability produces a definition issue at [\'config\']', () => {
		const blueprint = system.createBlueprint({ id: 'root', type: 'bare', config: { anything: true } })
		const root = blueprint.root

		expect(root.resolved)
			.toBe(true)
		expect(blueprint.status)
			.toBe('invalid')

		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintDefinitionIssueSource
		expect(source.type)
			.toBe('definition')
		expect(source.path)
			.toEqual(['config'])
		expect(source.node)
			.toBe(root)
		expect(issues.some(issue => issue.source.type === 'config'))
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
		expect(blueprint.getCollectedIssues())
			.toEqual([])
	})

	it('predicate true with issues present still fails and discards the typed raw config', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: { mode: 'true-with-issue' } })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintConfigIssueSource
		expect(source.input)
			.toEqual({ mode: 'true-with-issue' })
		// the callback's relative `path` is finalized into the absolute config source unchanged.
		expect(source.path)
			.toEqual(['mode'])
	})

	it('predicate false with issues present fails using the authored issue', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: { mode: 'false-with-issue' } })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintConfigIssueSource
		expect(source.input)
			.toEqual({ mode: 'false-with-issue' })
		expect(source.path)
			.toBeUndefined()
	})

	it('predicate false with an empty collector triggers a framework-generated fallback issue', () => {
		const { blueprint, root } = getProbeRoot({ id: 'root', type: 'config-probe', config: { mode: 'false-no-issue' } })

		expect(root.rawConfig)
			.toBeNull()
		expect(root.config)
			.toEqual({ mode: 'none' })
		expect(blueprint.status)
			.toBe('invalid')

		const issues = blueprint.getCollectedIssues()
		expect(issues)
			.toHaveLength(1)
		const source = issues[0]!.source as BlueprintConfigIssueSource
		expect(source.type)
			.toBe('config')
		expect(source.input)
			.toEqual({ mode: 'false-no-issue' })
		// the exact fallback message text is not part of the stable contract (COMMENT 29); only that a
		// non-empty message was produced so `Issue.message` remains a string.
		expect(typeof issues[0]!.message)
			.toBe('string')
		expect(issues[0]!.message.length)
			.toBeGreaterThan(0)
	})
})
