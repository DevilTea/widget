/**
 * The three presets, compiled for real: `survey-default` is valid with the dependency edges the design
 * lists, `survey-ai-draft` has exactly five located diagnostics, `survey-cycle` has one invalid cycle.
 * It also holds every preset to the rules `src/showcases/registry.unit.test.ts` applies to registered
 * presets (this showcase is not registered yet).
 */

import type { BlueprintDiagnostic } from '@deviltea/widget-core'
import type { surveyPlugins } from './plugins'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { defaultSurveyPreset, surveyPresets } from './presets'
import { surveySystem } from './system'

const presetById = (id: string) => surveyPresets.find(preset => preset.id === id)!
const compile = (sourceText: string) => surveySystem.createBlueprint(JSON.parse(sourceText))

describe('survey presets', () => {
	it('lists the default, the AI draft and the cycle, the default first', () => {
		expect(surveyPresets.map(preset => [preset.id, preset.label]))
			.toEqual([
				['survey-default', 'Default — open day sign-up'],
				['survey-ai-draft', 'AI draft — five mistakes'],
				['survey-cycle', 'Cycle — Guests ↔ Kids\' corner'],
			])
		expect(defaultSurveyPreset)
			.toBe(surveyPresets[0])
	})

	it.each(surveyPresets.map(preset => [preset.id, preset] as const))('%s has the root id open-day and only recognized widget keys', (_id, preset) => {
		const blueprint = compile(preset.sourceText)
		const codes = blueprint.diagnostics.map(diagnostic => diagnostic.code)
		expect(blueprint.root.id)
			.toBe('open-day')
		// The same rules registry.unit.test.ts applies to a registered preset.
		expect(codes)
			.not
			.toContain('unexpected-widget-field')
		expect(codes)
			.not
			.toContain('duplicate-widget-id')
		expect(blueprint.sourceJsonCompatible)
			.toBe(true)
	})
})

describe('survey-default', () => {
	it('is valid with no diagnostics', () => {
		const blueprint = compile(defaultSurveyPreset.sourceText)
		expect(blueprint.status)
			.toBe('valid')
		expect(blueprint.diagnostics)
			.toEqual([])
		expect(inspectBlueprint(blueprint).invalidCycles)
			.toEqual([])
	})

	it('declares exactly the cross-question edges of the design, all on value Properties', () => {
		const inspection = inspectBlueprint(compile(defaultSurveyPreset.sourceText))
		const edges: string[] = []
		for (const node of inspection.nodes) {
			if (!node.resolved || node.node.id === 'open-day')
				continue
			for (const property of node.properties) {
				for (const dependency of property.dependencies) {
					if (dependency.reference.target.type === 'widget' && dependency.reference.operation.type === 'property-get')
						edges.push(`${node.node.id}.${property.name} -> ${dependency.reference.target.widgetId}.${dependency.reference.operation.name}`)
				}
			}
		}
		expect(edges.sort())
			.toEqual([
				'guests.visible -> mode.value',
				'phone.required -> mode.value',
				'sessions.errors -> guests.value',
				'sessions.options -> guests.value',
				'sessions.options -> mode.value',
			])
	})

	it('declares sessions.value once for sessions.errors, although a rule names sessions itself', () => {
		const inspection = inspectBlueprint(compile(defaultSurveyPreset.sourceText))
		const nodeById = (id: string) => inspection.nodes.find(node => node.resolved && node.node.id === id)!
		const sessions = nodeById('sessions')
		if (!sessions.resolved)
			throw new Error('no sessions')
		const errors = sessions.properties.find(property => property.name === 'errors')!
		const reads = errors.dependencies.flatMap(dependency => dependency.status === 'resolved' && dependency.target.nodeId === sessions.nodeId && dependency.target.member.name === 'value'
			? [dependency.path]
			: [])
		expect(reads)
			.toEqual([['value']])
	})

	it('has the root read the four fixed members of every question and nothing else of a question', () => {
		const inspection = inspectBlueprint(compile(defaultSurveyPreset.sourceText))
		const root = inspection.nodes.find(node => node.resolved && node.node.id === 'open-day')
		if (root === undefined || !root.resolved)
			throw new Error('no root')
		const response = root.properties.find(property => property.name === 'response')!
		const reads = response.dependencies.flatMap(dependency => dependency.reference.target.type === 'widget' && dependency.reference.operation.type === 'property-get'
			? [`${dependency.reference.target.widgetId}.${dependency.reference.operation.name}`]
			: [])
		expect(reads.sort())
			.toEqual(['mode', 'guests', 'sessions', 'phone'].flatMap(id => ['errors', 'required', 'value', 'visible'].map(name => `${id}.${name}`))
				.sort())
	})
})

