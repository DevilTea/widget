/**
 * The Quote rules tour's step predicates against REAL `@deviltea/widget-core` Runtimes built from the actual
 * `quote-default` and `quote-buggy-rule` presets, read through the exact passive `TutorialRuntimeReader` the engine
 * uses (`createRuntimeReader`). Every action-gated stage is checked false before and true after the scripted writes,
 * and one test walks the whole script through the real `createTutorialEngine`.
 */

import type { TutorialActions, TutorialStepDefinition } from './types'
import { describe, expect, it, vi } from 'vitest'
import { translatePresentationMessage } from '../i18n/presentation-messages'
import { createQuoteRuntime, presetText, widgetOfType } from '../showcases/quote-rules/test-support'
import { createTutorialEngine } from './engine'
import { createRuntimeReader } from './inspection-reader'
import { QUOTE_RULES_TOUR_ID, quoteRulesTourScript } from './quote-rules-script'

function setup(sourceText?: string) {
	const { runtime } = createQuoteRuntime(sourceText)
	return { runtime, reader: createRuntimeReader(runtime) }
}

function step(id: string): TutorialStepDefinition {
	const found = quoteRulesTourScript.steps.find(candidate => candidate.id === id)
	if (found === undefined)
		throw new Error(`No step "${id}"`)
	return found
}

function stage(id: string, index = 0) {
	const predicate = step(id).stages[index]?.isComplete
	if (predicate === undefined)
		throw new Error(`Step "${id}" stage ${index} has no predicate`)
	return predicate
}

describe('quoteRulesTourScript shape', () => {
	it('has the eight steps under the tour id the showcase shares', () => {
		expect(quoteRulesTourScript.id)
			.toBe(QUOTE_RULES_TOUR_ID)
		expect(QUOTE_RULES_TOUR_ID)
			.toBe('quote-rules')
		expect(quoteRulesTourScript.steps.map(candidate => candidate.id))
			.toEqual(['orient', 'same-rules', 'rules', 'config-schema', 'invalid-config', 'isolated-exception', 'map-the-views', 'hand-back'])
	})

	it('observes exactly the members its predicates read', () => {
		expect(quoteRulesTourScript.observationTargets)
			.toEqual([
				{ widgetId: 'flyers', member: { type: 'state', key: 'quantity' } },
				{ widgetId: 'rush', member: { type: 'state', key: 'enabled' } },
				{ widgetId: 'delivery', member: { type: 'state', key: 'method' } },
			])
	})

	it('only names widgets and members that exist in quote-default', () => {
		const { reader } = setup()
		for (const { widgetId, member } of quoteRulesTourScript.observationTargets) {
			expect(member.type)
				.toBe('state')
			expect(reader.readState(widgetId, member.key), `${widgetId}.${member.key}`)
				.not
				.toBeUndefined()
		}
	})

	it('spotlights only targets the renderers stamp (`quote-<widget id>`, or the two panels) and widgets that exist', () => {
		const { runtime } = setup()
		const panels = new Set(['quote-same-rules', 'quote-isolated'])
		for (const candidate of quoteRulesTourScript.steps) {
			if (candidate.target === null || candidate.target === 'preview')
				continue
			if (panels.has(candidate.target))
				continue
			expect(candidate.target)
				.toMatch(/^quote-[a-z-]+$/)
			expect(runtime.getWidget(candidate.target.replace(/^quote-/, '')), candidate.id)
				.not
				.toBeNull()
		}
	})

	it('has a zh-TW translation for every title, prompt, reveal and action link label', () => {
		const sources = new Set<string>()
		for (const candidate of quoteRulesTourScript.steps) {
			sources.add(candidate.title)
			for (const { prompt, reveal } of candidate.stages) {
				sources.add(prompt)
				sources.add(reveal)
			}
			for (const link of (candidate.links ?? []).filter(({ id }) => !id.startsWith('view-')))
				sources.add(link.label)
		}
		const untranslated = [...sources].filter(source => translatePresentationMessage('zh-TW', source) === source)
		expect(untranslated)
			.toEqual([])
	})
})

