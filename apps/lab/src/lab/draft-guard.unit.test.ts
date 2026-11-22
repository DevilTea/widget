import { describe, expect, it, vi } from 'vitest'
import { createDraftGuard, hasCommittedEdits, replacementLoss } from './draft-guard'

describe('draft guard', () => {
	it('runs the action at once when nothing would be lost', () => {
		const onChange = vi.fn()
		const run = vi.fn()
		const guard = createDraftGuard(onChange)

		expect(guard.request({ loss: 'none', subject: 'Default', run }))
			.toBe('ran')

		expect(run)
			.toHaveBeenCalledTimes(1)
		expect(guard.getPending())
			.toBeNull()
		expect(onChange).not.toHaveBeenCalled()
	})

	it('holds the action behind a confirmation while the JSON text does not parse, then runs it once on confirm', () => {
		const onChange = vi.fn()
		const run = vi.fn()
		const guard = createDraftGuard(onChange)

		expect(guard.request({ loss: 'draft', subject: 'AI draft', run }))
			.toBe('confirming')
		expect(run).not.toHaveBeenCalled()
		expect(guard.getPending()?.subject)
			.toBe('AI draft')
		expect(onChange)
			.toHaveBeenCalledTimes(1)

		expect(guard.confirm())
			.toBe(true)
		expect(run)
			.toHaveBeenCalledTimes(1)
		expect(guard.getPending())
			.toBeNull()
		expect(guard.confirm())
			.toBe(false)
		expect(run)
			.toHaveBeenCalledTimes(1)
	})

	it('drops the action on cancel and leaves the caller free to ask again', () => {
		const run = vi.fn()
		const guard = createDraftGuard()

		guard.request({ loss: 'draft', subject: 'x', run })
		guard.cancel()
		expect(guard.getPending())
			.toBeNull()
		expect(run).not.toHaveBeenCalled()
		expect(guard.confirm())
			.toBe(false)

		expect(guard.request({ loss: 'draft', subject: 'y', run }))
			.toBe('confirming')
	})

	it('ignores a second request while one waits and keeps the first action', () => {
		const first = vi.fn()
		const second = vi.fn()
		const guard = createDraftGuard()

		guard.request({ loss: 'draft', subject: 'first', run: first })
		expect(guard.request({ loss: 'draft', subject: 'second', run: second }))
			.toBe('ignored')
		expect(guard.request({ loss: 'none', subject: 'third', run: second }))
			.toBe('ignored')

		guard.confirm()
		expect(first)
			.toHaveBeenCalledTimes(1)
		expect(second).not.toHaveBeenCalled()
	})
})

describe('replacementLoss: what an action would discard for good', () => {
	it('asks about a JSON text that does not parse whatever the action, because nothing brings it back', () => {
		expect(replacementLoss({ jsonBlocked: true, hasCommittedEdits: false, undoable: true }))
			.toBe('draft')
		expect(replacementLoss({ jsonBlocked: true, hasCommittedEdits: false, undoable: false }))
			.toBe('draft')
	})

	it('asks about committed edits only when the action cannot be undone (a showcase switch)', () => {
		expect(replacementLoss({ jsonBlocked: false, hasCommittedEdits: true, undoable: false }))
			.toBe('edits')
		// A preset load is an ordinary commit: Undo brings the edits back, so it does not ask.
		expect(replacementLoss({ jsonBlocked: false, hasCommittedEdits: true, undoable: true }))
			.toBe('none')
	})

	it('names a draft and committed edits in one question', () => {
		expect(replacementLoss({ jsonBlocked: true, hasCommittedEdits: true, undoable: false }))
			.toBe('draft-and-edits')
		expect(replacementLoss({ jsonBlocked: true, hasCommittedEdits: true, undoable: true }))
			.toBe('draft')
	})

	it('has nothing to ask when neither exists', () => {
		expect(replacementLoss({ jsonBlocked: false, hasCommittedEdits: false, undoable: false }))
			.toBe('none')
	})

	it('holds the loss on the pending request so the dialog can name it', () => {
		const guard = createDraftGuard()
		guard.request({ loss: 'draft-and-edits', subject: 'Trip', run: () => {} })
		expect(guard.getPending()?.loss)
			.toBe('draft-and-edits')
	})
})

describe('hasCommittedEdits: the document differs from what was loaded', () => {
	const presets = [{ sourceText: '{"a":1}' }, { sourceText: '{"b":2}' }]

	it('is false while the applied source is exactly a preset of the showcase, any preset', () => {
		expect(hasCommittedEdits('{"a":1}', presets))
			.toBe(false)
		expect(hasCommittedEdits('{"b":2}', presets))
			.toBe(false)
	})

	it('compares JSON values: whitespace and key order are not edits (Format + Apply on an untouched preset), other values are', () => {
		expect(hasCommittedEdits('{"a":2}', presets))
			.toBe(true)
		expect(hasCommittedEdits('{ "a": 1 }', presets))
			.toBe(false)
		expect(hasCommittedEdits('{"k":1,"j":[1,{"z":null,"y":"s"}]}', [{ sourceText: '{\n  "j": [1, { "y": "s", "z": null }],\n  "k": 1\n}' }]))
			.toBe(false)
		expect(hasCommittedEdits('{"j":[{"y":"s"},1]}', [{ sourceText: '{"j":[1,{"y":"s"}]}' }]))
			.toBe(true)
		expect(hasCommittedEdits('{"a":1,"extra":null}', presets))
			.toBe(true)
	})

	it('compares as text when a source does not parse', () => {
		expect(hasCommittedEdits('{ broken', [{ sourceText: '{ broken' }]))
			.toBe(false)
		expect(hasCommittedEdits('{ broken', [{ sourceText: '{  broken' }]))
			.toBe(true)
	})
})