/** One diagnostic as a comparable fact: code, widget, member, config path and reason (never the order). */
function factOf(blueprint: ReturnType<typeof compile>, diagnostic: BlueprintDiagnostic<typeof surveyPlugins>): string {
	const node = 'node' in diagnostic.location ? diagnostic.location.node : null
	const member = diagnostic.location.type === 'property' || diagnostic.location.type === 'method' ? diagnostic.location.name : null
	return JSON.stringify({
		code: diagnostic.code,
		widget: node?.id ?? null,
		member,
		path: 'path' in diagnostic ? diagnostic.path : null,
		reason: 'reason' in diagnostic ? diagnostic.reason : null,
		sourcePath: node === null ? null : blueprint.getSourcePath(node),
	})
}

describe('survey-ai-draft', () => {
	const sourceText = presetById('survey-ai-draft').sourceText

	it('has exactly five located diagnostics, one per widget', () => {
		const blueprint = compile(sourceText)
		expect(blueprint.status)
			.toBe('invalid')
		const facts = blueprint.diagnostics.map(diagnostic => factOf(blueprint, diagnostic))
			.sort()
		const expected = [
			{ code: 'invalid-widget-config', widget: 'mode', member: null, path: ['options'], reason: 'empty-options', sourcePath: ['slots', 'questions', 0] },
			{ code: 'unknown-widget-type', widget: 'rating', member: null, path: ['type'], reason: null, sourcePath: ['slots', 'questions', 4] },
			{ code: 'invalid-widget-structure', widget: 'phone', member: null, path: null, reason: 'condition-type-mismatch', sourcePath: ['slots', 'questions', 3] },
			{ code: 'invalid-widget-structure', widget: 'sessions', member: null, path: null, reason: 'missing-translation', sourcePath: ['slots', 'questions', 2] },
			{ code: 'missing-dependency-target', widget: 'guests', member: 'visible', path: null, reason: null, sourcePath: ['slots', 'questions', 1] },
		].map(fact => JSON.stringify(fact))
			.sort()
		expect(facts)
			.toEqual(expected)
	})

	it('names the missing dependency target "mod" on guests.visible', () => {
		const blueprint = compile(sourceText)
		const missing = blueprint.diagnostics.find(diagnostic => diagnostic.code === 'missing-dependency-target')
		expect(missing && 'dependency' in missing ? missing.dependency : null)
			.toEqual({
				target: { type: 'widget', widgetId: 'mod', optional: false },
				operation: { type: 'property-get', name: 'value' },
			})
	})

	it('does not report the recovered mode as an unknown option or a missing translation of its own', () => {
		const reasons = compile(sourceText)
			.diagnostics
			.flatMap(diagnostic => 'reason' in diagnostic && diagnostic.reason !== undefined ? [diagnostic.reason] : [])
		expect(reasons.sort())
			.toEqual(['condition-type-mismatch', 'empty-options', 'missing-translation'])
	})

	it('fixing the typo "mod" removes exactly the dependency diagnostic', () => {
		const fixed = compile(sourceText.replace('"question": "mod"', '"question": "mode"'))
		expect(fixed.diagnostics.map(diagnostic => diagnostic.code)
			.sort())
			.toEqual(['invalid-widget-config', 'invalid-widget-structure', 'invalid-widget-structure', 'unknown-widget-type'])
	})
})

describe('survey-cycle', () => {
	const blueprint = compile(presetById('survey-cycle').sourceText)
	const members = ['guests.visible', 'guests.value', 'sessions.options', 'sessions.value']

	const memberOf = (location: { readonly type: string, readonly node?: { readonly id?: string | null }, readonly name?: string }) =>
		`${location.node?.id}.${location.name}`

	it('is invalid with exactly four property-evaluation-cycle diagnostics and nothing else', () => {
		expect(blueprint.status)
			.toBe('invalid')
		expect(blueprint.diagnostics.map(diagnostic => diagnostic.code))
			.toEqual(Array.from({ length: 4 })
				.fill('property-evaluation-cycle'))
		expect(blueprint.diagnostics.map(diagnostic => memberOf(diagnostic.location))
			.sort())
			.toEqual([...members].sort())
	})

	it('lists the four members as related on every diagnostic', () => {
		for (const diagnostic of blueprint.diagnostics) {
			expect('related' in diagnostic
				? diagnostic.related?.map(memberOf)
						.sort()
				: null, diagnostic.message)
				.toEqual([...members].sort())
		}
	})

	it('has one invalid cycle in the inspection, with the same four members', () => {
		const inspection = inspectBlueprint(blueprint)
		expect(inspection.invalidCycles)
			.toHaveLength(1)
		const names = inspection.invalidCycles[0]!.members.map((member) => {
			const node = inspection.getNode(member.nodeId)
			return `${node !== null && node.resolved ? node.node.id : null}.${member.member.name}`
		})
		expect(names.sort())
			.toEqual([...members].sort())
	})
})
