import type { SourceParseError } from './types'
import { createWidgetDocument } from '@deviltea/widget-core'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { getShowcase } from '../showcases/registry'
import { collectProblems, problemSpan } from './problems'

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
