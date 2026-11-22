import type { BlueprintInspection, InspectionNodeId } from '@deviltea/widget-core/inspection'
import type { WhySentence } from './why'
import { inspectBlueprint } from '@deviltea/widget-core/inspection'
import { describe, expect, it } from 'vitest'
import { getShowcase } from '../showcases/registry'
import { buildWhySentences } from './why'

interface Compiled {
	readonly inspection: BlueprintInspection
	readonly sentencesOf: (widgetId: string) => readonly WhySentence[]
	readonly nodeIdOf: (widgetId: string) => InspectionNodeId
}

function compile(showcaseId: string, sourceText?: string): Compiled {
	const showcase = getShowcase(showcaseId)!
	const inspection = inspectBlueprint(showcase.system.createBlueprint(JSON.parse(sourceText ?? showcase.defaultPreset.sourceText)))
	const nodeIdOf = (widgetId: string): InspectionNodeId => {
		const node = inspection.nodes.find(candidate => candidate.node.id === widgetId)
		if (node === undefined)
			throw new Error(`no widget ${widgetId}`)
		return node.nodeId
	}
	return {
		inspection,
		nodeIdOf,
		sentencesOf: (widgetId) => {
			const node = inspection.getNode(nodeIdOf(widgetId))!
			return buildWhySentences(inspection, node.nodeId, node.resolved ? showcase.configSchemas[node.node.type] ?? null : null)
		},
	}
}

/** One line per sentence: `property operation #widget members [fields]`. */
function lines(sentences: readonly WhySentence[]): string[] {
	return sentences.map((sentence) => {
		const members = sentence.members.map(member => `${member.type}:${member.name}`)
			.join(',')
		const fields = sentence.fields.map(field => field.name)
			.join(',')
		return `${sentence.property} ${sentence.operation} #${sentence.target.widgetId} ${members} [${fields}]`
	})
}

describe('buildWhySentences — Interactive Survey (open day)', () => {
	const survey = compile('survey')

	it('names the question a condition reads and the config field that holds the condition', () => {
		expect(lines(survey.sentencesOf('sessions')))
			.toEqual([
				'text reads #open-day state:language []',
				'options reads #mode property:value [enabledWhen]',
				'options reads #guests property:value [visibleWhen]',
				'errors reads #open-day state:language []',
				// The rule reads `guests` through the `rules` field (the dependency's path says so), not through the option.
				'errors reads #guests property:value [when]',
			])
		const options = survey.sentencesOf('sessions')
			.find(sentence => sentence.property === 'options' && sentence.target.widgetId === 'mode')!
		expect(options.fields)
			.toEqual([{
				name: 'enabledWhen',
				path: ['options', 1, 'enabledWhen'],
				description: 'Allow choosing the option only while this holds (it is shown disabled otherwise). A selected option that becomes disabled is dropped from the effective answer and reported as an invalid-option error.',
			}])
	})

	it('reads a top-level condition field, and joins the description\'s line wraps', () => {
		const [, visible] = survey.sentencesOf('guests')
		expect(visible)
			.toMatchObject({
				property: 'visible',
				operation: 'reads',
				target: { widgetId: 'mode', widgetType: 'SingleChoice', nodeId: survey.nodeIdOf('mode') },
				members: [{ type: 'property', name: 'value' }],
				fields: [{ name: 'visibleWhen', path: ['visibleWhen'] }],
			})
		expect(visible!.fields[0]!.description)
			.toBe('Show the question only while this holds; absent means always visible. A hidden question has no value. The stored answer is kept while hidden and returns when the question is shown again.')
		expect(lines(survey.sentencesOf('phone')))
			.toContain('required reads #mode property:value [required]')
	})

	it('leaves out the widget\'s own members: `mode` only reads the survey language', () => {
		expect(lines(survey.sentencesOf('mode')))
			.toEqual(['text reads #open-day state:language []', 'errors reads #open-day state:language []'])
	})

	it('groups the members one Property reads of one widget, in declaration order', () => {
		expect(lines(survey.sentencesOf('open-day')))
			.toEqual(['mode', 'guests', 'sessions', 'phone'].map(id => `response reads #${id} property:visible,property:required,property:value,property:errors []`))
	})

	it('has nothing to say about a widget that did not resolve', () => {
		const draft = compile('survey', getShowcase('survey')!.presets.find(preset => preset.id === 'survey-ai-draft')!.sourceText)
		const unresolved = draft.inspection.nodes.find(node => !node.resolved)!
		expect(buildWhySentences(draft.inspection, unresolved.nodeId, null))
			.toEqual([])
	})
})

describe('buildWhySentences — Trip budget splitter', () => {
	const trip = compile('trip-budget')

	it('says when a Property calls a Method of another widget, with no field when no config value names it', () => {
		expect(lines(trip.sentencesOf('hotel')))
			.toEqual([
				'title reads #lisbon state:language []',
				'view reads #lisbon state:language []',
				'view reads #currency property:base []',
				'roster reads #ana property:name [paidBy,split]',
				'roster reads #ben property:name [split]',
				'roster reads #chloe property:name [split]',
				'roster reads #dev property:name [split]',
				'currencies reads #currency property:codes []',
				'errors reads #lisbon state:language []',
				'amountBase invokes #currency method:convert []',
				'breakdown reads #currency property:base,property:rates []',
			])
	})

	it('describes a @widgetRef field with its generated description', () => {
		const roster = trip.sentencesOf('hotel')
			.find(sentence => sentence.property === 'roster' && sentence.target.widgetId === 'ana')!
		expect(roster.fields[0])
			.toEqual({
				name: 'paidBy',
				path: ['paidBy'],
				description: 'The id of the Person who paid at the start. It must exist in the same trip. Must be the id of a widget of type Person in the same document.',
			})
	})

	it('follows the chain through the slots: the settlement reads every person and every expense', () => {
		expect(lines(trip.sentencesOf('settlement')))
			.toEqual([
				'view reads #lisbon state:language []',
				'view reads #currency property:base []',
				...['ana', 'ben', 'chloe', 'dev'].map(id => `balances reads #${id} property:name,property:balance []`),
				...['hotel', 'dinner', 'museum', 'taxi', 'market'].map(id => `total reads #${id} property:counted,property:amountBase []`),
				'transfers invokes #currency method:roundTransfer []',
			])
	})
})

describe('buildWhySentences — widgets with no dependencies', () => {
	it('is empty for a widget whose Properties read no other widget (quote-rules `flyers`)', () => {
		const quote = compile('quote-rules')
		expect(quote.sentencesOf('flyers'))
			.toEqual([])
		// ...while the rule that reads it is explained.
		expect(lines(quote.sentencesOf('volume')))
			.toEqual(['adjustment reads #quote property:subtotalCents,property:totalQuantity []'])
	})

	it('names a field without a schema description by its name only (the sandbox has no config schemas)', () => {
		const sandbox = compile('sandbox')
		expect(sandbox.sentencesOf('title'))
			.toEqual([])
		expect(sandbox.sentencesOf('summary-1')
			.map(sentence => sentence.fields))
			.toEqual([[{ name: 'counterId', path: ['counterId'], description: '' }]])
	})
})
