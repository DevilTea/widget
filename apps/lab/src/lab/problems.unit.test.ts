import type { SourceParseError } from './types'
import { createWidgetDocument } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { getShowcase } from '../showcases/registry'
import { claimsFieldProblem, collectProblems, groupProblems, placeStructureProblems, problemSpan } from './problems'

function problemsOf(showcaseId: string, presetId: string, parseError: SourceParseError | null = null) {
	const showcase = getShowcase(showcaseId)!
	const preset = showcase.presets.find(candidate => candidate.id === presetId)!
	const blueprint = createWidgetDocument({ system: showcase.system, source: JSON.parse(preset.sourceText) })
		.getSnapshot()
		.blueprint
	const problems = collectProblems(blueprint, inspectBlueprint(blueprint), parseError)
	return { problems, text: preset.sourceText }
}

function textOf(text: string, span: { start: number, end: number } | null): string | null {
	return span === null ? null : text.slice(span.start, span.end)
}

describe('collectProblems', () => {
	it('has no rows for a valid Document and no parse error', () => {
		expect(problemsOf('survey', 'survey-default').problems)
			.toEqual([])
	})

	it('lists Core diagnostics verbatim, in Core order, with their node location', () => {
		const { problems } = problemsOf('survey', 'survey-ai-draft')
		expect(problems.map(problem => problem.code))
			.toEqual([
				'invalid-widget-config',
				'unknown-widget-type',
				'invalid-widget-structure',
				'invalid-widget-structure',
				'missing-dependency-target',
			])
		expect(problems.every(problem => problem.kind === 'diagnostic' && problem.message.length > 0))
			.toBe(true)
		expect(problems[4]!.locationLabel)
			.toMatch(/^widget ".+" · property "visible"$/)
		expect(problems.every(problem => problem.nodeId !== null))
			.toBe(true)
	})

	it('puts the JSON syntax error of the last Apply first, with the engine message untouched', () => {
		const parseError: SourceParseError = { message: 'Expected double-quoted property name in JSON at position 3', sourceText: '{ x }' }
		const { problems } = problemsOf('sandbox', 'invalid-semantic', parseError)
		expect(problems[0])
			.toMatchObject({ kind: 'syntax', code: null, message: parseError.message, nodeId: null })
		expect(problems)
			.toHaveLength(2)
	})
})

describe('configPath and where Structure shows a problem (Lab UX phase 2)', () => {
	it('gives a config diagnostic its config-relative path, and widget-level diagnostics none', () => {
		const { problems } = problemsOf('survey', 'survey-ai-draft')
		expect(problems.map(problem => problem.configPath))
			.toEqual([['options'], null, null, null, null])
	})

	it('a max below min is a problem at the max field (report finding: Structure showed nothing there)', () => {
		const showcase = getShowcase('survey')!
		const source = JSON.parse(showcase.defaultPreset.sourceText) as { slots: { questions: { id: string, config: Record<string, unknown> }[] } }
		Object.assign(source.slots.questions.find(question => question.id === 'guests')!.config, { min: 0, max: -1 })
		const blueprint = createWidgetDocument({ system: showcase.system, source })
			.getSnapshot()
			.blueprint
		const problems = collectProblems(blueprint, inspectBlueprint(blueprint), null)
		expect(problems.map(({ code, configPath }) => ({ code, configPath })))
			.toEqual([{ code: 'invalid-widget-config', configPath: ['max'] }])
		const placed = placeStructureProblems(problems, problems[0]!.nodeId)
		expect(placed.atFields)
			.toEqual(problems)
		expect(claimsFieldProblem(['max'], null, problems[0]!))
			.toBe(true)
		expect(claimsFieldProblem(['min'], null, problems[0]!))
			.toBe(false)
		// The config itself does not show it: its `max` field is rendered and does.
		expect(claimsFieldProblem([], ['label', 'min', 'max'], problems[0]!))
			.toBe(false)
	})

	it('places the selected widget\'s field and widget problems, and lists the rest', () => {
		const parseError: SourceParseError = { message: 'Unexpected end of JSON input', sourceText: '{' }
		const showcase = getShowcase('survey')!
		const preset = showcase.presets.find(candidate => candidate.id === 'survey-ai-draft')!
		const blueprint = createWidgetDocument({ system: showcase.system, source: JSON.parse(preset.sourceText) })
			.getSnapshot()
			.blueprint
		const problems = collectProblems(blueprint, inspectBlueprint(blueprint), parseError)
		const configProblem = problems.find(problem => problem.configPath !== null)!
		const placed = placeStructureProblems(problems, configProblem.nodeId)
		expect(placed.atFields)
			.toEqual([configProblem])
		expect(placed.atNode.every(problem => problem.nodeId === configProblem.nodeId && problem.configPath === null))
			.toBe(true)
		expect(placed.elsewhere[0]!.kind)
			.toBe('syntax')
		expect([...placed.atFields, ...placed.atNode, ...placed.elsewhere])
			.toHaveLength(problems.length)
		// Nothing selected: everything is listed.
		expect(placeStructureProblems(problems, null).elsewhere)
			.toEqual(problems)
	})
})