describe('step "same-rules"', () => {
	it('is false until the flyers quantity is a number other than the authored 500', () => {
		const { runtime, reader } = setup()
		const flyers = widgetOfType(runtime, 'flyers', 'Item')
		const complete = stage('same-rules')
		expect(complete(reader))
			.toBe(false)
		flyers.state.quantity.set(500)
		expect(complete(reader))
			.toBe(false)
		flyers.state.quantity.set(0)
		expect(complete(reader))
			.toBe(false)
		flyers.state.quantity.set(520)
		expect(complete(reader))
			.toBe(true)
	})
})

describe('step "rules"', () => {
	it('needs both rush switched on and courier chosen', () => {
		const { runtime, reader } = setup()
		const complete = stage('rules')
		expect(complete(reader))
			.toBe(false)
		widgetOfType(runtime, 'rush', 'RushSurcharge').state.enabled.set(true)
		expect(complete(reader))
			.toBe(false)
		widgetOfType(runtime, 'delivery', 'Delivery').state.method.set('courier')
		expect(complete(reader))
			.toBe(true)
	})
})

describe('step "isolated-exception"', () => {
	const complete = stage('isolated-exception')

	it('is false in the default quote however low the quantity: that document has a rush widget and no defect to show', () => {
		const { runtime, reader } = setup()
		widgetOfType(runtime, 'flyers', 'Item').state.quantity.set(50)
		expect(complete(reader))
			.toBe(false)
	})

	it('is true in the buggy-rule quote once the flyers are below 90, and not before', () => {
		const { runtime, reader } = setup(presetText('quote-buggy-rule'))
		const flyers = widgetOfType(runtime, 'flyers', 'Item')
		expect(complete(reader))
			.toBe(false)
		flyers.state.quantity.set(90)
		expect(complete(reader))
			.toBe(false)
		flyers.state.quantity.set(50)
		expect(complete(reader))
			.toBe(true)
	})

	it('says what the Lab cannot show: a throwing Property keeps its last completed result in inspection', () => {
		expect(step('isolated-exception').stages[0].reveal)
			.toContain('it cannot show that exception')
	})
})

describe('the whole script on a real Runtime', () => {
	it('walks eight steps with the scripted interactions, each revealing before Next enables', () => {
		const { runtime, reader } = setup()
		const flyers = widgetOfType(runtime, 'flyers', 'Item')
		const engine = createTutorialEngine(quoteRulesTourScript)
		const actions: TutorialActions = {
			setFocus: vi.fn(),
			activateTab: vi.fn(),
			openImplementation: vi.fn(),
		}
		const settle = (): void => {
			engine.recheck(reader)
		}
		const expectStep = (id: string, canAdvance: boolean): void => {
			expect(engine.getSnapshot().step?.id)
				.toBe(id)
			expect(engine.getSnapshot().canAdvance, `${id} canAdvance`)
				.toBe(canAdvance)
		}

		engine.start(actions)
		settle()
		expectStep('orient', true)
		engine.next(actions)

		settle()
		expectStep('same-rules', false)
		flyers.state.quantity.set(520)
		settle()
		expectStep('same-rules', true)
		engine.next(actions)

		settle()
		expectStep('rules', false)
		widgetOfType(runtime, 'rush', 'RushSurcharge').state.enabled.set(true)
		widgetOfType(runtime, 'delivery', 'Delivery').state.method.set('courier')
		settle()
		expectStep('rules', true)
		engine.next(actions)

		for (const id of ['config-schema', 'invalid-config']) {
			settle()
			expectStep(id, true)
			engine.next(actions)
		}

		// The visitor loads the buggy-rule preset: a different Runtime, read by the same script.
		const buggy = setup(presetText('quote-buggy-rule'))
		settle()
		expectStep('isolated-exception', false)
		const buggyEngineReader = buggy.reader
		widgetOfType(buggy.runtime, 'flyers', 'Item').state.quantity.set(50)
		engine.recheck(buggyEngineReader)
		expectStep('isolated-exception', true)
		engine.next(actions)

		for (const id of ['map-the-views', 'hand-back']) {
			settle()
			expectStep(id, true)
			engine.next(actions)
		}
		expect(engine.getSnapshot().status)
			.toBe('completed')
	})
})
