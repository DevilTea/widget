/**
 * The renderer packs tour's step predicates against a REAL `@deviltea/widget-core` Runtime built from the actual `packs-default`
 * preset, read through the exact passive `TutorialRuntimeReader` the engine uses (`createRuntimeReader`). The scripted
 * interactions are done through the widgets' own State and Methods, as the renderers of either pack do; every action-gated stage is
 * checked false before and true after, and one test walks the whole script through the real `createTutorialEngine`.
 */

import type { TutorialActions, TutorialStepDefinition } from './types'
import { describe, expect, it, vi } from 'vitest'
import { translatePresentationMessage } from '../i18n/presentation-messages'
import { createPacksRuntime, widgetsOf } from '../showcases/renderer-packs/test-support'
import { createTutorialEngine } from './engine'
import { createRuntimeReader } from './inspection-reader'
import { RENDERER_PACKS_TOUR_ID, rendererPacksTourScript } from './renderer-packs-script'

function setup() {
	const { runtime } = createPacksRuntime()
	return { runtime, widgets: widgetsOf(runtime), reader: createRuntimeReader(runtime) }
}

function step(id: string): TutorialStepDefinition {
	const found = rendererPacksTourScript.steps.find(candidate => candidate.id === id)
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

describe('rendererPacksTourScript shape', () => {
	it('has the ten steps under the tour id the showcase shares', () => {
		expect(rendererPacksTourScript.id)
			.toBe(RENDERER_PACKS_TOUR_ID)
		expect(RENDERER_PACKS_TOUR_ID)
			.toBe('renderer-packs')
		expect(rendererPacksTourScript.steps.map(candidate => candidate.id))
			.toEqual(['orient', 'type', 'switch-pack', 'density', 'mode', 'ask', 'confirm', 'side-by-side', 'map-the-views', 'hand-back'])
	})

	it('observes exactly the members its predicates read, and they exist in the default preset', () => {
		expect(rendererPacksTourScript.observationTargets)
			.toEqual([
				{ widgetId: 'workspace-name', member: { type: 'state', key: 'value' } },
				{ widgetId: 'appearance', member: { type: 'state', key: 'density' } },
				{ widgetId: 'appearance', member: { type: 'state', key: 'mode' } },
				{ widgetId: 'archive-workspace', member: { type: 'state', key: 'confirming' } },
				{ widgetId: 'notifier', member: { type: 'state', key: 'items' } },
			])
		const { reader } = setup()
		for (const { widgetId, member } of rendererPacksTourScript.observationTargets) {
			expect(reader.readState(widgetId, member.key), `${widgetId}.${member.key}`)
				.not
				.toBeUndefined()
		}
	})

	it('spotlights only targets the renderers of both packs stamp (`packs-<widget id>` or `packs-chooser`)', () => {
		const { runtime } = setup()
		for (const candidate of rendererPacksTourScript.steps) {
			if (candidate.target === null || candidate.target === 'packs-chooser')
				continue
			expect(candidate.target)
				.toMatch(/^packs-[a-z0-9-]+$/)
			expect(runtime.getWidget(candidate.target.replace(/^packs-/, '')), candidate.id)
				.not
				.toBeNull()
		}
	})

	it('focuses only widgets and members the plugins declare', () => {
		const { runtime } = setup()
		const focused: [string, { type: string, name: string } | undefined][] = []
		const actions: TutorialActions = {
			setFocus: (widgetId, member) => focused.push([widgetId, member]),
			activateTab: () => {},
			openTool: () => {},
		}
		for (const candidate of rendererPacksTourScript.steps) {
			candidate.onEnter?.(actions)
			for (const link of candidate.links ?? [])
				link.run?.(actions)
		}
		expect(focused.length)
			.toBeGreaterThan(5)
		for (const [widgetId, member] of focused) {
			const widget = runtime.getWidget(widgetId)
			expect(widget, widgetId)
				.not
				.toBeNull()
			if (member === undefined || widget === null)
				continue
			const surfaces = widget as unknown as Record<'state' | 'properties' | 'methods', Record<string, unknown> | undefined>
			const members = surfaces[member.type === 'state' ? 'state' : member.type === 'property' ? 'properties' : 'methods']
			expect(Object.keys(members ?? {}), `${widgetId} ${member.type} ${member.name}`)
				.toContain(member.name)
		}
	})

	it('has a zh-TW translation for every title, prompt, reveal and action link label', () => {
		const sources = new Set<string>()
		for (const candidate of rendererPacksTourScript.steps) {
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

	it('says that a pack is the host\'s choice and no widget State, and claims no provider shadowing or nearest-ancestor lookup', () => {
		const text = rendererPacksTourScript.steps.flatMap(candidate => [candidate.title, ...candidate.stages.flatMap(({ prompt, reveal }) => [prompt, reveal])])
			.join('\n')
		expect(text)
			.toContain('not widget State')
		expect(text)
			.toContain('Core has no nearest-ancestor or provider lookup')
		expect(text.toLowerCase())
			.not
			.toContain('shadows')
	})
})

describe('the gated steps', () => {
	it('"type" is false until the Workspace name differs from the document\'s', () => {
		const { widgets, reader } = setup()
		expect(stage('type')(reader))
			.toBe(false)
		widgets.workspaceName.state.value.set('Harbour Studio')
		expect(stage('type')(reader))
			.toBe(false)
		widgets.workspaceName.state.value.set('Dockside')
		expect(stage('type')(reader))
			.toBe(true)
	})

	it('"density" is true only for compact, and "mode" only for dark', () => {
		const { widgets, reader } = setup()
		expect(stage('density')(reader))
			.toBe(false)
		expect(stage('mode')(reader))
			.toBe(false)
		widgets.appearance.state.density.set('compact')
		expect(stage('density')(reader))
			.toBe(true)
		widgets.appearance.state.mode.set('light')
		expect(stage('mode')(reader))
			.toBe(false)
		widgets.appearance.state.mode.set('dark')
		expect(stage('mode')(reader))
			.toBe(true)
	})

	it('"ask" is true while the archive confirmation is open, and "confirm" only once the Notifier holds a notification', () => {
		const { widgets, reader } = setup()
		expect(stage('ask')(reader))
			.toBe(false)
		widgets.clearCache.methods.ask()
		expect(stage('ask')(reader))
			.toBe(false)
		widgets.archive.methods.ask()
		expect(stage('ask')(reader))
			.toBe(true)
		expect(stage('confirm')(reader))
			.toBe(false)
		widgets.archive.methods.cancel()
		expect(stage('confirm')(reader))
			.toBe(false)
		widgets.archive.methods.ask()
		widgets.archive.methods.confirm()
		expect(stage('confirm')(reader))
			.toBe(true)
	})
})

describe('the whole script on a real Runtime', () => {
	it('walks ten steps with the scripted interactions, each revealing before Next enables', () => {
		const { widgets, reader } = setup()
		const engine = createTutorialEngine(rendererPacksTourScript)
		const actions: TutorialActions = {
			setFocus: vi.fn(),
			activateTab: vi.fn(),
			openTool: vi.fn(),
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
		expectStep('type', false)
		widgets.workspaceName.state.value.set('Dockside')
		settle()
		expectStep('type', true)
		engine.next(actions)

		settle()
		expectStep('switch-pack', true)
		engine.next(actions)

		settle()
		expectStep('density', false)
		widgets.appearance.state.density.set('compact')
		settle()
		expectStep('density', true)
		engine.next(actions)

		settle()
		expectStep('mode', false)
		widgets.appearance.state.mode.set('dark')
		settle()
		expectStep('mode', true)
		engine.next(actions)

		settle()
		expectStep('ask', false)
		widgets.archive.methods.ask()
		settle()
		expectStep('ask', true)
		engine.next(actions)

		settle()
		expectStep('confirm', false)
		widgets.archive.methods.confirm()
		settle()
		expectStep('confirm', true)
		engine.next(actions)

		for (const id of ['side-by-side', 'map-the-views', 'hand-back']) {
			settle()
			expectStep(id, true)
			engine.next(actions)
		}
		expect(engine.getSnapshot().status)
			.toBe('completed')
	})
})
