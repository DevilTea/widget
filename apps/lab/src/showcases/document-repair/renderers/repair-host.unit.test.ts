/**
 * The host's side of the application, against real Core Runtimes and Documents: it opens a session on a copy of a stored draft,
 * applies the plan with the revision it was planned at, logs every commit, meets a stale revision when another editor saves,
 * re-plans, creates a preview Runtime only for a valid document, and releases everything on close, reset and dispose.
 */

import type { RepairStep } from '../domain'
import { describe, expect, it } from 'vitest'
import { planRepair } from '../domain'
import { legacyPoll, legacyV1, legacyV3 } from '../fixtures'
import { createRepairRuntime, valueOf, widgetsOf } from '../test-support'
import { createRepairHost, MAX_LOG, otherEditorPatch } from './repair-host'

function setup() {
	const { runtime } = createRepairRuntime()
	const handle = createRepairHost(runtime)
	return { runtime, widgets: widgetsOf(runtime), ...handle }
}

const noteStep = (patch: RepairStep['patch']): RepairStep => ({ id: 'custom', title: { en: 'Custom' }, why: { en: 'A test step' }, patch })

function view(host: ReturnType<typeof setup>['host'], id: string) {
	const found = host.sessions.value.get(id)
	if (found === undefined)
		throw new Error(`No session for ${id}`)
	return found
}

describe('open', () => {
	it('opens a session: revision 0 and the plan computed from the snapshot', () => {
		const { host, widgets } = setup()
		expect(host.open('draft-v1'))
			.toBe(true)
		const session = view(host, 'draft-v1')
		expect(session)
			.toMatchObject({ revision: 0, appRevision: 0, status: 'invalid', stale: false, preview: null, exported: null, lastOutcome: null, log: [] })
		expect(session.plan.map(step => step.id))
			.toEqual(['rename-slot', 'rename-type', 'rename-config-text', 'move-style', 'fix-duplicate-ids', 'rewrite-no-id'])
		expect(session.findings.diagnostics.map(diagnostic => diagnostic.code))
			.toContain('undeclared-widget-slot')
		expect([widgets.v1.state.revision.get(), widgets.v1.state.appRevision.get(), widgets.v1.state.repaired.get()])
			.toEqual([0, 0, false])
		expect(host.status.value)
			.toEqual({ kind: 'opened', values: { draft: 'draft-v1', revision: 0 } })
	})

	it('refuses an unknown draft, a widget that is not a draft and a second open of the same draft', () => {
		const { host } = setup()
		expect(host.open('nope'))
			.toBe(false)
		expect(host.open('desk'))
			.toBe(false)
		expect(host.open('draft-v1'))
			.toBe(true)
		expect(host.open('draft-v1'))
			.toBe(false)
		expect(host.sessions.value.size)
			.toBe(1)
	})

	it('opens a valid draft as valid with an empty plan', () => {
		const { host } = setup()
		host.open('draft-v3')
		expect(view(host, 'draft-v3'))
			.toMatchObject({ status: 'valid', plan: [] })
	})
})

describe('ownership of the stored draft', () => {
	it('hands Core a copy: changing the stored draft object after open() changes neither the document nor what the app plans from it', () => {
		const { host, runtime } = setup()
		const widget = runtime.getWidget('draft-v1')
		if (widget?.type !== 'SavedDraft')
			throw new Error('no draft-v1')
		// The application's own model of the stored draft is the very object the Property hands out (it is the Blueprint's config,
		// and it stays editable). Core retains the object it is given by reference, as revision 0, so handing it over would make
		// this edit part of every revision.
		const stored = valueOf(widget.properties.source.get()) as { config: { title: { en: string } }, slots: { items: { id?: string, type: string }[] } }
		host.open('draft-v1')
		const pristinePlan = planRepair(legacyV1, '1.x')
		const pristineDiagnostics = view(host, 'draft-v1').findings.diagnostics.length

		stored.slots.items.splice(1)
		stored.slots.items[0]!.type = 'Mutated'
		stored.config.title.en = 'Edited in the app'

		// Re-reading plans from, and compiles, Core's current snapshot: it must not have seen the edit.
		host.reread('draft-v1')
		const session = view(host, 'draft-v1')
		expect(session.plan)
			.toEqual(pristinePlan)
		expect(session.findings.diagnostics.length)
			.toBe(pristineDiagnostics)
		for (let count = 0; count < 6; count++)
			host.applyNext('draft-v1')
		host.exportJson('draft-v1')
		const exported = view(host, 'draft-v1').exported!
		expect(view(host, 'draft-v1').status)
			.toBe('valid')
		expect(exported)
			.not
			.toContain('Mutated')
		expect(exported)
			.not
			.toContain('Edited in the app')
		expect(JSON.parse(exported).slots.notices)
			.toHaveLength(4)
	})

	it('is the stored draft itself that the host never writes: it is unchanged after a whole repair', () => {
		const { host, widgets } = setup()
		host.open('draft-v1')
		for (let count = 0; count < 6; count++)
			host.applyNext('draft-v1')
		expect(JSON.stringify(valueOf(widgets.v1.properties.source.get())))
			.toBe(JSON.stringify(legacyV1))
	})
})

