/**
 * The Legacy document repair tour's step predicates against a REAL `@deviltea/widget-core` Runtime built from the actual
 * `repair-default` preset, read through the exact passive `TutorialRuntimeReader` the engine uses (`createRuntimeReader`). The
 * scripted interactions are done through the real host (`createRepairHost`), which mirrors its sessions into the drafts'
 * State; every action-gated stage is checked false before and true after, and one test walks the whole script through the real
 * `createTutorialEngine`.
 */

import type { TutorialActions, TutorialStepDefinition } from './types'
import { describe, expect, it, vi } from 'vitest'
import { translatePresentationMessage } from '../i18n/presentation-messages'
import { createRepairHost } from '../showcases/document-repair/renderers/repair-host'
import { createRepairRuntime, widgetsOf } from '../showcases/document-repair/test-support'
import { DOCUMENT_REPAIR_TOUR_ID, documentRepairTourScript } from './document-repair-script'
import { createTutorialEngine } from './engine'
import { createRuntimeReader } from './inspection-reader'

function setup() {
	const { runtime } = createRepairRuntime()
	const { host } = createRepairHost(runtime)
	return { runtime, host, widgets: widgetsOf(runtime), reader: createRuntimeReader(runtime) }
}

function step(id: string): TutorialStepDefinition {
	const found = documentRepairTourScript.steps.find(candidate => candidate.id === id)
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

describe('documentRepairTourScript shape', () => {
	it('has the thirteen steps under the tour id the showcase shares', () => {
		expect(documentRepairTourScript.id)
			.toBe(DOCUMENT_REPAIR_TOUR_ID)
		expect(DOCUMENT_REPAIR_TOUR_ID)
			.toBe('document-repair')
		expect(documentRepairTourScript.steps.map(candidate => candidate.id))
			.toEqual(['orient', 'findings', 'open-draft', 'plan', 'first-step', 'other-editor', 'conflict', 're-plan', 'finish-repair', 'preview', 'no-rule', 'map-the-views', 'hand-back'])
	})

	it('observes exactly the members its predicates read, and they exist in the default preset', () => {
		expect(documentRepairTourScript.observationTargets)
			.toEqual([
				{ widgetId: 'draft-v1', member: { type: 'state', key: 'revision' } },
				{ widgetId: 'draft-v1', member: { type: 'state', key: 'appRevision' } },
				{ widgetId: 'draft-v1', member: { type: 'state', key: 'repaired' } },
				{ widgetId: 'draft-poll', member: { type: 'state', key: 'revision' } },
				{ widgetId: 'draft-poll', member: { type: 'state', key: 'repaired' } },
			])
		const { reader } = setup()
		for (const { widgetId, member } of documentRepairTourScript.observationTargets) {
			expect(reader.readState(widgetId, member.key), `${widgetId}.${member.key}`)
				.not
				.toBeUndefined()
		}
	})

	it('spotlights only targets the renderers stamp (`repair-<widget id>` or one of the named panels)', () => {
		const { runtime } = setup()
		const panels = new Set(['repair-plan', 'repair-diagnostics', 'repair-log', 'repair-result', 'repair-preview', 'repair-alert'])
		for (const candidate of documentRepairTourScript.steps) {
			if (candidate.target === null || panels.has(candidate.target))
				continue
			expect(candidate.target)
				.toMatch(/^repair-[a-z0-9-]+$/)
			expect(runtime.getWidget(candidate.target.replace(/^repair-/, '')), candidate.id)
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
		for (const candidate of documentRepairTourScript.steps) {
			candidate.onEnter?.(actions)
			for (const link of candidate.links ?? [])
				link.run?.(actions)
		}
		expect(focused.length)
			.toBeGreaterThan(8)
		for (const [widgetId, member] of focused) {
			const widget = runtime.getWidget(widgetId)
			expect(widget, widgetId)
				.not
				.toBeNull()
			if (member !== undefined && widget?.type === 'SavedDraft') {
				const members = member.type === 'state' ? widget.state : widget.properties
				expect(Object.keys(members), `${widgetId} ${member.type} ${member.name}`)
					.toContain(member.name)
			}
		}
	})

	it('has a zh-TW translation for every title, prompt, reveal and action link label', () => {
		const sources = new Set<string>()
		for (const candidate of documentRepairTourScript.steps) {
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

	it('says plainly that Core repairs, migrates and persists nothing, and claims none of what Core does not do', () => {
		const text = documentRepairTourScript.steps.flatMap(candidate => [candidate.title, ...candidate.stages.flatMap(({ prompt, reveal }) => [prompt, reveal])])
			.join('\n')
		expect(text)
			.toContain('Core does not migrate, version, repair or quarantine anything')
		expect(text)
			.toContain('nothing is saved anywhere')
		for (const claim of ['undo', 'history', 'partial Runtime', 'append', 'by widget id'])
			expect(text.toLowerCase(), claim).not.toContain(claim.toLowerCase())
	})
})

describe('step "open-draft"', () => {
	it('is false until a session is open on the 1.x draft, and the other drafts do not count', () => {
		const { host, reader } = setup()
		const complete = stage('open-draft')
		expect(complete(reader))
			.toBe(false)
		host.open('draft-v2')
		expect(complete(reader))
			.toBe(false)
		host.open('draft-v1')
		expect(complete(reader))
			.toBe(true)
	})
})

describe('steps "first-step", "other-editor", "re-plan" and "finish-repair"', () => {
	it('"first-step" completes with the first commit; "other-editor" only when the app is behind, after that', () => {
		const { host, reader } = setup()
		host.open('draft-v1')
		expect(stage('first-step')(reader))
			.toBe(false)
		host.applyNext('draft-v1')
		expect(stage('first-step')(reader))
			.toBe(true)
		expect(stage('other-editor')(reader))
			.toBe(false)
		host.otherEditorSaves('draft-v1')
		expect(stage('other-editor')(reader))
			.toBe(true)
	})

	it('"re-plan" is false while the app is behind and true after it re-read', () => {
		const { host, reader } = setup()
		host.open('draft-v1')
		host.applyNext('draft-v1')
		host.otherEditorSaves('draft-v1')
		const complete = stage('re-plan')
		expect(complete(reader))
			.toBe(false)
		host.applyNext('draft-v1')
		expect(complete(reader))
			.toBe(false)
		host.reread('draft-v1')
		expect(complete(reader))
			.toBe(true)
	})

	it('"finish-repair" is true only when the document is valid', () => {
		const { host, reader } = setup()
		host.open('draft-v1')
		const complete = stage('finish-repair')
		for (let count = 0; count < 5; count++) {
			host.applyNext('draft-v1')
			expect(complete(reader))
				.toBe(false)
		}
		host.applyNext('draft-v1')
		expect(complete(reader))
			.toBe(true)
	})

	it('names the plan the way the page shows it: the first step moves the slot and the last replaces a whole element', () => {
		const { host } = setup()
		host.open('draft-v1')
		const plan = host.sessions.value.get('draft-v1')!.plan
		expect(plan[0]!.id)
			.toBe('rename-slot')
		expect(plan.at(-1)!.id)
			.toBe('rewrite-no-id')
		expect(step('plan').stages[0].reveal)
			.toContain('moves the slot "items" to "notices"')
	})
})

describe('step "no-rule"', () => {
	it('is true once the poll draft has taken its step, and the draft is still invalid', () => {
		const { host, reader, widgets } = setup()
		host.open('draft-poll')
		const complete = stage('no-rule')
		expect(complete(reader))
			.toBe(false)
		host.applyNext('draft-poll')
		expect(complete(reader))
			.toBe(true)
		expect(widgets.poll.state.repaired.get())
			.toBe(false)
	})
})

describe('the whole script on a real Runtime and host', () => {
	it('walks thirteen steps with the scripted interactions, each revealing before Next enables', () => {
		const { host, reader } = setup()
		const engine = createTutorialEngine(documentRepairTourScript)
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
		for (const id of ['orient', 'findings']) {
			settle()
			expectStep(id, true)
			engine.next(actions)
		}

		settle()
		expectStep('open-draft', false)
		host.open('draft-v1')
		settle()
		expectStep('open-draft', true)
		engine.next(actions)

		settle()
		expectStep('plan', true)
		engine.next(actions)

		settle()
		expectStep('first-step', false)
		host.applyNext('draft-v1')
		settle()
		expectStep('first-step', true)
		engine.next(actions)

		settle()
		expectStep('other-editor', false)
		host.otherEditorSaves('draft-v1')
		settle()
		expectStep('other-editor', true)
		engine.next(actions)

		settle()
		expectStep('conflict', true)
		expect(host.applyNext('draft-v1'))
			.toMatchObject({ kind: 'failed', code: 'document-revision-conflict' })
		engine.next(actions)

		settle()
		expectStep('re-plan', false)
		host.reread('draft-v1')
		settle()
		expectStep('re-plan', true)
		engine.next(actions)

		settle()
		expectStep('finish-repair', false)
		for (let count = 0; count < 5; count++)
			host.applyNext('draft-v1')
		settle()
		expectStep('finish-repair', true)
		engine.next(actions)

		settle()
		expectStep('preview', true)
		engine.next(actions)

		settle()
		expectStep('no-rule', false)
		host.open('draft-poll')
		host.applyNext('draft-poll')
		settle()
		expectStep('no-rule', true)
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