describe('claimsFieldProblem', () => {
	const at = (configPath: (string | number)[] | null) => ({ configPath }) as never

	it('claims its own path, and paths under a leaf (a value edited as JSON)', () => {
		expect(claimsFieldProblem(['label'], ['en', 'zh-TW'], at(['label'])))
			.toBe(true)
		expect(claimsFieldProblem(['rules'], null, at(['rules', 0, 'when'])))
			.toBe(true)
	})

	it('leaves a path under a rendered child to that child, and claims a key it does not render (a missing key)', () => {
		expect(claimsFieldProblem(['label'], ['en'], at(['label', 'en'])))
			.toBe(false)
		expect(claimsFieldProblem(['label'], ['en'], at(['label', 'zh-TW'])))
			.toBe(true)
		// Array indices compare with the numbers Core reports.
		expect(claimsFieldProblem(['options'], [0, 1], at(['options', 1, 'value'])))
			.toBe(false)
		expect(claimsFieldProblem(['options', 1], ['value', 'label'], at(['options', 1, 'value'])))
			.toBe(false)
		expect(claimsFieldProblem(['options', 1, 'value'], null, at(['options', 1, 'value'])))
			.toBe(true)
	})

	it('never claims a problem outside it or without a config path', () => {
		expect(claimsFieldProblem(['min'], null, at(['max'])))
			.toBe(false)
		expect(claimsFieldProblem([], ['max'], at(null)))
			.toBe(false)
		expect(claimsFieldProblem(['label', 'en'], null, at(['label'])))
			.toBe(false)
	})
})

describe('problemSpan', () => {
	it('points a config diagnostic at the offending config member key', () => {
		const { problems, text } = problemsOf('survey', 'survey-ai-draft')
		expect(textOf(text, problemSpan(problems[0]!, text)))
			.toBe('"options"')
	})

	it('points a relative path diagnostic at the value it names (the unknown widget type)', () => {
		const { problems, text } = problemsOf('survey', 'survey-ai-draft')
		expect(textOf(text, problemSpan(problems[1]!, text)))
			.toBe('"StarRating"')
	})

	it('points a widget-level diagnostic at the widget id member', () => {
		const { problems, text } = problemsOf('survey', 'survey-ai-draft')
		const span = problemSpan(problems[4]!, text)
		expect(textOf(text, span))
			.toMatch(/^"id": "[\w-]+"$/)
		// The widget that owns the property, not the root.
		expect(span!.start)
			.toBeGreaterThan(text.indexOf('"questions"'))
	})

	it('points an undeclared slot at its key', () => {
		const { problems, text } = problemsOf('sandbox', 'raw-slot-recovery')
		const slot = problems.find(problem => problem.code === 'undeclared-widget-slot')!
		expect(textOf(text, problemSpan(slot, text)))
			.toBe('"sidebar"')
	})

	it('maps a diagnostic by path onto an edited draft, and falls back to the nearest existing ancestor', () => {
		const { problems, text } = problemsOf('survey', 'survey-ai-draft')
		const moved = text.replace('"questions": [', '"extra": 1,\n    "questions": [')
		expect(textOf(moved, problemSpan(problems[1]!, moved)))
			.toBe('"StarRating"')

		const parsed = JSON.parse(text)
		parsed.slots.questions.length = 1
		const shortened = JSON.stringify(parsed, null, 2)
		const fallback = problemSpan(problems[1]!, shortened)!
		// `slots.questions[4].type` no longer exists: the nearest existing node is the `questions` array.
		expect(textOf(shortened, fallback))
			.toBe('"questions"')
	})

	it('returns null when the draft is not valid JSON, and maps a syntax error onto the failing text', () => {
		const { problems, text } = problemsOf('survey', 'survey-ai-draft')
		expect(problemSpan(problems[0]!, '{ not json'))
			.toBeNull()

		const broken = '{ "a": 1, nope }'
		const { problems: syntax } = problemsOf('sandbox', 'valid-interactive', {
			message: 'Expected double-quoted property name in JSON at position 10 (line 1 column 11)',
			sourceText: broken,
		})
		expect(textOf(broken, problemSpan(syntax[0]!, text)))
			.toBe('n')
	})
})

describe('groupProblems', () => {
	it('shows the diagnostics of one evaluation cycle as one entry that lists the members', () => {
		const { problems } = problemsOf('survey', 'survey-cycle')
		expect(problems.map(problem => problem.code))
			.toEqual(['property-evaluation-cycle', 'property-evaluation-cycle', 'property-evaluation-cycle', 'property-evaluation-cycle'])
		const entries = groupProblems(problems)
		expect(entries)
			.toHaveLength(1)
		const entry = entries[0]!
		expect(entry.kind)
			.toBe('cycle')
		if (entry.kind !== 'cycle')
			return
		// Core's diagnostics are carried through untouched, in Core's order.
		expect(entry.problems)
			.toEqual(problems)
		expect(entry.members.length)
			.toBeGreaterThanOrEqual(entry.problems.length)
		expect(entry.members.every(member => /^[\w-]+\.\w+$/.test(member)))
			.toBe(true)
	})

	it('leaves other diagnostics, and a cycle reported once, as single rows in Core order', () => {
		const { problems } = problemsOf('survey', 'survey-ai-draft')
		expect(groupProblems(problems)
			.map(entry => entry.kind))
			.toEqual(problems.map(() => 'problem'))

		const [first] = problemsOf('survey', 'survey-cycle').problems
		expect(groupProblems([first!])
			.map(entry => entry.kind))
			.toEqual(['problem'])
	})

	it('keeps a syntax error first and ungrouped ahead of a grouped cycle', () => {
		const { problems } = problemsOf('survey', 'survey-cycle', { message: 'Unexpected token', sourceText: '{' })
		expect(groupProblems(problems)
			.map(entry => entry.kind))
			.toEqual(['problem', 'cycle'])
	})
})