describe('apply next step', () => {
	it('applies the first step with the revision it was planned at, reads the new snapshot and plans again', () => {
		const { host, widgets } = setup()
		host.open('draft-v1')
		const outcome = host.applyNext('draft-v1')
		expect(outcome)
			.toEqual({ kind: 'applied', by: 'app', stepId: 'rename-slot', changed: true, from: 0, to: 1, operations: 2 })
		const session = view(host, 'draft-v1')
		expect([session.revision, session.appRevision, session.stale])
			.toEqual([1, 1, false])
		expect(session.plan.map(step => step.id))
			.toEqual(['rename-type', 'rename-config-text', 'move-style', 'fix-duplicate-ids', 'rewrite-no-id'])
		expect(session.findings.diagnostics.map(diagnostic => diagnostic.code))
			.not
			.toContain('undeclared-widget-slot')
		expect([widgets.v1.state.revision.get(), widgets.v1.state.appRevision.get()])
			.toEqual([1, 1])
		expect(host.status.value)
			.toEqual({ kind: 'applied', values: { step: 'rename-slot', from: 0, to: 1 } })
		expect(host.alert.value)
			.toBeNull()
	})

	it('repairs v1 step by step to a valid document, and the stored draft is what it was', () => {
		const { host, widgets } = setup()
		host.open('draft-v1')
		const before = JSON.stringify(legacyV1)
		for (let count = 0; count < 6; count++) {
			expect(host.applyNext('draft-v1'))
				.toMatchObject({ kind: 'applied', changed: true })
		}
		const session = view(host, 'draft-v1')
		expect(session)
			.toMatchObject({ revision: 6, status: 'valid', plan: [] })
		expect(host.applyNext('draft-v1'))
			.toBeNull()
		expect(widgets.v1.state.repaired.get())
			.toBe(true)
		expect(JSON.stringify(legacyV1))
			.toBe(before)
		expect(JSON.stringify(widgets.v1.properties.source.get()))
			.toBe(JSON.stringify({ ok: true, value: legacyV1 }))
	})

	it('logs every committed patch the document listener hears: previous to new revision and the number of operations', () => {
		const { host } = setup()
		host.open('draft-v2')
		host.applyNext('draft-v2')
		host.otherEditorSaves('draft-v2')
		expect(view(host, 'draft-v2').log)
			.toEqual([
				{ sequence: 1, by: 'app', from: 0, to: 1, operations: 4 },
				{ sequence: 2, by: 'other-editor', from: 1, to: 2, operations: 1 },
			])
	})

	it('reports a failed guard with Core\'s code and the index of the failing operation, and changes nothing', () => {
		const { host } = setup()
		host.open('draft-v2')
		const outcome = host.applyStep('draft-v2', noteStep([{ op: 'replace', path: ['config', 'title', 'en'], value: 'x' }, { op: 'test', path: ['id'], value: 'not-the-id' }]))
		expect(outcome)
			.toMatchObject({ kind: 'failed', by: 'app', stepId: 'custom', code: 'test-failed', operationIndex: 1 })
		expect(view(host, 'draft-v2'))
			.toMatchObject({ revision: 0, appRevision: 0, log: [] })
		expect(host.alert.value)
			.toMatchObject({ draftId: 'draft-v2', code: 'test-failed', operationIndex: 1 })
	})

	it('shows a patch that leaves the source equal as changed: false, with no new revision and no log entry', () => {
		const { host } = setup()
		host.open('draft-v2')
		const outcome = host.applyStep('draft-v2', noteStep([{ op: 'replace', path: ['id'], value: 'board' }]))
		expect(outcome)
			.toEqual({ kind: 'applied', by: 'app', stepId: 'custom', changed: false, from: 0, to: 0, operations: 1 })
		expect(view(host, 'draft-v2'))
			.toMatchObject({ revision: 0, log: [] })
		expect(host.status.value)
			.toEqual({ kind: 'no-change', values: { step: 'custom', revision: 0 } })
		expect(host.alert.value)
			.toBeNull()
	})
})

describe('another editor saves', () => {
	it('makes the app\'s next step fail with document-revision-conflict, expected and actual revision, and applies nothing', () => {
		const { host, widgets } = setup()
		host.open('draft-v1')
		host.applyNext('draft-v1')
		const other = host.otherEditorSaves('draft-v1')
		expect(other)
			.toEqual({ kind: 'applied', by: 'other-editor', stepId: null, changed: true, from: 1, to: 2, operations: 1 })
		const stale = view(host, 'draft-v1')
		expect([stale.revision, stale.appRevision, stale.stale])
			.toEqual([2, 1, true])
		expect([widgets.v1.state.revision.get(), widgets.v1.state.appRevision.get()])
			.toEqual([2, 1])

		const outcome = host.applyNext('draft-v1')
		expect(outcome)
			.toEqual({ kind: 'failed', by: 'app', stepId: 'rename-type', code: 'document-revision-conflict', message: expect.any(String), expectedRevision: 1, actualRevision: 2 })
		expect(host.alert.value)
			.toMatchObject({ code: 'document-revision-conflict', expectedRevision: 1, actualRevision: 2, stepId: 'rename-type' })
		expect(view(host, 'draft-v1').revision)
			.toBe(2)
	})

	it('re-read and re-plan reads the current snapshot, clears the alert and lets the app continue', () => {
		const { host } = setup()
		host.open('draft-v1')
		host.otherEditorSaves('draft-v1')
		expect(host.applyNext('draft-v1'))
			.toMatchObject({ kind: 'failed', code: 'document-revision-conflict', expectedRevision: 0, actualRevision: 1 })
		host.reread('draft-v1')
		const session = view(host, 'draft-v1')
		expect([session.revision, session.appRevision, session.stale, session.lastOutcome])
			.toEqual([1, 1, false, null])
		expect(session.plan[0]!.id)
			.toBe('rename-slot')
		expect(host.alert.value)
			.toBeNull()
		expect(host.applyNext('draft-v1'))
			.toMatchObject({ kind: 'applied', changed: true, from: 1, to: 2 })
	})

	it('edits the board title, or adds meta when there is none, and a non-object source makes an empty patch', () => {
		expect(otherEditorPatch(legacyV3))
			.toEqual([{ op: 'replace', path: ['config', 'title', 'en'], value: 'Maker space notices (edited)' }])
		expect(otherEditorPatch({ id: 'x' }))
			.toEqual([{ op: 'add', path: ['meta'], value: { editedBy: 'another editor' } }])
		expect(otherEditorPatch(5))
			.toEqual([])
	})

	it('keeps the log to the newest MAX_LOG entries', () => {
		const { host } = setup()
		host.open('draft-v3')
		for (let count = 0; count < MAX_LOG + 5; count++)
			host.otherEditorSaves('draft-v3')
		const { log } = view(host, 'draft-v3')
		expect(log)
			.toHaveLength(MAX_LOG)
		expect(log.at(-1)!.to)
			.toBe(MAX_LOG + 5)
	})
})

describe('preview and export', () => {
	it('creates a notice board Runtime from a valid document and disposes it when the document moves on', () => {
		const { host } = setup()
		host.open('draft-v3')
		expect(host.preview('draft-v3'))
			.toBe(true)
		const first = view(host, 'draft-v3').preview!
		expect(first.isDisposed)
			.toBe(false)
		expect(first.getWidget('board')?.type)
			.toBe('Board')
		host.otherEditorSaves('draft-v3')
		expect(first.isDisposed)
			.toBe(true)
		expect(view(host, 'draft-v3').preview)
			.toBeNull()
		host.preview('draft-v3')
		host.closePreview('draft-v3')
		expect(view(host, 'draft-v3').preview)
			.toBeNull()
	})

	it('creates no Runtime for an invalid document, however it got there', () => {
		const { host } = setup()
		host.open('draft-poll')
		expect(host.preview('draft-poll'))
			.toBe(false)
		host.applyNext('draft-poll')
		expect(view(host, 'draft-poll'))
			.toMatchObject({ status: 'invalid', plan: [], preview: null })
		expect(host.preview('draft-poll'))
			.toBe(false)
		expect(view(host, 'draft-poll').preview)
			.toBeNull()
		expect(view(host, 'draft-poll').findings.diagnostics.map(diagnostic => diagnostic.code))
			.toEqual(['unknown-widget-type'])
	})

	it('exports the document\'s current source as JSON text', () => {
		const { host } = setup()
		host.open('draft-v2')
		host.applyNext('draft-v2')
		host.exportJson('draft-v2')
		const { exported } = view(host, 'draft-v2')
		expect(JSON.parse(exported!).slots.notices[0].config.until)
			.toBe('2026-12-31')
		host.otherEditorSaves('draft-v2')
		expect(view(host, 'draft-v2').exported)
			.toBeNull()
	})

	it('does not export or preview without a session', () => {
		const { host } = setup()
		host.exportJson('draft-v1')
		expect(host.preview('draft-v1'))
			.toBe(false)
		expect(host.sessions.value.size)
			.toBe(0)
	})
})

describe('close, reset and dispose', () => {
	it('close ends one session: the preview is disposed, the State mirror is back to "no session", the document listener is gone', () => {
		const { host, widgets } = setup()
		host.open('draft-v3')
		host.preview('draft-v3')
		const preview = view(host, 'draft-v3').preview!
		host.close('draft-v3')
		expect(preview.isDisposed)
			.toBe(true)
		expect(host.sessions.value.has('draft-v3'))
			.toBe(false)
		expect([widgets.v3.state.revision.get(), widgets.v3.state.appRevision.get(), widgets.v3.state.repaired.get()])
			.toEqual([-1, -1, false])
		expect(host.status.value)
			.toEqual({ kind: 'closed', values: { draft: 'draft-v3' } })
		// It can be opened again, from the stored draft.
		expect(host.open('draft-v3'))
			.toBe(true)
	})

	it('reset closes every session, disposes every preview and clears the alert', () => {
		const { host } = setup()
		host.open('draft-v3')
		host.open('draft-v1')
		host.preview('draft-v3')
		const preview = view(host, 'draft-v3').preview!
		host.otherEditorSaves('draft-v1')
		host.applyNext('draft-v1')
		expect(host.alert.value)
			.not
			.toBeNull()
		host.resetAll()
		expect(preview.isDisposed)
			.toBe(true)
		expect(host.sessions.value.size)
			.toBe(0)
		expect(host.alert.value)
			.toBeNull()
		expect(host.status.value)
			.toEqual({ kind: 'reset', values: {} })
	})

	it('dispose releases every Runtime and stops touching the desk', () => {
		const { host, runtime, dispose } = setup()
		host.open('draft-v3')
		host.preview('draft-v3')
		const preview = view(host, 'draft-v3').preview!
		dispose()
		expect(preview.isDisposed)
			.toBe(true)
		expect(host.sessions.value.size)
			.toBe(0)
		runtime.dispose()
		// Nothing throws once the desk's own Runtime is gone either.
		expect(host.open('draft-v1'))
			.toBe(false)
		expect(() => host.resetAll()).not.toThrow()
	})

	it('survives the desk\'s Runtime being disposed under an open session', () => {
		const { host, runtime } = setup()
		host.open('draft-v1')
		runtime.dispose()
		expect(() => host.applyNext('draft-v1')).not.toThrow()
		expect(() => host.close('draft-v1')).not.toThrow()
	})

	it('leaves the poll draft\'s stored source as it was too', () => {
		const { host, widgets } = setup()
		const before = JSON.stringify(legacyPoll)
		host.open('draft-poll')
		host.applyNext('draft-poll')
		expect(JSON.stringify(widgets.poll.properties.source.get()))
			.toBe(JSON.stringify({ ok: true, value: JSON.parse(before) }))
	})
})
